#!/usr/bin/env python3
"""Run the RAIL/RailNet ROI detector on a NIfTI volume.

This is a practical local feasibility test, not the final RAIL pipeline. The
upstream demo expects normalized H5 data and hardcodes CUDA. We patch CUDA calls
to CPU, resize the input to the sample model shape, run only the ROI detector,
and write a NIfTI mask plus a JSON summary.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import nibabel as nib
import numpy as np
import torch
from scipy.ndimage import zoom
from skimage import morphology


def patch_cuda_to_cpu() -> None:
    torch.nn.Module.cuda = lambda self, *args, **kwargs: self  # type: ignore[method-assign]
    torch.Tensor.cuda = lambda self, *args, **kwargs: self  # type: ignore[method-assign]


def normalize_like_rail(data: np.ndarray, clip_min: float, clip_max: float) -> np.ndarray:
    data = np.clip(data.astype(np.float32), clip_min, clip_max)
    data = (data - clip_min) / max(clip_max - clip_min, 1e-6)
    return data.astype(np.float32)


def resize_to_shape(data: np.ndarray, shape: tuple[int, int, int], order: int) -> np.ndarray:
    factors = [target / source for target, source in zip(shape, data.shape, strict=True)]
    return zoom(data, factors, order=order).astype(np.float32)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--rail-root", type=Path, default=Path("external/RAIL-HF"))
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/railnet-cbct-aug2025"))
    parser.add_argument("--shape", default="400,400,280")
    parser.add_argument("--clip-min", type=float, default=-1000.0)
    parser.add_argument("--clip-max", type=float, default=2500.0)
    args = parser.parse_args()

    target_shape = tuple(int(part) for part in args.shape.split(","))
    if len(target_shape) != 3:
        raise SystemExit("--shape must be Z,Y,X as three comma-separated integers")

    patch_cuda_to_cpu()
    sys.path.insert(0, str(args.rail_root.resolve()))
    from railnet_model import VNet_roi, roi_detection  # noqa: PLC0415

    image = nib.load(str(args.input))
    raw = np.asarray(image.dataobj)
    normalized = normalize_like_rail(raw, args.clip_min, args.clip_max)
    resized = resize_to_shape(normalized, target_shape, order=1)

    net_roi = VNet_roi(
        n_channels=1,
        n_classes=2,
        normalization="batchnorm",
        has_dropout=False,
    )
    weights = args.rail_root / "model weights" / "roi_best_model.pth"
    net_roi.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True))
    net_roi.eval()

    # Match upstream roi_extraction: run on every second voxel, then scale back.
    small = resized[0 : resized.shape[0] : 2, 0 : resized.shape[1] : 2, 0 : resized.shape[2] : 2]
    mask_small = roi_detection(
        net_roi,
        small,
        stride_xy=32,
        stride_z=16,
        patch_size=(112, 112, 80),
    )
    mask = resize_to_shape(mask_small.astype(np.float32), target_shape, order=0) > 0.5
    cleaned = morphology.remove_small_objects(mask, 5000, connectivity=3)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    mask_path = args.output_dir / "railnet_roi_mask.nii.gz"
    nib.save(nib.Nifti1Image(cleaned.astype(np.uint8), np.eye(4)), str(mask_path))

    coords = np.argwhere(cleaned)
    if coords.size:
        z0, y0, x0 = coords.min(axis=0).tolist()
        z1, y1, x1 = (coords.max(axis=0) + 1).tolist()
        bbox = [z0, y0, x0, z1, y1, x1]
    else:
        bbox = None
    result = {
        "status": "ok",
        "input": str(args.input),
        "outputMask": str(mask_path),
        "inputShape": [int(v) for v in raw.shape],
        "targetShape": list(target_shape),
        "smallShape": [int(v) for v in small.shape],
        "clip": [args.clip_min, args.clip_max],
        "positiveVoxels": int(cleaned.sum()),
        "positiveFraction": float(cleaned.mean()),
        "bboxZYX": bbox,
        "note": "RAIL ROI detector only; not FDI instances and not full segmentation ensemble.",
    }
    summary_path = args.output_dir / "railnet_roi_summary.json"
    summary_path.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
