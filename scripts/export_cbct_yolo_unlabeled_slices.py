#!/usr/bin/env python3
"""Export unlabeled CBCT NIfTI volumes into YOLO image slices."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np
from PIL import Image


def normalize(image: np.ndarray) -> np.ndarray:
    lo, hi = np.percentile(image, [0.5, 99.5])
    scaled = np.clip((image - lo) / max(float(hi - lo), 1.0), 0, 1)
    return (scaled * 255).astype(np.uint8)


def slice_image(volume: np.ndarray, axis: str, index: int) -> np.ndarray:
    if axis == "z":
        return volume[index]
    if axis == "y":
        return volume[:, index, :]
    if axis == "x":
        return volume[:, :, index]
    raise ValueError(f"unsupported axis {axis}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--axes", nargs="+", default=["z"], choices=["z", "y", "x"])
    parser.add_argument("--stride", type=int, default=12)
    parser.add_argument("--max-cases", type=int, default=0)
    parser.add_argument("--case-glob", default="*/cbct/volume.nii.gz")
    args = parser.parse_args()

    volumes = sorted(args.input_root.glob(args.case_glob))
    if args.max_cases > 0:
        volumes = volumes[: args.max_cases]
    if not volumes:
        raise RuntimeError(f"no volumes found under {args.input_root}")

    image_dir = args.output_dir / "images"
    image_dir.mkdir(parents=True, exist_ok=True)

    exported = []
    for volume_path in volumes:
        case_id = volume_path.parts[-3]
        volume = np.asanyarray(nib.load(str(volume_path)).dataobj).astype(np.float32, copy=False)
        for axis in args.axes:
            axis_len = {"z": volume.shape[0], "y": volume.shape[1], "x": volume.shape[2]}[axis]
            for index in range(0, axis_len, max(1, args.stride)):
                image = normalize(slice_image(volume, axis, index))
                stem = f"{case_id}_{axis}_{index:04d}"
                Image.fromarray(image).convert("RGB").save(image_dir / f"{stem}.png")
                exported.append({"case": case_id, "axis": axis, "index": index})

    summary = {
        "status": "ok",
        "inputRoot": str(args.input_root),
        "outputDir": str(args.output_dir),
        "caseCount": len(volumes),
        "sliceCount": len(exported),
        "axes": args.axes,
        "stride": args.stride,
    }
    (args.output_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
