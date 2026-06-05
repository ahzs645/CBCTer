#!/usr/bin/env python3
"""Summarize label counts for ToothSeg NIfTI outputs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np


TOOTHSEG_LABEL_TO_FDI = {
    **{label: 10 + label for label in range(1, 9)},
    **{label: 20 + label - 8 for label in range(9, 17)},
    **{label: 30 + label - 16 for label in range(17, 25)},
    **{label: 40 + label - 24 for label in range(25, 33)},
}


def summarize(path: Path) -> dict:
    image = nib.load(str(path))
    data = np.asarray(image.dataobj)
    labels, counts = np.unique(data.astype(np.int32, copy=False), return_counts=True)
    rows = []
    for label, count in zip(labels.tolist(), counts.tolist(), strict=True):
        if label == 0:
            continue
        rows.append(
            {
                "label": int(label),
                "fdi": TOOTHSEG_LABEL_TO_FDI.get(int(label)),
                "voxels": int(count),
            }
        )
    return {
        "path": str(path),
        "shapeZYX": [int(value) for value in data.shape],
        "labels": rows,
        "labelCount": len(rows),
        "positiveVoxels": int(sum(row["voxels"] for row in rows)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    result = [summarize(path) for path in args.paths]
    payload = json.dumps(result, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload)
    print(payload)


if __name__ == "__main__":
    main()
