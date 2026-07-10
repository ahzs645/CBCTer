#!/usr/bin/env python3
"""Export ToothFairy2 (.mha, nnU-Net style) FDI tooth labels into YOLO seg slices.

ToothFairy2 stores volumes as MetaImage (.mha) with whole-tooth labels using FDI
IDs 11-48 (plus non-tooth structures 1-10 which are ignored here). Reads via
SimpleITK (array order is z,y,x). Use --split to force every produced slice into a
single split, so callers can do a patient-level train/val holdout by running twice.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np
import SimpleITK as sitk
from PIL import Image
from skimage.measure import find_contours
from skimage.exposure import match_histograms

FDI_TEETH = [
    11, 12, 13, 14, 15, 16, 17, 18,
    21, 22, 23, 24, 25, 26, 27, 28,
    31, 32, 33, 34, 35, 36, 37, 38,
    41, 42, 43, 44, 45, 46, 47, 48,
]
FDI_TO_CLASS = {fdi: idx for idx, fdi in enumerate(FDI_TEETH)}


def _resample(img: "sitk.Image", target_spacing: float, is_label: bool) -> "sitk.Image":
    osp, osz = img.GetSpacing(), img.GetSize()
    nsz = [max(1, int(round(sz * sp / target_spacing))) for sz, sp in zip(osz, osp)]
    interp = sitk.sitkNearestNeighbor if is_label else sitk.sitkLinear
    return sitk.Resample(img, nsz, sitk.Transform(), interp, img.GetOrigin(),
                         (target_spacing,) * 3, img.GetDirection(), 0.0, img.GetPixelID())


def load(path: Path, target_spacing=None, is_label: bool = False) -> np.ndarray:
    img = sitk.ReadImage(str(path))
    if target_spacing is not None:
        img = _resample(img, float(target_spacing), is_label)
    return sitk.GetArrayFromImage(img)  # (z, y, x)


def normalize(image: np.ndarray, ct_window=None) -> np.ndarray:
    if ct_window is not None:
        lo, hi = ct_window  # fixed HU window (nnU-Net CTNormalization style), scanner-robust
    else:
        lo, hi = np.percentile(image, [0.5, 99.5])  # per-slice (NOT robust across scanners)
    scaled = np.clip((image - lo) / max(float(hi - lo), 1.0), 0, 1)
    return (scaled * 255).astype(np.uint8)


def slice_pair(volume, labels, axis, index):
    if axis == "z":
        return volume[index], labels[index]
    if axis == "y":
        return volume[:, index, :], labels[:, index, :]
    if axis == "x":
        return volume[:, :, index], labels[:, :, index]
    raise ValueError(f"unsupported axis {axis}")


def image_context(volume, axis, index, context_slices, ct_window=None):
    """Return neighbor/center/neighbor slices as RGB for 2.5D inference."""
    axis_len = {"z": volume.shape[0], "y": volume.shape[1], "x": volume.shape[2]}[axis]
    offset = max(0, int(context_slices))
    indices = [
        max(0, min(axis_len - 1, index - offset)),
        index,
        max(0, min(axis_len - 1, index + offset)),
    ]
    channels = [normalize(slice_pair(volume, volume, axis, i)[0], ct_window) for i in indices]
    return Image.fromarray(np.stack(channels, axis=-1), mode="RGB")


def polygon_lines(label_slice, min_area, simplify_step, single_class=False):
    lines = []
    height, width = label_slice.shape
    for label_value in sorted(int(v) for v in np.unique(label_slice) if int(v) > 0):
        if label_value not in FDI_TO_CLASS:
            continue
        mask = label_slice == label_value
        if int(np.count_nonzero(mask)) < min_area:
            continue
        class_id = 0 if single_class else FDI_TO_CLASS[label_value]
        contours = find_contours(mask.astype(np.uint8), 0.5)
        if not contours:
            continue
        contour = max(contours, key=len)
        if len(contour) < 6:
            continue
        contour = contour[:: max(1, simplify_step)]
        if len(contour) < 3:
            continue
        coords = []
        for row, col in contour:
            x = min(max(float(col) / max(width - 1, 1), 0.0), 1.0)
            y = min(max(float(row) / max(height - 1, 1), 0.0), 1.0)
            coords.extend([f"{x:.6f}", f"{y:.6f}"])
        if len(coords) >= 6:
            lines.append(f"{class_id} " + " ".join(coords))
    return lines


def write_data_yaml(root: Path, single_class=False) -> None:
    text = "path: .\ntrain: images/train\nval: images/val\nnames:\n"
    if single_class:
        text += "  0: tooth\n"
    else:
        for idx, fdi in enumerate(FDI_TEETH):
            text += f"  {idx}: fdi_{fdi}\n"
    (root / "data.yaml").write_text(text, encoding="utf-8")


def _strip_ext(name: str) -> str:
    return re.sub(r"\.(mha|nii\.gz|nii)$", "", name)


def discover_pairs(dataset_dir: Path):
    image_dir = dataset_dir / "imagesTr"
    label_dir = dataset_dir / "labelsTr"
    images = []
    for ext in ("*.mha", "*.nii.gz", "*.nii"):
        images.extend(sorted(image_dir.glob(ext)))
    pairs = []
    for image_path in sorted(images):
        case_id = re.sub(r"_0000$", "", _strip_ext(image_path.name))
        label_path = None
        for lext in (".mha", ".nii.gz", ".nii"):
            cand = label_dir / f"{case_id}{lext}"
            if cand.exists():
                label_path = cand
                break
        if label_path is not None:
            pairs.append((case_id, image_path, label_path))
    return pairs


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--dataset-dir", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--split", choices=["train", "val"], required=True)
    p.add_argument("--axes", nargs="+", default=["z", "y", "x"], choices=["z", "y", "x"])
    p.add_argument("--stride", type=int, default=6)
    p.add_argument("--min-area", type=int, default=80)
    p.add_argument("--simplify-step", type=int, default=4)
    p.add_argument("--cases", nargs="+", default=None, help="explicit case ids for this split")
    p.add_argument("--histmatch-ref", type=Path, default=None,
                   help="match each volume's intensity histogram to this reference volume before slicing")
    p.add_argument("--ct-window", nargs=2, type=float, default=None, metavar=("LO", "HI"),
                   help="fixed HU window for normalization (e.g. -113.8 4021), scanner-robust like nnU-Net")
    p.add_argument("--target-spacing", type=float, default=None,
                   help="resample every volume to this isotropic mm/voxel before slicing (matches nnU-Net; "
                        "makes teeth the same pixel scale across scanners)")
    p.add_argument("--single-class", action="store_true",
                   help="map all FDI teeth to one 'tooth' class (offload numbering to 3D assembly)")
    p.add_argument(
        "--context-slices",
        type=int,
        default=0,
        help=(
            "Use center-offset/center/center+offset as RGB. With --target-spacing 0.3, "
            "an offset of 2 supplies +/-0.6 mm context."
        ),
    )
    args = p.parse_args()

    ref_volume = None
    if args.histmatch_ref is not None:
        ref_volume = load(args.histmatch_ref).astype(np.float32, copy=False)
        print(f"[histmatch] reference {args.histmatch_ref.name} loaded")

    pairs = discover_pairs(args.dataset_dir)
    if args.cases:
        wanted = set(args.cases)
        pairs = [pr for pr in pairs if pr[0] in wanted]
    if not pairs:
        raise RuntimeError(f"no matching .mha pairs under {args.dataset_dir}")

    root = args.output_dir
    (root / "images" / args.split).mkdir(parents=True, exist_ok=True)
    (root / "labels" / args.split).mkdir(parents=True, exist_ok=True)

    exported = 0
    for case_id, image_path, label_path in pairs:
        volume = load(image_path, args.target_spacing, is_label=False).astype(np.float32, copy=False)
        if ref_volume is not None:
            volume = match_histograms(volume, ref_volume).astype(np.float32, copy=False)
        labels = load(label_path, args.target_spacing, is_label=True).astype(np.int16, copy=False)
        if volume.shape != labels.shape:
            print(f"[skip] shape mismatch {case_id}: {volume.shape} vs {labels.shape}")
            continue
        for axis in args.axes:
            axis_len = {"z": volume.shape[0], "y": volume.shape[1], "x": volume.shape[2]}[axis]
            for index in range(0, axis_len, max(1, args.stride)):
                image_slice, label_slice = slice_pair(volume, labels, axis, index)
                lines = polygon_lines(label_slice, args.min_area, args.simplify_step, args.single_class)
                if not lines:
                    continue
                stem = f"{case_id}_{axis}_{index:04d}"
                image_context(volume, axis, index, args.context_slices, args.ct_window).save(
                    root / "images" / args.split / f"{stem}.png"
                )
                (root / "labels" / args.split / f"{stem}.txt").write_text(
                    "\n".join(lines) + "\n", encoding="utf-8"
                )
                exported += 1
        print(f"[{case_id}] done; running slice total={exported}")

    write_data_yaml(root, args.single_class)
    summary = {
        "status": "ok",
        "split": args.split,
        "caseCount": len(pairs),
        "sliceCount": exported,
        "axes": args.axes,
        "stride": args.stride,
        "contextSlices": args.context_slices,
        "contextMm": (
            args.context_slices * args.target_spacing
            if args.target_spacing is not None
            else None
        ),
    }
    (root / f"summary_{args.split}.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
