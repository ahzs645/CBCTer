#!/usr/bin/env python3
"""Run Slicer-style single ROI inference without writing full-volume labels."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from monai.inferers import SlidingWindowInferer
from monai.transforms import Compose, EnsureChannelFirst, NormalizeIntensity, SpatialPad
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage.measure import marching_cubes

from run_tooth_segmentation import build_model, load_volume, run_inference, write_ascii_stl


def projections(mask: np.ndarray, output: Path) -> None:
    views = [("sagittal", mask.sum(axis=2)), ("coronal", mask.sum(axis=1)), ("axial", mask.sum(axis=0))]
    canvas = Image.new("RGB", (540, 210), "#05070a")
    draw = ImageDraw.Draw(canvas)
    for index, (name, projection) in enumerate(views):
        if projection.max() > 0:
            array = (projection / projection.max() * 255).astype(np.uint8)
        else:
            array = np.zeros(projection.shape, dtype=np.uint8)
        image = Image.fromarray(array, mode="L").convert("RGB")
        image.thumbnail((170, 170), Image.Resampling.LANCZOS)
        x = index * 180 + (180 - image.width) // 2
        y = 24 + (170 - image.height) // 2
        canvas.paste(image, (x, y))
        draw.text((index * 180 + 8, 6), name, fill="#cbd5e1")
    canvas.save(output)


def metrics(mask: np.ndarray) -> dict[str, object]:
    coords = np.argwhere(mask > 0)
    components, component_count = ndi.label(mask > 0)
    sizes = np.bincount(components.ravel())
    if sizes.size:
        sizes[0] = 0
    if coords.size == 0:
        return {"voxels": 0, "components": 0, "largestComponentVoxels": 0, "extentZYX": [0, 0, 0]}
    extent = (coords.max(axis=0) + 1 - coords.min(axis=0)).astype(int).tolist()
    reasons = []
    if int(mask.sum()) < 4_000:
        reasons.append("low-volume")
    if min(extent) < 12:
        reasons.append("flat-or-clipped")
    if max(extent) / max(min(extent), 1) > 7:
        reasons.append("extreme-aspect")
    largest = int(sizes.max()) if sizes.size else 0
    if component_count > 80 and largest / max(int(mask.sum()), 1) < 0.985:
        reasons.append("fragmented")
    return {
        "voxels": int(mask.sum()),
        "components": int(component_count),
        "largestComponentVoxels": largest,
        "extentZYX": extent,
        "shapeStatus": "review" if reasons else "ok",
        "shapeReasons": reasons,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dicom-dir", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--roi", nargs=6, type=int, metavar=("Z0", "Y0", "X0", "Z1", "Y1", "X1"), required=True)
    parser.add_argument("--export-stl", action="store_true")
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    volume, metadata = load_volume(args.dicom_dir)
    z0, y0, x0, z1, y1, x1 = args.roi
    crop = volume[z0:z1, y0:y1, x0:x1].astype(np.float32)

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    model = build_model(device)
    model.load_state_dict(torch.load(args.model, map_location=device), strict=True)
    model.eval()
    pre_transforms = Compose(
        [
            EnsureChannelFirst(channel_dim="no_channel"),
            NormalizeIntensity(),
            SpatialPad(spatial_size=[144, 144, 144], mode="reflect"),
            EnsureChannelFirst(channel_dim="no_channel"),
        ]
    )
    inferer = SlidingWindowInferer(roi_size=[96, 96, 96])
    mask = run_inference(crop, model, inferer, pre_transforms, device).astype(np.uint8)
    np.savez_compressed(args.output_dir / "crop-mask.npz", mask=mask)
    projections(mask, args.output_dir / "projection.png")

    result = {
        "roiZYX": args.roi,
        "cropShapeZYX": list(crop.shape),
        "dicom": metadata,
        "slicerExact": True,
        **metrics(mask),
    }
    if args.export_stl and mask.sum() > 0:
        padded = np.pad(mask, 1)
        vertices, faces, _normals, _values = marching_cubes(padded, level=0.5)
        spacing = metadata["spacing"]
        spacing_zyx = np.array([spacing[2], spacing[0], spacing[1]], dtype=np.float32)
        vertices = (vertices - 1) * spacing_zyx
        write_ascii_stl(args.output_dir / "crop-mask.stl", vertices[:, [2, 1, 0]], faces)
        result["stl"] = "crop-mask.stl"

    (args.output_dir / "summary.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
