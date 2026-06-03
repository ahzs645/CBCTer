#!/usr/bin/env python3
"""Recover ToothSeg semantic labels swallowed by instance majority assignment."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import SimpleITK as sitk


def largest_component(mask: np.ndarray) -> np.ndarray:
    try:
        from scipy import ndimage as ndi
    except Exception:
        return mask

    components, count = ndi.label(mask)
    if count <= 1:
        return mask
    sizes = np.bincount(components.ravel())
    sizes[0] = 0
    return components == int(sizes.argmax())


def remove_small_components(labels: np.ndarray, min_component_voxels: int) -> tuple[np.ndarray, list[dict[str, int]]]:
    if min_component_voxels <= 0:
        return labels, []
    try:
        from scipy import ndimage as ndi
    except Exception:
        return labels, []

    cleaned = labels.copy()
    removed: list[dict[str, int]] = []
    for label in sorted(int(v) for v in np.unique(labels) if v):
        coords = np.argwhere(labels == label)
        if coords.size == 0:
            continue
        z0, y0, x0 = coords.min(axis=0)
        z1, y1, x1 = coords.max(axis=0) + 1
        crop = labels[z0:z1, y0:y1, x0:x1] == label
        components, count = ndi.label(crop)
        if count <= 1:
            continue
        sizes = np.bincount(components.ravel())
        sizes[0] = 0
        cleaned_crop = cleaned[z0:z1, y0:y1, x0:x1]
        for component_id, size in enumerate(sizes):
            if component_id == 0 or size == 0 or size >= min_component_voxels:
                continue
            cleaned_crop[components == component_id] = 0
            removed.append({"label": label, "voxels": int(size)})
    return cleaned, removed


def summarize_removed_components(removed: list[dict[str, int]]) -> list[dict[str, int]]:
    summary: dict[int, dict[str, int]] = {}
    for item in removed:
        label = int(item["label"])
        row = summary.setdefault(label, {"label": label, "components": 0, "voxels": 0, "largestRemoved": 0})
        row["components"] += 1
        row["voxels"] += int(item["voxels"])
        row["largestRemoved"] = max(row["largestRemoved"], int(item["voxels"]))
    return [summary[label] for label in sorted(summary)]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--semantic", type=Path, required=True)
    parser.add_argument("--final", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--min-voxels", type=int, default=10000)
    parser.add_argument(
        "--min-component-voxels",
        type=int,
        default=500,
        help="Remove disconnected islands smaller than this after recovery.",
    )
    parser.add_argument("--max-labels", type=int, default=32)
    args = parser.parse_args()

    semantic_itk = sitk.ReadImage(str(args.semantic))
    final_itk = sitk.ReadImage(str(args.final))
    semantic = sitk.GetArrayFromImage(semantic_itk).astype(np.uint16)
    recovered = sitk.GetArrayFromImage(final_itk).astype(np.uint16)

    if semantic.shape != recovered.shape:
        raise RuntimeError(f"Shape mismatch: semantic {semantic.shape} final {recovered.shape}")

    final_labels = set(int(v) for v in np.unique(recovered) if v)
    report = {
        "semantic": str(args.semantic),
        "input": str(args.final),
        "output": str(args.output),
        "minVoxels": args.min_voxels,
        "minComponentVoxels": args.min_component_voxels,
        "recovered": [],
        "removedSmallComponents": [],
        "alreadyPresent": sorted(final_labels),
        "semanticAbsent": [],
    }

    for label in range(1, args.max_labels + 1):
        semantic_mask = semantic == label
        semantic_voxels = int(semantic_mask.sum())
        if semantic_voxels == 0:
            report["semanticAbsent"].append(label)
            continue
        if label in final_labels or semantic_voxels < args.min_voxels:
            continue

        component_mask = largest_component(semantic_mask)
        component_voxels = int(component_mask.sum())
        previous_values, previous_counts = np.unique(recovered[component_mask], return_counts=True)
        overwritten = [
            {"label": int(value), "voxels": int(count)}
            for value, count in zip(previous_values, previous_counts)
            if int(value) != 0
        ]
        recovered[component_mask] = label
        final_labels.add(label)
        report["recovered"].append(
            {
                "label": label,
                "semanticVoxels": semantic_voxels,
                "recoveredVoxels": component_voxels,
                "overwritten": overwritten,
            }
        )

    recovered, removed_components = remove_small_components(recovered, args.min_component_voxels)
    report["removedSmallComponents"] = summarize_removed_components(removed_components)

    output_itk = sitk.GetImageFromArray(recovered)
    output_itk.CopyInformation(final_itk)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sitk.WriteImage(output_itk, str(args.output), compressionLevel=8)
    args.output.with_suffix("").with_suffix(".recovery.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
