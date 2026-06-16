#!/usr/bin/env python3
"""Compare browser-sized YOLO-seg ONNX tooth models on the clinic CBCT.

This is intended to run in Colab with Drive mounted. It mirrors the browser
YOLO path closely enough for model selection:

  CBCT NIfTI -> 0.3 mm isotropic -> fixed CT window -> 512 letterbox slices
  -> YOLOv8-seg ONNX -> 3D binary tooth mask plus optional per-detection
  seed labels -> instance metrics vs labels.

It supports both single-class tooth models and 32-class FDI YOLO-seg exports by
unioning all tooth-class masks.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import onnxruntime as ort
import SimpleITK as sitk
from skimage.feature import peak_local_max
from scipy import ndimage
from skimage.segmentation import watershed


INPUT = 512
TARGET_SPACING = 0.3
HU_LO = -113.8
HU_HI = 4021.0
MASK_COEFFS = 32
MAX_TRACK_GAP = 2
MIN_TRACK_OVERLAP = 0.12
MAX_SEED_LABEL = 65535


@dataclass
class Detection:
    box: tuple[float, float, float, float]
    score: float
    cls: int
    coeffs: np.ndarray


@dataclass
class InstanceMask:
    detection: Detection
    pixels: np.ndarray


@dataclass
class SliceSeed:
    pixels: np.ndarray
    score: float


@dataclass
class ActiveTrack:
    track_id: int
    last_z: int
    pixels: np.ndarray


@dataclass
class PeakSplitOptions:
    enabled: bool = False
    threshold: float = 5.0
    distance: int = 12
    min_component_voxels: int = 14_000
    min_child_voxels: int = 4_000
    max_child_ratio: float = 6.0
    max_peaks: int = 2


def load_volume(path: Path, target_spacing: float, is_label: bool) -> np.ndarray:
    img = sitk.ReadImage(str(path))
    spacing = img.GetSpacing()
    size = img.GetSize()
    new_size = [
        max(1, int(round(sz * sp / float(target_spacing))))
        for sz, sp in zip(size, spacing)
    ]
    interp = sitk.sitkNearestNeighbor if is_label else sitk.sitkLinear
    resampled = sitk.Resample(
        img,
        new_size,
        sitk.Transform(),
        interp,
        img.GetOrigin(),
        (float(target_spacing),) * 3,
        img.GetDirection(),
        0.0,
        img.GetPixelID(),
    )
    return sitk.GetArrayFromImage(resampled)


def preprocess_slice(slice_hu: np.ndarray) -> tuple[np.ndarray, int, int, int, int]:
    h, w = slice_hu.shape
    scale = INPUT / max(h, w)
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    pad_x = (INPUT - new_w) // 2
    pad_y = (INPUT - new_h) // 2
    normalized = np.clip((slice_hu.astype(np.float32) - HU_LO) / (HU_HI - HU_LO), 0, 1)
    resized = cv2.resize(normalized, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    chw = np.zeros((3, INPUT, INPUT), dtype=np.float32)
    chw[:, pad_y : pad_y + new_h, pad_x : pad_x + new_w] = resized[None, :, :]
    return chw[None], pad_x, pad_y, new_w, new_h


def normalize_det_shape(det: np.ndarray) -> np.ndarray:
    if det.ndim != 3 or det.shape[0] != 1:
        raise RuntimeError(f"unexpected detection output shape {det.shape}")
    arr = det[0]
    # Ultralytics ONNX normally exports [1, C, N]. Some graphs export [1, N, C].
    if arr.shape[0] > arr.shape[1]:
        arr = arr.T
    channels = arr.shape[0]
    if channels <= 4 + MASK_COEFFS:
        raise RuntimeError(f"unexpected YOLO channel count {channels}")
    return arr


def box_iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ix1 = max(a[0], b[0])
    iy1 = max(a[1], b[1])
    ix2 = min(a[2], b[2])
    iy2 = min(a[3], b[3])
    iw = max(0.0, ix2 - ix1)
    ih = max(0.0, iy2 - iy1)
    inter = iw * ih
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def decode_detections(
    det_raw: np.ndarray,
    conf: float,
    iou: float,
    max_det: int,
) -> list[Detection]:
    det = normalize_det_shape(det_raw)
    channels, anchors = det.shape
    class_count = channels - 4 - MASK_COEFFS
    if class_count < 1:
        raise RuntimeError(f"cannot infer class count from channels={channels}")
    coeff_offset = 4 + class_count

    out: list[Detection] = []
    class_scores = det[4:coeff_offset]
    best_cls = np.argmax(class_scores, axis=0)
    best_score = class_scores[best_cls, np.arange(anchors)]
    keep_idx = np.flatnonzero(best_score >= conf)
    for a in keep_idx:
        cx, cy, w, h = (float(det[i, a]) for i in range(4))
        coeffs = det[coeff_offset : coeff_offset + MASK_COEFFS, a].astype(np.float32, copy=True)
        out.append(
            Detection(
                box=(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2),
                score=float(best_score[a]),
                cls=int(best_cls[a]),
                coeffs=coeffs,
            )
        )

    out.sort(key=lambda d: d.score, reverse=True)
    kept: list[Detection] = []
    for d in out:
        if len(kept) >= max_det:
            break
        if all(box_iou(d.box, k.box) <= iou for k in kept):
            kept.append(d)
    return kept


def build_instance_masks(
    dets: list[Detection],
    proto: np.ndarray,
    mask_threshold: float,
) -> list[InstanceMask]:
    if proto.ndim != 4 or proto.shape[0] != 1:
        raise RuntimeError(f"unexpected proto output shape {proto.shape}")
    protos = proto[0].astype(np.float32, copy=False)
    coeffs_count, proto_h, proto_w = protos.shape
    if coeffs_count != MASK_COEFFS:
        raise RuntimeError(f"expected {MASK_COEFFS} mask protos, got {coeffs_count}")
    plane_p = proto_h * proto_w
    flat = protos.reshape(MASK_COEFFS, plane_p)
    sx = proto_w / INPUT
    sy = proto_h / INPUT
    instances: list[InstanceMask] = []

    for d in dets:
        x1 = max(0, int(math.floor(d.box[0])))
        y1 = max(0, int(math.floor(d.box[1])))
        x2 = min(INPUT, int(math.ceil(d.box[2])))
        y2 = min(INPUT, int(math.ceil(d.box[3])))
        if x2 <= x1 or y2 <= y1:
            continue
        pixels: list[int] = []
        for y in range(y1, y2):
            py = min(proto_h - 1, int(y * sy))
            input_row = y * INPUT
            for x in range(x1, x2):
                px = min(proto_w - 1, int(x * sx))
                logits = float(np.dot(d.coeffs, flat[:, py * proto_w + px]))
                prob = 1.0 / (1.0 + math.exp(-logits))
                if prob > mask_threshold:
                    pixels.append(input_row + x)
        if pixels:
            instances.append(InstanceMask(detection=d, pixels=np.asarray(pixels, dtype=np.int32)))
    return instances


def union_from_instances(instances: list[InstanceMask]) -> np.ndarray:
    out = np.zeros((INPUT, INPUT), dtype=np.uint8)
    for instance in instances:
        out.flat[instance.pixels] = 1
    return out


def map_instance_to_volume_slice(
    instance: InstanceMask,
    pad_x: int,
    pad_y: int,
    new_w: int,
    new_h: int,
    width: int,
    height: int,
) -> SliceSeed | None:
    pixels = instance.pixels
    ly = pixels // INPUT
    lx = pixels - ly * INPUT
    keep = (lx >= pad_x) & (lx < pad_x + new_w) & (ly >= pad_y) & (ly < pad_y + new_h)
    if not np.any(keep):
        return None
    lx = lx[keep]
    ly = ly[keep]
    x = np.floor(((lx - pad_x + 0.5) * width) / new_w).astype(np.int32)
    y = np.floor(((ly - pad_y + 0.5) * height) / new_h).astype(np.int32)
    x = np.clip(x, 0, width - 1)
    y = np.clip(y, 0, height - 1)
    mapped = np.unique(y * width + x).astype(np.int32, copy=False)
    if mapped.size == 0:
        return None
    return SliceSeed(pixels=mapped, score=instance.detection.score)


def sparse_intersection(a: np.ndarray, b: np.ndarray) -> int:
    i = 0
    j = 0
    count = 0
    while i < a.size and j < b.size:
        av = int(a[i])
        bv = int(b[j])
        if av == bv:
            count += 1
            i += 1
            j += 1
        elif av < bv:
            i += 1
        else:
            j += 1
    return count


def choose_track(
    seed: SliceSeed,
    z: int,
    active_tracks: dict[int, ActiveTrack],
    used_tracks: set[int],
) -> int | None:
    best_track: ActiveTrack | None = None
    best_score = 0.0
    for track in active_tracks.values():
        if track.track_id in used_tracks:
            continue
        gap = z - track.last_z
        if gap < 1 or gap > MAX_TRACK_GAP:
            continue
        intersection = sparse_intersection(seed.pixels, track.pixels)
        if intersection == 0:
            continue
        score = intersection / max(1, min(seed.pixels.size, track.pixels.size))
        if score > best_score:
            best_score = score
            best_track = track
    return best_track.track_id if best_track and best_score >= MIN_TRACK_OVERLAP else None


def run_model(
    model_path: Path,
    volume: np.ndarray,
    conf: float,
    iou: float,
    mask_threshold: float,
    max_slices: int,
) -> dict[str, Any]:
    start = time.time()
    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    output_names = [o.name for o in session.get_outputs()]
    depth, height, width = volume.shape
    mask3d = np.zeros((depth, height, width), dtype=np.uint8)
    seed_labels = np.zeros((depth, height, width), dtype=np.uint16)
    detection_counts: list[int] = []
    active_tracks: dict[int, ActiveTrack] = {}
    next_track_id = 1
    processed = depth if max_slices <= 0 else min(depth, max_slices)

    for z in range(processed):
        tensor, pad_x, pad_y, new_w, new_h = preprocess_slice(volume[z])
        outputs = session.run(output_names, {input_name: tensor})
        det_raw = None
        proto = None
        for out in outputs:
            if out.ndim == 3:
                det_raw = out
            elif out.ndim == 4:
                proto = out
        if det_raw is None or proto is None:
            raise RuntimeError(
                f"{model_path.name}: expected 3D detection and 4D proto outputs, got {[o.shape for o in outputs]}"
            )
        dets = decode_detections(det_raw, conf=conf, iou=iou, max_det=300)
        detection_counts.append(len(dets))
        if dets:
            instances = build_instance_masks(dets, proto, mask_threshold)
            letter_mask = union_from_instances(instances)
            # Match the app worker's nearest un-letterbox mapping.
            yy = pad_y + np.minimum(new_h - 1, ((np.arange(height) * new_h) // height))
            xx = pad_x + np.minimum(new_w - 1, ((np.arange(width) * new_w) // width))
            mask3d[z] = letter_mask[np.ix_(yy, xx)]
            seeds = [
                seed
                for instance in instances
                if (seed := map_instance_to_volume_slice(instance, pad_x, pad_y, new_w, new_h, width, height))
                is not None
            ]
            seeds.sort(key=lambda seed: seed.score, reverse=True)
            used_tracks: set[int] = set()
            slice_mask = mask3d[z].reshape(-1)
            slice_seeds = seed_labels[z].reshape(-1)
            for seed in seeds:
                track_id = choose_track(seed, z, active_tracks, used_tracks)
                if track_id is None:
                    if next_track_id > MAX_SEED_LABEL:
                        continue
                    track_id = next_track_id
                    next_track_id += 1
                used_tracks.add(track_id)
                active_tracks[track_id] = ActiveTrack(track_id=track_id, last_z=z, pixels=seed.pixels)
                seed_pixels = seed.pixels[(slice_mask[seed.pixels] > 0) & (slice_seeds[seed.pixels] == 0)]
                slice_seeds[seed_pixels] = track_id
        for track_id, track in list(active_tracks.items()):
            if z - track.last_z > MAX_TRACK_GAP:
                del active_tracks[track_id]
        if (z + 1) % 25 == 0 or z + 1 == processed:
            print(f"[{model_path.name}] slice {z + 1}/{processed}", flush=True)

    return {
        "modelPath": str(model_path),
        "mask": mask3d,
        "seedLabels": seed_labels,
        "seedCount": next_track_id - 1,
        "seconds": round(time.time() - start, 2),
        "processedSlices": processed,
        "detectionCountMean": float(np.mean(detection_counts)) if detection_counts else 0.0,
        "detectionCountMax": int(np.max(detection_counts)) if detection_counts else 0,
        "positiveVoxels": int(mask3d.sum()),
    }


def valid_fdi_values(labelmap: np.ndarray) -> list[int]:
    values = []
    for v in np.unique(labelmap):
        iv = int(v)
        if iv // 10 in (1, 2, 3, 4) and 1 <= iv % 10 <= 8:
            values.append(iv)
    return values


def label_values(labelmap: np.ndarray, mode: str) -> list[int]:
    if mode == "fdi":
        return valid_fdi_values(labelmap)
    if mode == "nonzero":
        return [int(v) for v in np.unique(labelmap) if int(v) != 0]
    raise ValueError(f"unsupported label mode: {mode}")


def smooth_dist(dist: np.ndarray) -> np.ndarray:
    kernel = np.zeros((3, 3, 3), dtype=np.float32)
    kernel[1, 1, 1] = 1
    kernel[0, 1, 1] = kernel[2, 1, 1] = 1
    kernel[1, 0, 1] = kernel[1, 2, 1] = 1
    kernel[1, 1, 0] = kernel[1, 1, 2] = 1
    counts = ndimage.convolve(np.ones_like(dist, dtype=np.float32), kernel, mode="constant", cval=0)
    summed = ndimage.convolve(dist.astype(np.float32), kernel, mode="constant", cval=0)
    return np.divide(summed, np.maximum(counts, 1), dtype=np.float32)


def bbox_from_mask(mask: np.ndarray) -> tuple[int, int, int, int, int, int] | None:
    coords = np.argwhere(mask)
    if coords.size == 0:
        return None
    z0, y0, x0 = coords.min(axis=0)
    z1, y1, x1 = coords.max(axis=0) + 1
    return int(z0), int(y0), int(x0), int(z1), int(y1), int(x1)


def add_peak_split_markers(
    mask: np.ndarray,
    dist: np.ndarray,
    markers: np.ndarray,
    options: PeakSplitOptions,
) -> tuple[np.ndarray, list[dict[str, Any]]]:
    if not options.enabled:
        return markers, []

    out = markers.astype(np.int32, copy=True)
    initial = watershed(-dist, out, mask=mask.astype(bool)).astype(np.int32)
    ids, counts = np.unique(initial[initial > 0], return_counts=True)
    next_marker = int(out.max()) + 1
    events: list[dict[str, Any]] = []

    for raw_id, raw_count in zip(ids, counts):
        component_id = int(raw_id)
        component_voxels = int(raw_count)
        if component_voxels < options.min_component_voxels:
            continue

        component_mask = initial == component_id
        bbox = bbox_from_mask(component_mask)
        if bbox is None:
            continue
        z0, y0, x0, z1, y1, x1 = bbox
        extent = [z1 - z0, y1 - y0, x1 - x0]
        if max(extent) < options.distance * 2:
            continue

        sub_mask = component_mask[z0:z1, y0:y1, x0:x1]
        sub_dist = dist[z0:z1, y0:y1, x0:x1]
        peaks = peak_local_max(
            sub_dist,
            labels=sub_mask.astype(np.uint8, copy=False),
            min_distance=options.distance,
            threshold_abs=options.threshold,
            exclude_border=False,
            num_peaks=options.max_peaks,
        )
        if peaks.shape[0] < 2:
            continue

        peak_values = sub_dist[tuple(peaks.T)]
        order = np.argsort(-peak_values)
        peaks = peaks[order]
        peak_values = peak_values[order]

        local_markers = np.zeros(sub_mask.shape, dtype=np.int32)
        for index, (pz, py, px) in enumerate(peaks, start=1):
            local_markers[int(pz), int(py), int(px)] = index
        local_ws = watershed(-sub_dist, local_markers, mask=sub_mask).astype(np.int32)
        child_ids, child_counts = np.unique(local_ws[local_ws > 0], return_counts=True)
        child_voxels = [int(v) for v in child_counts]
        if len(child_voxels) < 2:
            continue
        if min(child_voxels) < options.min_child_voxels:
            continue
        if max(child_voxels) / max(1, min(child_voxels)) > options.max_child_ratio:
            continue

        out_region = out[z0:z1, y0:y1, x0:x1]
        out_region[sub_mask] = 0
        assigned_markers: list[int] = []
        for index, (pz, py, px) in enumerate(peaks):
            marker_id = component_id if index == 0 else next_marker
            if index > 0:
                next_marker += 1
            out_region[int(pz), int(py), int(px)] = marker_id
            assigned_markers.append(int(marker_id))

        events.append(
            {
                "componentId": component_id,
                "componentVoxels": component_voxels,
                "bboxZYX": [z0, y0, x0, z1, y1, x1],
                "extentZYX": extent,
                "childVoxels": child_voxels,
                "peakDistances": [round(float(v), 3) for v in peak_values.tolist()],
                "markers": assigned_markers,
            }
        )

    return out, events


def watershed_instances(
    mask: np.ndarray,
    core_threshold: float,
    min_voxels: int,
    marker_labels: np.ndarray | None = None,
    peak_split: PeakSplitOptions | None = None,
) -> tuple[np.ndarray, list[int], list[dict[str, Any]]]:
    if int(mask.sum()) == 0:
        return np.zeros(mask.shape, dtype=np.int32), [], []
    fg_labels, fg_count = ndimage.label(mask, structure=np.ones((3, 3, 3), dtype=np.uint8))
    dist = smooth_dist(ndimage.distance_transform_edt(mask).astype(np.float32))

    if marker_labels is not None and np.any((marker_labels > 0) & (mask > 0)):
        markers = np.where(mask > 0, marker_labels, 0).astype(np.int32, copy=False)
        max_marker = int(markers.max())
        for comp in range(1, fg_count + 1):
            comp_mask = fg_labels == comp
            if not np.any(comp_mask):
                continue
            if np.any((markers > 0) & comp_mask):
                continue
            peak_flat = np.argmax(np.where(comp_mask, dist, -1))
            max_marker += 1
            markers.flat[int(peak_flat)] = max_marker
    else:
        seed_mask = (dist >= core_threshold) & (mask > 0)

        # Guarantee at least one seed per foreground component, like the browser path.
        for comp in range(1, fg_count + 1):
            comp_mask = fg_labels == comp
            if not np.any(comp_mask):
                continue
            if not np.any(seed_mask & comp_mask):
                peak_flat = np.argmax(np.where(comp_mask, dist, -1))
                seed_mask.flat[int(peak_flat)] = True

        markers, _ = ndimage.label(seed_mask, structure=np.ones((3, 3, 3), dtype=np.uint8))
    markers, split_events = add_peak_split_markers(mask, dist, markers, peak_split or PeakSplitOptions())
    ws = watershed(-dist, markers, mask=mask.astype(bool)).astype(np.int32)
    ids, counts = np.unique(ws[ws > 0], return_counts=True)
    kept = [int(i) for i, c in zip(ids, counts) if int(c) >= min_voxels]
    return ws, kept, split_events


def component_summaries(
    ws: np.ndarray,
    pred_ids: list[int],
    labels: np.ndarray,
    gt_values: list[int],
) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for pid in pred_ids:
        coords = np.argwhere(ws == pid)
        if coords.size == 0:
            continue
        z0, y0, x0 = coords.min(axis=0)
        z1, y1, x1 = coords.max(axis=0) + 1
        centroid = coords.mean(axis=0)
        overlaps = []
        for value in gt_values:
            overlap = int(np.logical_and(ws == pid, labels == value).sum())
            if overlap > 0:
                overlaps.append({"label": int(value), "overlap": overlap})
        summaries.append(
            {
                "id": int(pid),
                "voxels": int(coords.shape[0]),
                "bboxZYX": [int(z0), int(y0), int(x0), int(z1), int(y1), int(x1)],
                "extentZYX": [int(z1 - z0), int(y1 - y0), int(x1 - x0)],
                "centroidZYX": [round(float(v), 2) for v in centroid],
                "overlaps": sorted(overlaps, key=lambda item: item["overlap"], reverse=True)[:8],
            }
        )
    return summaries


def evaluate_mask(
    pred: np.ndarray,
    labels: np.ndarray,
    core_threshold: float,
    min_voxels: int,
    label_mode: str,
    marker_labels: np.ndarray | None = None,
    peak_split: PeakSplitOptions | None = None,
) -> dict[str, Any]:
    gt_values = label_values(labels, label_mode)
    gt_binary = np.isin(labels, gt_values)
    pred_binary = pred.astype(bool)
    tp = int(np.logical_and(pred_binary, gt_binary).sum())
    pred_count = int(pred_binary.sum())
    gt_count = int(gt_binary.sum())
    dice = (2 * tp / (pred_count + gt_count)) if (pred_count + gt_count) else 0.0
    precision = tp / pred_count if pred_count else 0.0
    recall = tp / gt_count if gt_count else 0.0

    ws, pred_ids, split_events = watershed_instances(
        pred.astype(np.uint8),
        core_threshold,
        min_voxels,
        marker_labels=marker_labels,
        peak_split=peak_split,
    )
    matched_values: set[int] = set()
    per_tooth = []
    for value in gt_values:
        g = labels == value
        g_count = int(g.sum())
        best = {"predId": None, "overlap": 0, "overlapFracGt": 0.0, "overlapFracMin": 0.0}
        for pid in pred_ids:
            pm = ws == pid
            overlap = int(np.logical_and(g, pm).sum())
            if overlap <= best["overlap"]:
                continue
            p_count = int(pm.sum())
            best = {
                "predId": int(pid),
                "overlap": overlap,
                "overlapFracGt": overlap / max(1, g_count),
                "overlapFracMin": overlap / max(1, min(g_count, p_count)),
            }
        if best["overlapFracMin"] > 0.10:
            matched_values.add(value)
        per_tooth.append({"label": value, **best})

    false_positive_ids = []
    duplicate_matches: dict[int, list[int]] = {}
    for pid in pred_ids:
        pm = ws == pid
        p_count = int(pm.sum())
        overlaps = [
            (v, int(np.logical_and(pm, labels == v).sum()))
            for v in gt_values
        ]
        best_value, best_overlap = max(overlaps, key=lambda item: item[1])
        if best_overlap > 0.10 * p_count:
            duplicate_matches.setdefault(int(best_value), []).append(int(pid))
        else:
            false_positive_ids.append(int(pid))

    components = component_summaries(ws, pred_ids, labels, gt_values)
    fp_set = set(false_positive_ids)
    merged_components = []
    for component in components:
        component["isFalsePositive"] = component["id"] in fp_set
        meaningful = [
            overlap["label"]
            for overlap in component["overlaps"]
            if int(overlap["overlap"]) > 1000
        ]
        if len(meaningful) > 1:
            merged_components.append(
                {
                    "id": component["id"],
                    "labels": meaningful,
                    "voxels": component["voxels"],
                }
            )

    duplicate_gt = {
        label: ids for label, ids in duplicate_matches.items() if len(ids) > 1
    }

    return {
        "voxelDice": round(dice, 5),
        "voxelPrecision": round(precision, 5),
        "voxelRecall": round(recall, 5),
        "predPositiveVoxels": pred_count,
        "gtPositiveVoxels": gt_count,
        "gtToothCount": len(gt_values),
        "labelMode": label_mode,
        "predInstanceCount": len(pred_ids),
        "matchedGtTeeth": len(matched_values),
        "instanceRecall": round(len(matched_values) / max(1, len(gt_values)), 5),
        "falsePositiveInstances": len(false_positive_ids),
        "falsePositiveIds": false_positive_ids[:50],
        "duplicateGtLabels": duplicate_gt,
        "duplicateInstances": sum(len(ids) - 1 for ids in duplicate_gt.values()),
        "mergedComponents": merged_components,
        "splitEvents": split_events,
        "components": components,
        "perTooth": per_tooth,
    }


def parse_models(values: list[str]) -> list[tuple[str, Path]]:
    models: list[tuple[str, Path]] = []
    for value in values:
        if "=" in value:
            name, path = value.split("=", 1)
        else:
            path = value
            name = Path(path).stem
        models.append((name, Path(path)))
    return models


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", type=Path, required=True)
    ap.add_argument("--labels", type=Path, required=True)
    ap.add_argument("--model", action="append", required=True, help="name=/path/to/model.onnx")
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--conf", type=float, default=0.15)
    ap.add_argument("--iou", type=float, default=0.45)
    ap.add_argument("--mask-threshold", type=float, default=0.7)
    ap.add_argument("--core-threshold", type=float, default=7.0)
    ap.add_argument("--min-voxels", type=int, default=8000)
    ap.add_argument(
        "--separation-mode",
        choices=("core", "yolo-seeds", "yolo-seeds+peaks", "both"),
        default="core",
        help="core uses distance-core watershed; yolo-seeds uses tracked YOLO detections as watershed markers.",
    )
    ap.add_argument("--peak-threshold", type=float, default=5.0)
    ap.add_argument("--peak-distance", type=int, default=12)
    ap.add_argument("--peak-min-component-voxels", type=int, default=14_000)
    ap.add_argument("--peak-min-child-voxels", type=int, default=4_000)
    ap.add_argument("--peak-max-child-ratio", type=float, default=6.0)
    ap.add_argument("--peak-max-peaks", type=int, default=2)
    ap.add_argument(
        "--label-mode",
        choices=("fdi", "nonzero"),
        default="fdi",
        help="Use fdi for labelmaps whose voxel values are FDI numbers; use nonzero for instance labelmaps.",
    )
    ap.add_argument("--max-slices", type=int, default=0, help="debug limit; 0 = all slices")
    args = ap.parse_args()

    print("loading/resampling clinic image...", flush=True)
    volume = load_volume(args.image, TARGET_SPACING, is_label=False).astype(np.float32, copy=False)
    print("loading/resampling clinic labels...", flush=True)
    labels = load_volume(args.labels, TARGET_SPACING, is_label=True).astype(np.int16, copy=False)
    if volume.shape != labels.shape:
        raise RuntimeError(f"resampled shape mismatch: image={volume.shape} labels={labels.shape}")

    results = {
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "image": str(args.image),
        "labels": str(args.labels),
        "targetSpacing": TARGET_SPACING,
        "volumeShapeZYX": list(map(int, volume.shape)),
        "conf": args.conf,
        "iou": args.iou,
        "maskThreshold": args.mask_threshold,
        "coreThreshold": args.core_threshold,
        "minVoxels": args.min_voxels,
        "labelMode": args.label_mode,
        "separationMode": args.separation_mode,
        "peakSplit": {
            "threshold": args.peak_threshold,
            "distance": args.peak_distance,
            "minComponentVoxels": args.peak_min_component_voxels,
            "minChildVoxels": args.peak_min_child_voxels,
            "maxChildRatio": args.peak_max_child_ratio,
            "maxPeaks": args.peak_max_peaks,
        },
        "models": [],
    }

    for name, path in parse_models(args.model):
        print(f"=== running {name}: {path} ===", flush=True)
        model_result = run_model(path, volume, args.conf, args.iou, args.mask_threshold, args.max_slices)
        mask = model_result.pop("mask")
        seed_labels = model_result.pop("seedLabels")
        modes = (
            ["core", "yolo-seeds", "yolo-seeds+peaks"]
            if args.separation_mode == "both"
            else [args.separation_mode]
        )
        for mode in modes:
            peak_split = PeakSplitOptions(
                enabled=mode == "yolo-seeds+peaks",
                threshold=args.peak_threshold,
                distance=args.peak_distance,
                min_component_voxels=args.peak_min_component_voxels,
                min_child_voxels=args.peak_min_child_voxels,
                max_child_ratio=args.peak_max_child_ratio,
                max_peaks=args.peak_max_peaks,
            )
            metrics = evaluate_mask(
                mask,
                labels[: mask.shape[0]],
                args.core_threshold,
                args.min_voxels,
                args.label_mode,
                marker_labels=seed_labels if mode.startswith("yolo-seeds") else None,
                peak_split=peak_split,
            )
            entry_name = f"{name}:{mode}" if args.separation_mode == "both" else name
            results["models"].append(
                {"name": entry_name, **model_result, "separationMode": mode, "metrics": metrics}
            )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))
    print(f"WROTE {args.output}")


if __name__ == "__main__":
    main()
