#!/usr/bin/env python3
"""Run the sample tooth-separation pipeline end to end."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATASET_ENV = "CBCTER_SAMPLE_DICOM_DIR"


def run(command: list[str]) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


def main() -> None:
    dataset = os.environ.get(DATASET_ENV)
    if not dataset:
        raise SystemExit(f"Set {DATASET_ENV} to the sample DICOM directory before running this pipeline.")

    output = ROOT / "outputs/sample-auto-segmentation"
    hybrid_output = ROOT / "outputs/sample-hybrid-segmentation"
    public = ROOT / "public/sample-segmentation"
    public_hybrid = ROOT / "public/sample-segmentation-hybrid"
    curated = ROOT / "public/sample-segmentation-curated"

    for path in [output, hybrid_output, public, public_hybrid, curated]:
        if path.exists():
            shutil.rmtree(path)

    run(
        [
            sys.executable,
            "scripts/run_tooth_segmentation.py",
            "--dicom-dir",
            dataset,
            "--model",
            "models/model-toothcrops-CBCT-normalize_best.pth",
            "--output-dir",
            "outputs/sample-auto-segmentation",
            "--auto-rois",
            "--export-stl",
        ]
    )

    run(
        [
            sys.executable,
            "scripts/run_tooth_segmentation.py",
            "--dicom-dir",
            dataset,
            "--model",
            "models/model-toothcrops-CBCT-normalize_best.pth",
            "--output-dir",
            "outputs/sample-hybrid-segmentation",
            "--hybrid-rois",
            "--max-rois",
            "32",
            "--export-stl",
        ]
    )

    shutil.copytree(output, public)
    shutil.copytree(hybrid_output, public_hybrid)
    run([sys.executable, "scripts/curate_tooth_separation.py"])
    run([sys.executable, "scripts/validate_tooth_separation.py"])


if __name__ == "__main__":
    main()
