#!/usr/bin/env python3
"""Compare CPU-friendly tooth masks to ToothSeg and report recovery candidates.

The first use case is RAIL's binary tooth ROI versus ToothSeg's FDI instance
mask. RAIL is not an instance model, but residual regions outside ToothSeg can
show whether another non-NVIDIA model sees anatomy ToothSeg missed.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage as ndi


def load_array(path: Path) -> tuple[np.ndarray, tuple[float, float, float]]:
    image = nib.load(str(path))
    data = np.asanyarray(image.dataobj)
    zooms = tuple(float(v) for v in image.header.get_zooms()[:3])
    return data, zooms


def resize_nearest(mask: np.ndarray, shape: tuple[int, int, int]) -> np.ndarray:
    if mask.shape == shape:
        return mask
    factors = [target / source for target, source in zip(shape, mask.shape)]
    return ndi.zoom(mask, factors, order=0)[: shape[0], : shape[1], : shape[2]]


def component_rows(labels: np.ndarray, count: int, spacing: tuple[float, float, float]) -> list[dict]:
    rows: list[dict] = []
    objects = ndi.find_objects(labels)
    voxel_volume = float(np.prod(spacing))
    for idx, slc in enumerate(objects, start=1):
        if slc is None:
            continue
        voxels = int(np.count_nonzero(labels[slc] == idx))
        coords = np.argwhere(labels[slc] == idx)
        offset = np.array([s.start for s in slc], dtype=float)
        centroid = coords.mean(axis=0) + offset
        bbox = [int(s.start) for s in slc] + [int(s.stop) for s in slc]
        rows.append(
            {
                "component": idx,
                "voxels": voxels,
                "volumeMm3": voxels * voxel_volume,
                "centroidZYX": [round(float(v), 2) for v in centroid],
                "bboxZYX": bbox,
            }
        )
    rows.sort(key=lambda row: row["voxels"], reverse=True)
    return rows


def toothseg_centroids(labels: np.ndarray) -> list[dict]:
    rows: list[dict] = []
    for value in sorted(int(v) for v in np.unique(labels) if int(v) > 0):
        coords = np.argwhere(labels == value)
        if coords.size == 0:
            continue
        rows.append(
            {
                "label": value,
                "voxels": int(coords.shape[0]),
                "centroidZYX": [round(float(v), 2) for v in coords.mean(axis=0)],
            }
        )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--toothseg", type=Path, required=True)
    parser.add_argument("--rail", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--dilate-iterations", type=int, default=4)
    parser.add_argument("--min-voxels", type=int, default=5000)
    args = parser.parse_args()

    toothseg, spacing = load_array(args.toothseg)
    rail, _ = load_array(args.rail)

    toothseg_labels = toothseg.astype(np.int16, copy=False)
    toothseg_mask = toothseg_labels > 0
    rail_mask = resize_nearest(rail > 0, toothseg_mask.shape)

    structure = ndi.generate_binary_structure(3, 1)
    gated_toothseg = ndi.binary_dilation(
        toothseg_mask, structure=structure, iterations=max(0, args.dilate_iterations)
    )
    residual = rail_mask & ~gated_toothseg
    residual = ndi.binary_opening(residual, structure=structure, iterations=1)

    components, count = ndi.label(residual, structure=structure)
    rows = [row for row in component_rows(components, count, spacing) if row["voxels"] >= args.min_voxels]

    payload = {
        "status": "ok",
        "toothseg": str(args.toothseg),
        "rail": str(args.rail),
        "toothsegShape": list(toothseg_mask.shape),
        "railOriginalShape": list(rail.shape),
        "railResizedShape": list(rail_mask.shape),
        "spacingZYX": list(spacing),
        "dilateIterations": args.dilate_iterations,
        "minVoxels": args.min_voxels,
        "toothsegPositiveVoxels": int(np.count_nonzero(toothseg_mask)),
        "railPositiveVoxelsResized": int(np.count_nonzero(rail_mask)),
        "railOverlapToothSegVoxels": int(np.count_nonzero(rail_mask & toothseg_mask)),
        "residualPositiveVoxels": int(np.count_nonzero(residual)),
        "candidateCount": len(rows),
        "candidates": rows[:50],
        "toothsegCentroids": toothseg_centroids(toothseg_labels),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps({k: payload[k] for k in ("status", "candidateCount", "residualPositiveVoxels")}, indent=2))


if __name__ == "__main__":
    main()
