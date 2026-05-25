#!/usr/bin/env python3
"""Validate that a tooth-separation manifest is internally usable."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

try:
    from scipy import ndimage
except ImportError:  # pragma: no cover - validation still works without scipy.
    ndimage = None


def fail(message: str) -> None:
    raise SystemExit(f"validation failed: {message}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=Path("public/sample-segmentation-curated/manifest.json"))
    parser.add_argument("--min-labels", type=int, default=10)
    parser.add_argument("--min-accepted", type=int, default=8)
    parser.add_argument("--max-count-delta-ratio", type=float, default=0.015)
    args = parser.parse_args()

    if not args.manifest.exists():
        fail(f"manifest not found: {args.manifest}")
    root = args.manifest.parent
    manifest = json.load(args.manifest.open())
    items = manifest.get("items", [])

    if manifest.get("acceptedInstances") != len(items):
        fail("acceptedInstances does not match item count")
    if len(items) < args.min_labels:
        fail(f"only {len(items)} labels found, expected at least {args.min_labels}")
    accepted = [item for item in items if item.get("qualityStatus", "accepted") == "accepted"]
    if len(accepted) < args.min_accepted:
        fail(f"only {len(accepted)} accepted labels found, expected at least {args.min_accepted}")

    labels = [item.get("label") for item in items]
    if labels != list(range(1, len(items) + 1)):
        fail(f"labels are not sequential from 1: {labels}")

    for asset_key in ["preview", "contactSheet", "labels"]:
        path = root / manifest.get(asset_key, "")
        if not path.exists() or path.stat().st_size == 0:
            fail(f"missing manifest asset {asset_key}: {path}")

    labels_path = root / manifest["labels"]
    label_volume = np.load(labels_path)["labels"]
    if label_volume.ndim != 3:
        fail(f"labels volume is not 3D: {label_volume.shape}")
    if int(label_volume.max()) != len(items):
        fail(f"labels volume max label {int(label_volume.max())} does not match item count {len(items)}")

    present_labels = sorted(int(label) for label in np.unique(label_volume) if label > 0)
    if present_labels != labels:
        fail(f"labels volume contains {present_labels}, expected {labels}")

    measured_positive_voxels = int(np.count_nonzero(label_volume))
    expected_positive_voxels = int(sum(item.get("assignedVoxels", 0) for item in items))
    if measured_positive_voxels != expected_positive_voxels:
        fail(
            "labels volume positive voxel count does not match manifest "
            f"({measured_positive_voxels} != {expected_positive_voxels})"
        )

    for item in items:
        label = item["label"]
        for key in ["preview", "stl"]:
            path = root / item.get(key, "")
            if not path.exists() or path.stat().st_size == 0:
                fail(f"missing {key} for label {label}: {path}")
        if int(item.get("assignedVoxels", 0)) <= 0:
            fail(f"label {label} has no assigned voxels")
        if len(item.get("centroidZYX", [])) != 3:
            fail(f"label {label} missing centroidZYX")
        if len(item.get("bboxZYX", [])) != 6:
            fail(f"label {label} missing bboxZYX")
        if len(item.get("extentZYX", [])) != 3:
            fail(f"label {label} missing extentZYX")

        measured_voxels = int(np.count_nonzero(label_volume == label))
        assigned_voxels = int(item.get("assignedVoxels", 0))
        delta_ratio = abs(measured_voxels - assigned_voxels) / max(assigned_voxels, 1)
        if delta_ratio > args.max_count_delta_ratio:
            fail(
                f"label {label} voxel count mismatch: volume={measured_voxels}, "
                f"manifest={assigned_voxels}, delta={delta_ratio:.3f}"
            )

        bbox = item["bboxZYX"]
        coords = np.argwhere(label_volume == label)
        measured_bbox = [
            int(coords[:, 0].min()),
            int(coords[:, 1].min()),
            int(coords[:, 2].min()),
            int(coords[:, 0].max() + 1),
            int(coords[:, 1].max() + 1),
            int(coords[:, 2].max() + 1),
        ]
        if measured_bbox != bbox:
            fail(f"label {label} bbox mismatch: volume={measured_bbox}, manifest={bbox}")

        if ndimage is not None:
            _, components = ndimage.label(label_volume == label)
            if components < 1:
                fail(f"label {label} has no connected components")

    print(
        json.dumps(
            {
                "status": "ok",
                "manifest": str(args.manifest),
                "labels": len(items),
                "accepted": len(accepted),
                "review": len(items) - len(accepted),
                "positiveVoxels": measured_positive_voxels,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
