#!/usr/bin/env python3
"""Read-only Colab/Drive inventory for CBCTer training notebooks.

Run inside a Colab VM after Drive is mounted at /content/drive. It checks the
exact Drive paths used by the training notebooks and writes a compact JSON
summary into MyDrive/cbct-outputs for review.
"""

from __future__ import annotations

import glob
import json
import os
import platform
import subprocess
import time
import zipfile
from pathlib import Path
from typing import Any


MYDRIVE = Path("/content/drive/MyDrive")
NAS = MYDRIVE / "UniFi Drive_UNAS Pro 8/UNAS Pro 8_Main Backup/Main/cbct"
WORK = MYDRIVE / "Projects/Health/CBCT/cbct-notebook"
OUT = MYDRIVE / "Projects/Health/CBCT/cbct-outputs"

EXPECTED = {
    "nas_root": NAS,
    "work_root": WORK,
    "outputs_root": OUT,
    "tf2_zip": NAS / "datasets/ToothFairy2_Dataset.zip",
    "tf4_zip": NAS / "datasets/toothfairy4.zip",
    "ctnorm_bundle": NAS / "bundles/yolo-ctnorm-bundle.tgz",
    "toothseg_checkpoints": NAS / "checkpoints/nnUNet_results/ToothSeg",
    "exporter": WORK / "export_toothfairy2_mha_yolo_slices.py",
    "clinic_dataset": WORK / "clinic-raw/Dataset_clinic",
    "clinic_image_hardcoded": WORK / "clinic-raw/Dataset_clinic/imagesTr/cbct_aug2025_0000.nii.gz",
    "clinic_label_hardcoded": WORK / "clinic-raw/Dataset_clinic/labelsTr/cbct_aug2025.nii.gz",
}

OUTPUT_RUNS = [
    OUT / "fdi-tf2-ctnorm",
    OUT / "fdi-spaced",
    OUT / "fdi-1cls",
    OUT / "fdi-distill",
    WORK.parent / "cbct-outputs/fdi-tf2-ctnorm",
    WORK.parent / "cbct-outputs/fdi-spaced",
    WORK.parent / "cbct-outputs/fdi-1cls",
    WORK.parent / "cbct-outputs/fdi-distill",
]

NOTEBOOK_CANDIDATE_DIRS = [
    WORK / "notebooks",
    OUT / "notebooks",
    NAS / "notebooks",
    MYDRIVE / "CBCTer/notebooks",
    MYDRIVE / "github/CBCTer/notebooks",
]


def stat_path(path: Path) -> dict[str, Any]:
    exists = path.exists()
    info: dict[str, Any] = {
        "path": str(path),
        "exists": exists,
    }
    if exists:
        st = path.stat()
        info.update(
            {
                "isDir": path.is_dir(),
                "bytes": st.st_size if path.is_file() else None,
                "modified": time.strftime(
                    "%Y-%m-%d %H:%M:%S", time.localtime(st.st_mtime)
                ),
            }
        )
    return info


def count_glob(root: Path, pattern: str) -> dict[str, Any]:
    paths = sorted(glob.glob(str(root / pattern)))
    return {
        "pattern": str(root / pattern),
        "count": len(paths),
        "sample": paths[:10],
    }


def zip_summary(path: Path, kind: str) -> dict[str, Any]:
    summary = stat_path(path)
    if not path.exists():
        return summary
    try:
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
            if kind == "tf2":
                images = [
                    n
                    for n in names
                    if "/imagesTr/" in n and n.endswith("_0000.mha")
                ]
                labels = [n for n in names if "/labelsTr/" in n and n.endswith(".mha")]
            elif kind == "tf4":
                images = [n for n in names if n.endswith("volume.nii.gz")]
                labels = [n for n in names if "label" in n.lower() or "mask" in n.lower()]
            else:
                images = []
                labels = []
            summary.update(
                {
                    "zipEntries": len(names),
                    "imageCount": len(images),
                    "labelCount": len(labels),
                    "imageSample": images[:10],
                    "labelSample": labels[:10],
                }
            )
    except Exception as exc:  # noqa: BLE001 - diagnostic script
        summary["error"] = f"{type(exc).__name__}: {exc}"
    return summary


def run_summary(path: Path) -> dict[str, Any]:
    info = stat_path(path)
    if not path.exists():
        return info
    info["files"] = {
        "best.pt": stat_path(path / "best.pt"),
        "best.onnx": stat_path(path / "best.onnx"),
        "args.yaml": stat_path(path / "args.yaml"),
        "results.csv": stat_path(path / "results.csv"),
    }
    return info


def shell(command: list[str]) -> str:
    try:
        return subprocess.check_output(command, stderr=subprocess.STDOUT, text=True).strip()
    except Exception as exc:  # noqa: BLE001 - diagnostic script
        return f"{type(exc).__name__}: {exc}"


def main() -> None:
    if not MYDRIVE.exists():
        raise SystemExit(
            "Drive is not mounted. Run `from google.colab import drive; "
            "drive.mount('/content/drive')` in Colab, or `colab drivemount -s <session>`."
        )

    OUT.mkdir(parents=True, exist_ok=True)

    report: dict[str, Any] = {
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "runtime": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "cwd": os.getcwd(),
            "gpu": shell(["bash", "-lc", "nvidia-smi -L || true"]),
            "driveMounted": MYDRIVE.exists(),
        },
        "expectedPaths": {name: stat_path(path) for name, path in EXPECTED.items()},
        "datasets": {
            "toothfairy2": zip_summary(EXPECTED["tf2_zip"], "tf2"),
            "toothfairy4": zip_summary(EXPECTED["tf4_zip"], "tf4"),
        },
        "clinic": {
            "imagesTr": count_glob(EXPECTED["clinic_dataset"], "imagesTr/*"),
            "labelsTr": count_glob(EXPECTED["clinic_dataset"], "labelsTr/*"),
            "niftiImages": count_glob(EXPECTED["clinic_dataset"], "imagesTr/*.nii*"),
            "niftiLabels": count_glob(EXPECTED["clinic_dataset"], "labelsTr/*.nii*"),
        },
        "toothsegCheckpoints": {
            "semanticBranches": count_glob(
                EXPECTED["toothseg_checkpoints"],
                "**/Dataset121_ToothFairy2_Teeth/**/checkpoint*.pth",
            ),
            "instanceBranches": count_glob(
                EXPECTED["toothseg_checkpoints"],
                "**/Dataset123_ToothFairy2fixed_teeth_spacing02_brd3px/**/checkpoint*.pth",
            ),
            "allCheckpoints": count_glob(
                EXPECTED["toothseg_checkpoints"], "**/checkpoint*.pth"
            ),
        },
        "priorTrainingOutputs": [run_summary(path) for path in dict.fromkeys(OUTPUT_RUNS)],
        "notebooksOnDrive": {
            str(path): count_glob(path, "*.ipynb") for path in NOTEBOOK_CANDIDATE_DIRS
        },
    }

    output = OUT / f"cbcter-drive-inventory-{time.strftime('%Y%m%d-%H%M%S')}.json"
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps(report, indent=2))
    print(f"\nWROTE {output}")


if __name__ == "__main__":
    main()
