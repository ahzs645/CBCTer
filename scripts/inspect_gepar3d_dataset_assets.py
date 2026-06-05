#!/usr/bin/env python3
"""Inspect GEPAR3D dataset archives or extracted folders."""

from __future__ import annotations

import argparse
import json
import tempfile
import zipfile
from pathlib import Path

import nibabel as nib
import numpy as np


NIFTI_SUFFIXES = (".nii", ".nii.gz")


def is_nifti(path: Path) -> bool:
    return str(path).endswith(NIFTI_SUFFIXES)


def summarize_nifti(path: Path) -> dict:
    image = nib.load(str(path))
    data = np.asarray(image.dataobj)
    labels, counts = np.unique(data.astype(np.int32, copy=False), return_counts=True)
    nonzero = [
        {"label": int(label), "voxels": int(count)}
        for label, count in zip(labels.tolist(), counts.tolist(), strict=True)
        if int(label) != 0
    ]
    return {
        "path": str(path),
        "shape": [int(value) for value in data.shape],
        "spacing": [float(value) for value in image.header.get_zooms()[:3]],
        "labelCount": len(nonzero),
        "positiveVoxels": int(sum(row["voxels"] for row in nonzero)),
        "labels": nonzero[:64],
    }


def inspect_folder(root: Path, max_nifti: int) -> dict:
    nifti_files = sorted(path for path in root.rglob("*") if path.is_file() and is_nifti(path))
    return {
        "root": str(root),
        "niftiCount": len(nifti_files),
        "sampleNifti": [summarize_nifti(path) for path in nifti_files[:max_nifti]],
    }


def inspect_zip(path: Path, max_nifti: int) -> dict:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        nifti_names = [name for name in names if name.endswith(NIFTI_SUFFIXES)]
        result = {
            "archive": str(path),
            "fileCount": len(names),
            "niftiCount": len(nifti_names),
            "firstFiles": names[:40],
            "sampleNifti": [],
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            for name in nifti_names[:max_nifti]:
                archive.extract(name, tmp)
                result["sampleNifti"].append(summarize_nifti(tmp / name))
        return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--max-nifti", type=int, default=3)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    results = []
    for path in args.paths:
        if path.is_dir():
            results.append(inspect_folder(path, args.max_nifti))
        elif zipfile.is_zipfile(path):
            results.append(inspect_zip(path, args.max_nifti))
        else:
            raise SystemExit(f"Unsupported path: {path}")

    payload = json.dumps(results, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload)
    print(payload)


if __name__ == "__main__":
    main()
