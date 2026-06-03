#!/usr/bin/env python3
"""Run staged CBCT ONNX models against a staged raw CBCT volume.

This is a local validation harness for the Google Drive/R2 staging layout:

  models/*.onnx
  volumes/<name>/manifest.json
  volumes/<name>/volume-int16.raw

It mirrors the app's nnU-Net preprocessing closely enough for visual/model
comparison: resample to model spacing, CT-normalize, reflect-pad, run
non-overlapping sliding-window inference, crop, report voxel counts, and save
mid-plane overlays.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image
from scipy.ndimage import zoom


@dataclass(frozen=True)
class ModelConfig:
    name: str
    file: str
    labels: dict[int, str]
    colors: dict[int, tuple[int, int, int]]
    spacing_zyx: tuple[float, float, float]
    patch_zyx: tuple[int, int, int]
    norm: tuple[float, float, float, float]


DENTAL = ModelConfig(
    name="dentalsegmentator",
    file="dentalsegmentator.onnx",
    labels={
        0: "background",
        1: "Upper Skull",
        2: "Mandible",
        3: "Upper Teeth",
        4: "Lower Teeth",
        5: "Mandibular canal",
    },
    colors={
        1: (216, 195, 165),
        2: (232, 168, 124),
        3: (84, 182, 232),
        4: (112, 216, 120),
        5: (234, 93, 93),
    },
    spacing_zyx=(0.43164101243019104, 0.31200000643730164, 0.43164101243019104),
    patch_zyx=(128, 160, 112),
    norm=(-208.0, 3070.0, 1178.261474609375, 611.7098999023438),
)

AMASSS_SKIN = ModelConfig(
    name="amasss-skin",
    file="amasss-skin.onnx",
    labels={0: "background", 1: "Skin/soft tissue"},
    colors={1: (232, 180, 140)},
    spacing_zyx=(0.4, 0.4, 0.4),
    patch_zyx=(128, 128, 128),
    norm=(-931.0, 1543.0, 12.869, 370.557),
)

# The repo has the UAW model staged but no app-side constants wired yet. The
# exported graph has the same binary 128^3 AMASSS shape, so use the AMASSS
# normalization/spacing for a best-effort visual check and mark that in output.
AMASSS_UAW = ModelConfig(
    name="amasss-uaw-best-effort",
    file="amasss-uaw.onnx",
    labels={0: "background", 1: "Upper airway"},
    colors={1: (132, 205, 255)},
    spacing_zyx=(0.4, 0.4, 0.4),
    patch_zyx=(128, 128, 128),
    norm=(-931.0, 1543.0, 12.869, 370.557),
)


def load_volume(volume_dir: Path) -> tuple[np.ndarray, tuple[float, float, float], dict]:
    manifest = json.loads((volume_dir / "manifest.json").read_text())
    dims = manifest["dimensions"]
    shape = (int(dims["depth"]), int(dims["height"]), int(dims["width"]))
    volume = np.fromfile(volume_dir / manifest["file"], dtype="<i2").reshape(shape)
    spacing = manifest["spacing"]
    spacing_zyx = (float(spacing["z"]), float(spacing["y"]), float(spacing["x"]))
    return volume.astype(np.float32), spacing_zyx, manifest


def reflect_pad(vol: np.ndarray, target: tuple[int, int, int]) -> tuple[np.ndarray, list[tuple[int, int]]]:
    pads = []
    for n, t in zip(vol.shape, target):
        total = max(0, t - n)
        pads.append((total // 2, total - total // 2))
    if any(p != (0, 0) for p in pads):
        return np.pad(vol, pads, mode="reflect"), pads
    return vol, pads


def window_starts(size: int, window: int) -> list[int]:
    if size <= window:
        return [0]
    count = math.ceil((size - window) / window) + 1
    return [min(k * window, size - window) for k in range(count)]


def save_overlays(
    output_dir: Path,
    config: ModelConfig,
    image_volume: np.ndarray,
    labelmap: np.ndarray,
) -> None:
    gray = np.clip(
        (image_volume - image_volume.min()) / (np.ptp(image_volume) + 1e-6) * 255,
        0,
        255,
    ).astype(np.uint8)

    def overlay(sl_gray: np.ndarray, sl_lab: np.ndarray) -> np.ndarray:
        rgb = np.stack([sl_gray] * 3, axis=-1).astype(np.uint8)
        for value, color in config.colors.items():
            mask = sl_lab == value
            rgb[mask] = (0.45 * np.array(color) + 0.55 * rgb[mask]).astype(np.uint8)
        return rgb

    mid = [s // 2 for s in image_volume.shape]
    for name, image, labels in [
        ("axial", gray[mid[0]], labelmap[mid[0]]),
        ("coronal", gray[:, mid[1]], labelmap[:, mid[1]]),
        ("sagittal", gray[:, :, mid[2]], labelmap[:, :, mid[2]]),
    ]:
        Image.fromarray(overlay(image, labels)).save(output_dir / f"{config.name}_{name}.png")


def run_model(
    volume: np.ndarray,
    spacing_zyx: tuple[float, float, float],
    model_path: Path,
    config: ModelConfig,
    output_dir: Path,
) -> dict:
    factors = [spacing_zyx[i] / config.spacing_zyx[i] for i in range(3)]
    resampled = zoom(volume, factors, order=1)
    lower, upper, mean, std = config.norm
    normalized = (np.clip(resampled, lower, upper) - mean) / std
    target = tuple(max(config.patch_zyx[i], normalized.shape[i]) for i in range(3))
    padded, pads = reflect_pad(normalized, target)
    pd, ph, pw = padded.shape

    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    class_count = len(config.labels)
    best_prob = np.zeros((pd, ph, pw), dtype=np.float32)
    best_label = np.zeros((pd, ph, pw), dtype=np.uint8)
    starts = [window_starts(pd, config.patch_zyx[0]), window_starts(ph, config.patch_zyx[1]), window_starts(pw, config.patch_zyx[2])]
    total = len(starts[0]) * len(starts[1]) * len(starts[2])
    done = 0
    print(f"{config.name}: resampled {resampled.shape}, patches {total}", flush=True)

    dz, dy, dx = config.patch_zyx
    for z0 in starts[0]:
        for y0 in starts[1]:
            for x0 in starts[2]:
                patch = padded[z0:z0 + dz, y0:y0 + dy, x0:x0 + dx][None, None].astype(np.float32)
                logits = session.run([output_name], {input_name: patch})[0][0]
                argmax = logits.argmax(axis=0).astype(np.uint8)
                max_logits = logits.max(axis=0)
                exp_sum = np.exp(logits - max_logits[None]).sum(axis=0)
                prob = 1.0 / exp_sum
                region_prob = best_prob[z0:z0 + dz, y0:y0 + dy, x0:x0 + dx]
                region_label = best_label[z0:z0 + dz, y0:y0 + dy, x0:x0 + dx]
                replace = prob > region_prob
                region_prob[replace] = prob[replace]
                region_label[replace] = argmax[replace]
                done += 1
                print(f"  {config.name} patch {done}/{total}", flush=True)

    z0, y0, x0 = (p[0] for p in pads)
    z1, y1, x1 = z0 + resampled.shape[0], y0 + resampled.shape[1], x0 + resampled.shape[2]
    labelmap = best_label[z0:z1, y0:y1, x0:x1]
    np.save(output_dir / f"{config.name}_labels_modelgrid.npy", labelmap)
    save_overlays(output_dir, config, resampled, labelmap)

    voxel_mm3 = config.spacing_zyx[0] * config.spacing_zyx[1] * config.spacing_zyx[2]
    counts = {}
    for value in range(class_count):
        count = int((labelmap == value).sum())
        counts[str(value)] = {
            "label": config.labels[value],
            "voxels": count,
            "cm3": round(count * voxel_mm3 / 1000, 3),
        }
    return {
        "model": config.name,
        "file": str(model_path),
        "resampledShapeZYX": list(labelmap.shape),
        "spacingZYX": list(config.spacing_zyx),
        "patches": total,
        "counts": counts,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True, type=Path)
    parser.add_argument("--volume", default="real-cbct")
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/staged-cbct-model-validation"))
    args = parser.parse_args()

    volume_dir = args.base / "volumes" / args.volume
    model_dir = args.base / "models"
    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    volume, spacing_zyx, manifest = load_volume(volume_dir)
    print(f"loaded {args.volume}: {volume.shape}, spacing {spacing_zyx}", flush=True)

    results = {
        "volume": str(volume_dir),
        "source": manifest.get("source"),
        "shapeZYX": list(volume.shape),
        "spacingZYX": list(spacing_zyx),
        "models": [],
    }
    for config in [DENTAL, AMASSS_SKIN, AMASSS_UAW]:
        model_path = model_dir / config.file
        if not model_path.exists():
            results["models"].append({"model": config.name, "error": f"missing {model_path}"})
            continue
        results["models"].append(run_model(volume, spacing_zyx, model_path, config, output_dir))

    (output_dir / "summary.json").write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2), flush=True)


if __name__ == "__main__":
    main()
