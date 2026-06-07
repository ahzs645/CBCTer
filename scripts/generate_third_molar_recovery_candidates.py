#!/usr/bin/env python3
"""Generate review candidates for missing third molars without CUDA models."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage.measure import marching_cubes

from export_toothseg_prediction import smooth_vertices, write_binary_stl


TARGETS = {
    18: {"label": 8, "second": 7, "first": 6, "name": "Upper Right Third Molar"},
    28: {"label": 16, "second": 15, "first": 14, "name": "Upper Left Third Molar"},
    38: {"label": 24, "second": 23, "first": 22, "name": "Lower Left Third Molar"},
    48: {"label": 32, "second": 31, "first": 30, "name": "Lower Right Third Molar"},
}


def load_nifti(path: Path) -> tuple[np.ndarray, tuple[float, float, float]]:
    image = nib.load(str(path))
    data = np.asanyarray(image.dataobj)
    spacing = tuple(float(v) for v in image.header.get_zooms()[:3])
    return data, spacing


def resize_nearest(mask: np.ndarray, shape: tuple[int, int, int]) -> np.ndarray:
    if mask.shape == shape:
        return mask
    factors = [target / source for target, source in zip(shape, mask.shape)]
    return ndi.zoom(mask, factors, order=0)[: shape[0], : shape[1], : shape[2]]


def normalize_slice(image: np.ndarray) -> np.ndarray:
    lo, hi = np.percentile(image, [1, 99])
    return np.clip((image - lo) / max(float(hi - lo), 1.0), 0, 1)


def centroid(labels: np.ndarray, value: int) -> np.ndarray | None:
    coords = np.argwhere(labels == value)
    if coords.size == 0:
        return None
    return coords.mean(axis=0)


def safe_unit(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    if norm < 1e-6:
        return vector
    return vector / norm


def roi_box(center: np.ndarray, shape: tuple[int, int, int], radius: tuple[int, int, int]) -> tuple[slice, slice, slice]:
    starts = np.maximum(np.floor(center - np.array(radius)).astype(int), 0)
    stops = np.minimum(np.ceil(center + np.array(radius)).astype(int), np.array(shape))
    return tuple(slice(int(a), int(b)) for a, b in zip(starts, stops))  # type: ignore[return-value]


def save_preview(volume: np.ndarray, mask: np.ndarray, output: Path, title: str) -> None:
    z = int(mask.sum(axis=(1, 2)).argmax()) if np.any(mask) else volume.shape[0] // 2
    rgb = np.repeat(normalize_slice(volume[z])[..., None], 3, axis=2)
    rgb[mask[z], 0] = 1.0
    rgb[mask[z], 1] *= 0.25
    rgb[mask[z], 2] *= 0.25
    image = Image.fromarray((rgb * 255).astype(np.uint8)).convert("RGB")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, min(image.width, 420), 22), fill=(0, 0, 0))
    draw.text((6, 4), title[:64], fill=(255, 255, 255))
    image.save(output)


def export_stl(mask: np.ndarray, spacing: tuple[float, float, float], output: Path, smooth_iterations: int) -> None:
    coords = np.argwhere(mask)
    if coords.size == 0:
        return
    z0, y0, x0 = coords.min(axis=0)
    z1, y1, x1 = coords.max(axis=0) + 1
    padded = np.pad(mask[z0:z1, y0:y1, x0:x1], 1)
    vertices, faces, _normals, _values = marching_cubes(
        padded.astype(np.float32),
        level=0.5,
        spacing=(spacing[2], spacing[1], spacing[0]),
    )
    vertices[:, 0] += (z0 - 1) * spacing[2]
    vertices[:, 1] += (y0 - 1) * spacing[1]
    vertices[:, 2] += (x0 - 1) * spacing[0]
    vertices = smooth_vertices(vertices, faces, smooth_iterations)
    write_binary_stl(output, vertices[:, [2, 1, 0]], faces)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--volume", type=Path, required=True, help="Original CBCT NIfTI.")
    parser.add_argument("--toothseg", type=Path, required=True, help="ToothSeg label NIfTI.")
    parser.add_argument("--rail", type=Path, required=True, help="RAIL binary mask NIfTI.")
    parser.add_argument("--extra-mask", type=Path, default=None, help="Optional second binary detector mask.")
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/non-nvidia-recovery/third-molar-candidates"))
    parser.add_argument("--hard-threshold", type=float, default=900.0)
    parser.add_argument("--subtract-dilation", type=int, default=5)
    parser.add_argument("--min-voxels", type=int, default=1000)
    parser.add_argument("--max-voxels", type=int, default=220000)
    parser.add_argument("--smooth-iterations", type=int, default=8)
    args = parser.parse_args()

    volume, spacing = load_nifti(args.volume)
    toothseg, _ = load_nifti(args.toothseg)
    rail, _ = load_nifti(args.rail)
    extra = None
    if args.extra_mask is not None:
        extra, _ = load_nifti(args.extra_mask)
    labels = toothseg.astype(np.int16, copy=False)
    rail_mask = resize_nearest(rail > 0, labels.shape)
    extra_mask = resize_nearest(extra > 0, labels.shape) if extra is not None else None
    toothseg_mask = labels > 0
    structure = ndi.generate_binary_structure(3, 1)
    occupied = ndi.binary_dilation(toothseg_mask, structure=structure, iterations=args.subtract_dilation)
    hard = volume > args.hard_threshold
    detector_mask = rail_mask if extra_mask is None else (rail_mask & extra_mask)
    base_candidate_mask = detector_mask & hard & ~occupied

    output = args.output_dir
    if output.exists():
        import shutil

        shutil.rmtree(output)
    (output / "instances").mkdir(parents=True)
    (output / "stl").mkdir()

    items: list[dict] = []
    accepted_labels = np.zeros(labels.shape, dtype=np.uint16)
    next_label = 1

    for fdi, spec in TARGETS.items():
        if np.any(labels == spec["label"]):
            continue
        second = centroid(labels, int(spec["second"]))
        first = centroid(labels, int(spec["first"]))
        if second is None or first is None:
            items.append({"fdi": fdi, "status": "skipped", "reason": "missing first/second molar anchor"})
            continue

        posterior = safe_unit(second - first)
        center = second + posterior * 70.0
        box = roi_box(center, labels.shape, radius=(90, 95, 95))
        roi = np.zeros(labels.shape, dtype=bool)
        roi[box] = True
        candidate_source = base_candidate_mask & roi
        candidate_source = ndi.binary_opening(candidate_source, structure=structure, iterations=1)
        candidate_source = ndi.binary_closing(candidate_source, structure=structure, iterations=1)

        comps, count = ndi.label(candidate_source, structure=structure)
        objects = ndi.find_objects(comps)
        rows = []
        for comp_id, slc in enumerate(objects, start=1):
            if slc is None:
                continue
            comp_mask_local = comps[slc] == comp_id
            voxels = int(np.count_nonzero(comp_mask_local))
            if voxels < args.min_voxels or voxels > args.max_voxels:
                continue
            coords = np.argwhere(comp_mask_local)
            offset = np.array([s.start for s in slc], dtype=float)
            comp_centroid = coords.mean(axis=0) + offset
            distance_to_expected = float(np.linalg.norm(comp_centroid - center))
            distance_to_second = float(np.linalg.norm(comp_centroid - second))
            intensity = volume[slc][comp_mask_local]
            rail_fraction = float(np.mean(rail_mask[slc][comp_mask_local]))
            extra_fraction = (
                float(np.mean(extra_mask[slc][comp_mask_local])) if extra_mask is not None else None
            )
            score = (
                min(1.0, voxels / 60000.0) * 0.25
                + max(0.0, 1.0 - distance_to_expected / 95.0) * 0.35
                + max(0.0, 1.0 - abs(distance_to_second - 75.0) / 90.0) * 0.20
                + min(1.0, float(np.mean(intensity > 1300))) * 0.20
            )
            rows.append(
                {
                    "compId": comp_id,
                    "voxels": voxels,
                    "centroid": comp_centroid,
                    "bbox": slc,
                    "distanceToExpected": distance_to_expected,
                    "distanceToSecondMolar": distance_to_second,
                    "hardFraction1300": float(np.mean(intensity > 1300)),
                    "railFraction": rail_fraction,
                    "extraMaskFraction": extra_fraction,
                    "meanIntensity": float(np.mean(intensity)),
                    "score": score,
                }
            )
        rows.sort(key=lambda row: row["score"], reverse=True)

        for rank, row in enumerate(rows[:3], start=1):
            slc = row["bbox"]
            mask = np.zeros(labels.shape, dtype=bool)
            mask[slc] = comps[slc] == row["compId"]
            accepted_labels[mask] = next_label
            stem = f"{next_label:02d}-fdi-{fdi}-candidate-{rank}"
            preview = output / "instances" / f"{stem}.png"
            stl = output / "stl" / f"{stem}.stl"
            save_preview(volume, mask, preview, f"FDI {fdi} candidate {rank} score {row['score']:.2f}")
            export_stl(mask, spacing, stl, args.smooth_iterations)
            z0, y0, x0 = [int(s.start) for s in slc]
            z1, y1, x1 = [int(s.stop) for s in slc]
            items.append(
                {
                    "label": next_label,
                    "fdi": fdi,
                    "name": f"FDI {fdi} {spec['name']} candidate {rank}",
                    "status": "review",
                    "preview": f"instances/{preview.name}",
                    "stl": f"stl/{stl.name}",
                    "assignedVoxels": int(row["voxels"]),
                    "centroidZYX": [round(float(v), 2) for v in row["centroid"]],
                    "expectedCenterZYX": [round(float(v), 2) for v in center],
                    "secondMolarCentroidZYX": [round(float(v), 2) for v in second],
                    "bboxZYX": [z0, y0, x0, z1, y1, x1],
                    "extentZYX": [z1 - z0, y1 - y0, x1 - x0],
                    "score": round(float(row["score"]), 4),
                    "distanceToExpected": round(float(row["distanceToExpected"]), 2),
                    "distanceToSecondMolar": round(float(row["distanceToSecondMolar"]), 2),
                    "meanIntensity": round(float(row["meanIntensity"]), 2),
                    "hardFraction1300": round(float(row["hardFraction1300"]), 4),
                    "railFraction": round(float(row["railFraction"]), 4),
                    "extraMaskFraction": None
                    if row["extraMaskFraction"] is None
                    else round(float(row["extraMaskFraction"]), 4),
                }
            )
            next_label += 1

    np.savez_compressed(output / "candidate-labels.npz", labels=accepted_labels)
    columns = 4
    tiles = []
    for item in items:
        if item.get("status") != "review":
            continue
        image = Image.open(output / item["preview"]).resize((180, 180))
        tile = Image.new("RGB", (180, 218), (16, 19, 22))
        tile.paste(image, (0, 0))
        ImageDraw.Draw(tile).text((6, 188), f"FDI {item['fdi']} score {item['score']}", fill=(230, 230, 230))
        tiles.append(tile)
    sheet = Image.new("RGB", (columns * 180, max(1, ((len(tiles) + columns - 1) // columns)) * 218), (16, 19, 22))
    for index, tile in enumerate(tiles):
        sheet.paste(tile, ((index % columns) * 180, (index // columns) * 218))
    sheet.save(output / "contact-sheet.png")

    summary = {
        "source": "toothseg-rail-hard-tissue-third-molar-candidates",
        "volume": str(args.volume),
        "toothseg": str(args.toothseg),
        "rail": str(args.rail),
        "extraMask": None if args.extra_mask is None else str(args.extra_mask),
        "hardThreshold": args.hard_threshold,
        "subtractDilation": args.subtract_dilation,
        "candidateCount": len([item for item in items if item.get("status") == "review"]),
        "targets": [18, 28, 38, 48],
        "labels": "candidate-labels.npz",
        "contactSheet": "contact-sheet.png",
        "items": items,
    }
    (output / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    (output / "manifest.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({"candidateCount": summary["candidateCount"], "output": str(output)}, indent=2))


if __name__ == "__main__":
    main()
