#!/usr/bin/env python3
"""Export nnU-Net dental CBCT labels into YOLO segmentation slice datasets.

Designed for ToothFairy3-style datasets where whole-tooth labels use FDI IDs
11-48 and pulp labels may use FDI + 100. Pulp labels are ignored by default.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import nibabel as nib
import numpy as np
from PIL import Image
from skimage.measure import find_contours

FDI_TEETH = [
    11,
    12,
    13,
    14,
    15,
    16,
    17,
    18,
    21,
    22,
    23,
    24,
    25,
    26,
    27,
    28,
    31,
    32,
    33,
    34,
    35,
    36,
    37,
    38,
    41,
    42,
    43,
    44,
    45,
    46,
    47,
    48,
]
FDI_TO_CLASS = {fdi: idx for idx, fdi in enumerate(FDI_TEETH)}


def load(path: Path) -> np.ndarray:
    return np.asanyarray(nib.load(str(path)).dataobj)


def normalize(image: np.ndarray) -> np.ndarray:
    lo, hi = np.percentile(image, [0.5, 99.5])
    scaled = np.clip((image - lo) / max(float(hi - lo), 1.0), 0, 1)
    return (scaled * 255).astype(np.uint8)


def case_id_from_image(path: Path) -> str:
    name = path.name
    name = re.sub(r"\.nii(\.gz)?$", "", name)
    name = re.sub(r"_0000$", "", name)
    return name


def discover_pairs(dataset_dir: Path) -> list[tuple[str, Path, Path]]:
    image_dirs = [dataset_dir / "imagesTr", dataset_dir / "images"]
    label_dirs = [dataset_dir / "labelsTr", dataset_dir / "labels"]
    image_dir = next((p for p in image_dirs if p.exists()), None)
    label_dir = next((p for p in label_dirs if p.exists()), None)
    if image_dir is None or label_dir is None:
        raise RuntimeError("expected imagesTr/labelsTr or images/labels under dataset dir")

    labels = {re.sub(r"\.nii(\.gz)?$", "", p.name): p for p in sorted(label_dir.glob("*.nii*"))}
    pairs: list[tuple[str, Path, Path]] = []
    for image_path in sorted(image_dir.glob("*.nii*")):
        case_id = case_id_from_image(image_path)
        label_path = labels.get(case_id)
        if label_path is not None:
            pairs.append((case_id, image_path, label_path))
    if not pairs:
        raise RuntimeError(f"no image/label pairs found in {dataset_dir}")
    return pairs


def slice_pair(volume: np.ndarray, labels: np.ndarray, axis: str, index: int) -> tuple[np.ndarray, np.ndarray]:
    if axis == "z":
        return volume[index], labels[index]
    if axis == "y":
        return volume[:, index, :], labels[:, index, :]
    if axis == "x":
        return volume[:, :, index], labels[:, :, index]
    raise ValueError(f"unsupported axis {axis}")


def label_to_fdi(label_value: int, include_pulp: bool) -> int | None:
    if label_value in FDI_TO_CLASS:
        return label_value
    if include_pulp and label_value - 100 in FDI_TO_CLASS:
        return label_value - 100
    return None


def polygon_lines(
    label_slice: np.ndarray,
    min_area: int,
    simplify_step: int,
    single_class: bool,
    include_pulp: bool,
) -> list[str]:
    lines: list[str] = []
    height, width = label_slice.shape
    for label_value in sorted(int(v) for v in np.unique(label_slice) if int(v) > 0):
        fdi = label_to_fdi(label_value, include_pulp)
        if fdi is None:
            continue
        mask = label_slice == label_value
        if int(np.count_nonzero(mask)) < min_area:
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


def write_data_yaml(root: Path, single_class: bool) -> None:
    names = ["tooth"] if single_class else [f"fdi_{fdi}" for fdi in FDI_TEETH]
    yaml_text = "path: .\ntrain: images/train\nval: images/val\nnames:\n"
    for idx, name in enumerate(names):
        yaml_text += f"  {idx}: {name}\n"
    (root / "data.yaml").write_text(yaml_text, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--axes", nargs="+", default=["z"], choices=["z", "y", "x"])
    parser.add_argument("--stride", type=int, default=6)
    parser.add_argument("--min-area", type=int, default=80)
    parser.add_argument("--simplify-step", type=int, default=4)
    parser.add_argument("--val-every", type=int, default=5)
    parser.add_argument("--max-cases", type=int, default=0)
    parser.add_argument("--single-class", action="store_true")
    parser.add_argument("--include-pulp", action="store_true")
    args = parser.parse_args()

    pairs = discover_pairs(args.dataset_dir)
    if args.max_cases > 0:
        pairs = pairs[: args.max_cases]

    root = args.output_dir
    for split in ("train", "val"):
        (root / "images" / split).mkdir(parents=True, exist_ok=True)
        (root / "labels" / split).mkdir(parents=True, exist_ok=True)

    exported = []
    sequence = 0
    for case_id, image_path, label_path in pairs:
        volume = load(image_path).astype(np.float32, copy=False)
        labels = load(label_path).astype(np.int16, copy=False)
        if volume.shape != labels.shape:
            raise RuntimeError(f"shape mismatch for {case_id}: volume={volume.shape} labels={labels.shape}")
        for axis in args.axes:
            axis_len = {"z": volume.shape[0], "y": volume.shape[1], "x": volume.shape[2]}[axis]
            for index in range(0, axis_len, max(1, args.stride)):
                image_slice, label_slice = slice_pair(volume, labels, axis, index)
                lines = polygon_lines(
                    label_slice,
                    args.min_area,
                    args.simplify_step,
                    args.single_class,
                    args.include_pulp,
                )
                if not lines:
                    continue
                split = "val" if sequence % max(2, args.val_every) == 0 else "train"
                stem = f"{case_id}_{axis}_{index:04d}"
                image_path_out = root / "images" / split / f"{stem}.png"
                label_path_out = root / "labels" / split / f"{stem}.txt"
                Image.fromarray(normalize(image_slice)).convert("RGB").save(image_path_out)
                label_path_out.write_text("\n".join(lines) + "\n", encoding="utf-8")
                exported.append({"case": case_id, "axis": axis, "index": index, "split": split, "objects": len(lines)})
                sequence += 1

    write_data_yaml(root, args.single_class)
    summary = {
        "status": "ok",
        "datasetDir": str(args.dataset_dir),
        "outputDir": str(root),
        "caseCount": len(pairs),
        "singleClass": args.single_class,
        "includePulp": args.include_pulp,
        "classCount": 1 if args.single_class else len(FDI_TEETH),
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
