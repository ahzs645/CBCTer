#!/usr/bin/env python3
"""Export ToothSeg 3D labels into a YOLO segmentation slice dataset.

This creates a small 2D training set for browser-sized YOLO-seg experiments.
Each visible FDI tooth mask on a slice becomes one YOLO polygon annotation.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np
from PIL import Image
from skimage.measure import find_contours

TOOTHSEG_LABEL_TO_FDI = {
    1: 11,
    2: 12,
    3: 13,
    4: 14,
    5: 15,
    6: 16,
    7: 17,
    8: 18,
    9: 21,
    10: 22,
    11: 23,
    12: 24,
    13: 25,
    14: 26,
    15: 27,
    16: 28,
    17: 31,
    18: 32,
    19: 33,
    20: 34,
    21: 35,
    22: 36,
    23: 37,
    24: 38,
    25: 41,
    26: 42,
    27: 43,
    28: 44,
    29: 45,
    30: 46,
    31: 47,
    32: 48,
}

FDI_TO_CLASS = {fdi: idx for idx, fdi in enumerate(sorted(TOOTHSEG_LABEL_TO_FDI.values()))}


def load(path: Path) -> np.ndarray:
    return np.asanyarray(nib.load(str(path)).dataobj)


def normalize(image: np.ndarray) -> np.ndarray:
    lo, hi = np.percentile(image, [0.5, 99.5])
    scaled = np.clip((image - lo) / max(float(hi - lo), 1.0), 0, 1)
    return (scaled * 255).astype(np.uint8)


def slice_pair(volume: np.ndarray, labels: np.ndarray, axis: str, index: int) -> tuple[np.ndarray, np.ndarray]:
    if axis == "z":
        return volume[index], labels[index]
    if axis == "y":
        return volume[:, index, :], labels[:, index, :]
    if axis == "x":
        return volume[:, :, index], labels[:, :, index]
    raise ValueError(f"unsupported axis {axis}")


def polygon_lines(
    label_slice: np.ndarray,
    min_area: int,
    simplify_step: int,
    single_class: bool,
) -> list[str]:
    lines: list[str] = []
    height, width = label_slice.shape
    for label_value in sorted(int(v) for v in np.unique(label_slice) if int(v) > 0):
        mask = label_slice == label_value
        if int(np.count_nonzero(mask)) < min_area:
            continue
        fdi = TOOTHSEG_LABEL_TO_FDI.get(label_value)
        if fdi is None:
            continue
        class_id = 0 if single_class else FDI_TO_CLASS[fdi]
        contours = find_contours(mask.astype(np.uint8), 0.5)
        if not contours:
            continue
        contour = max(contours, key=len)
        if len(contour) < 6:
            continue
        contour = contour[:: max(1, simplify_step)]
        if len(contour) < 3:
            continue
        coords: list[str] = []
        for row, col in contour:
            x = min(max(float(col) / max(width - 1, 1), 0.0), 1.0)
            y = min(max(float(row) / max(height - 1, 1), 0.0), 1.0)
            coords.extend([f"{x:.6f}", f"{y:.6f}"])
        if len(coords) >= 6:
            lines.append(f"{class_id} " + " ".join(coords))
    return lines


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--volume", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/yolo-toothseg-slices"))
    parser.add_argument("--axes", nargs="+", default=["z", "y", "x"], choices=["z", "y", "x"])
    parser.add_argument("--stride", type=int, default=4)
    parser.add_argument("--min-area", type=int, default=80)
    parser.add_argument("--simplify-step", type=int, default=4)
    parser.add_argument("--val-every", type=int, default=5)
    parser.add_argument("--single-class", action="store_true", help="Use one 'tooth' class instead of 32 FDI classes.")
    args = parser.parse_args()

    volume = load(args.volume).astype(np.float32, copy=False)
    labels = load(args.labels).astype(np.int16, copy=False)
    if volume.shape != labels.shape:
        raise RuntimeError(f"shape mismatch: volume={volume.shape} labels={labels.shape}")

    root = args.output_dir
    for split in ("train", "val"):
        (root / "images" / split).mkdir(parents=True, exist_ok=True)
        (root / "labels" / split).mkdir(parents=True, exist_ok=True)

    exported = []
    sequence = 0
    for axis in args.axes:
        axis_len = {"z": volume.shape[0], "y": volume.shape[1], "x": volume.shape[2]}[axis]
        for index in range(0, axis_len, max(1, args.stride)):
            image_slice, label_slice = slice_pair(volume, labels, axis, index)
            lines = polygon_lines(label_slice, args.min_area, args.simplify_step, args.single_class)
            if not lines:
                continue
            split = "val" if sequence % max(2, args.val_every) == 0 else "train"
            stem = f"{axis}_{index:04d}"
            image_path = root / "images" / split / f"{stem}.png"
            label_path = root / "labels" / split / f"{stem}.txt"
            Image.fromarray(normalize(image_slice)).save(image_path)
            label_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            exported.append({"axis": axis, "index": index, "split": split, "objects": len(lines)})
            sequence += 1

    names = ["tooth"] if args.single_class else [f"fdi_{fdi}" for fdi in sorted(FDI_TO_CLASS)]
    data_yaml = {
        "path": ".",
        "train": "images/train",
        "val": "images/val",
        "names": {idx: name for idx, name in enumerate(names)},
    }
    yaml_text = "path: " + data_yaml["path"] + "\ntrain: images/train\nval: images/val\nnames:\n"
    for idx, name in data_yaml["names"].items():
        yaml_text += f"  {idx}: {name}\n"
    (root / "data.yaml").write_text(yaml_text, encoding="utf-8")
    summary = {
        "status": "ok",
        "volume": str(args.volume),
        "labels": str(args.labels),
        "outputDir": str(root),
        "singleClass": args.single_class,
        "classCount": len(names),
        "sliceCount": len(exported),
        "trainSlices": sum(1 for item in exported if item["split"] == "train"),
        "valSlices": sum(1 for item in exported if item["split"] == "val"),
        "objectCount": sum(int(item["objects"]) for item in exported),
        "axes": args.axes,
        "stride": args.stride,
        "minArea": args.min_area,
        "simplifyStep": args.simplify_step,
    }
    (root / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
