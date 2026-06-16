#!/usr/bin/env python3
"""Non-interactive Colab runner for ToothSeg-teacher YOLO training.

Upload this script plus the teacher NIfTI, teacher labelmap, current browser
best.pt/best.onnx, exporter, and comparator into /content/cbcter-teacher.
It trains in /content and writes downloadable artifacts under
/content/cbcter-teacher/out.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(os.environ.get("CBCTER_TEACHER_ROOT", "/content/cbcter-teacher"))
DATA = Path("/content/data/toothseg-teacher-1cls")
RUN_NAME = "toothseg-teacher-1cls"
RUN_DIR = Path("/content/runs") / RUN_NAME
OUT = Path(os.environ.get("CBCTER_TEACHER_OUT", str(ROOT / "out")))

IMAGE = Path(os.environ.get("CBCTER_TEACHER_IMAGE", str(ROOT / "cbct_aug2025_0000.nii.gz")))
LABELS = Path(os.environ.get("CBCTER_TEACHER_LABELS", str(ROOT / "cbct_aug2025_toothseg_recovered.nii.gz")))
BASE_PT = Path(os.environ.get("CBCTER_BASE_PT", str(ROOT / "fdi-1cls-best.pt")))
BASE_ONNX = Path(os.environ.get("CBCTER_BASE_ONNX", str(ROOT / "fdi-1cls-best.onnx")))
EXPORTER = Path(os.environ.get("CBCTER_EXPORTER", str(ROOT / "export_toothseg_yolo_slices.py")))
COMPARE = Path(os.environ.get("CBCTER_COMPARE", str(ROOT / "compare_tooth_yolo_onnx_colab.py")))


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def install_deps() -> None:
    packages = [
        "ultralytics",
        "SimpleITK",
        "scikit-image",
        "scipy",
        "opencv-python-headless",
        "onnx",
        "onnxslim",
        "onnxruntime",
    ]
    run([sys.executable, "-m", "pip", "install", "-q", *packages])


def assert_inputs() -> None:
    missing = [path for path in [IMAGE, LABELS, BASE_PT, BASE_ONNX, EXPORTER, COMPARE] if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing uploaded inputs: " + ", ".join(str(path) for path in missing))


def export_dataset() -> dict:
    shutil.rmtree(DATA, ignore_errors=True)
    run(
        [
            sys.executable,
            str(EXPORTER),
            "--volume",
            str(IMAGE),
            "--labels",
            str(LABELS),
            "--output-dir",
            str(DATA),
            "--axes",
            "z",
            "y",
            "x",
            "--stride",
            "3",
            "--min-area",
            "25",
            "--simplify-step",
            "3",
            "--val-every",
            "5",
            "--single-class",
            "--label-mode",
            "nonzero",
            "--target-spacing",
            "0.3",
            "--ct-window",
            "-113.8",
            "4021",
            "--case-id",
            "cbct_aug2025_toothseg",
        ]
    )
    return json.loads((DATA / "summary.json").read_text(encoding="utf-8"))


def train_and_export() -> None:
    from ultralytics import YOLO

    model = YOLO(str(BASE_PT))
    model.train(
        data=str(DATA / "data.yaml"),
        epochs=int(os.environ.get("CBCTER_TEACHER_EPOCHS", "30")),
        imgsz=512,
        batch=16,
        device=0,
        workers=2,
        patience=10,
        lr0=0.001,
        close_mosaic=10,
        project="/content/runs",
        name=RUN_NAME,
        exist_ok=True,
    )
    best = RUN_DIR / "weights/best.pt"
    exported = YOLO(str(best))
    exported.export(format="onnx", imgsz=512, opset=12, simplify=True)


def copy_artifacts() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for rel in [
        "weights/best.pt",
        "weights/best.onnx",
        "weights/last.pt",
        "args.yaml",
        "results.csv",
    ]:
        src = RUN_DIR / rel
        if src.exists():
            dst = OUT / Path(rel).name
            shutil.copy2(src, dst)
            print(f"copied {src} -> {dst}", flush=True)
    shutil.copy2(DATA / "summary.json", OUT / "dataset-summary.json")


def evaluate() -> dict:
    report = OUT / "comparison-nonzero.json"
    run(
        [
            sys.executable,
            str(COMPARE),
            "--image",
            str(IMAGE),
            "--labels",
            str(LABELS),
            "--output",
            str(report),
            "--conf",
            "0.15",
            "--mask-threshold",
            "0.7",
            "--core-threshold",
            "7",
            "--min-voxels",
            "8000",
            "--label-mode",
            "nonzero",
            "--model",
            f"baseline={BASE_ONNX}",
            "--model",
            f"toothseg_teacher={OUT / 'best.onnx'}",
        ]
    )
    data = json.loads(report.read_text(encoding="utf-8"))
    compact = []
    for item in data["models"]:
        metrics = item["metrics"]
        compact.append(
            {
                "name": item["name"],
                "voxelDice": metrics["voxelDice"],
                "voxelPrecision": metrics["voxelPrecision"],
                "voxelRecall": metrics["voxelRecall"],
                "gtToothCount": metrics["gtToothCount"],
                "predInstanceCount": metrics["predInstanceCount"],
                "matchedGtTeeth": metrics["matchedGtTeeth"],
                "falsePositiveInstances": metrics["falsePositiveInstances"],
            }
        )
    (OUT / "summary.json").write_text(json.dumps(compact, indent=2), encoding="utf-8")
    print("COMPACT_METRICS", json.dumps(compact, indent=2), flush=True)
    return {"report": str(report), "compact": compact}


def main() -> None:
    assert_inputs()
    install_deps()
    dataset_summary = export_dataset()
    print("DATASET_SUMMARY", json.dumps(dataset_summary, indent=2), flush=True)
    train_and_export()
    copy_artifacts()
    evaluation = evaluate()
    print("DONE", json.dumps(evaluation, indent=2), flush=True)


if __name__ == "__main__":
    main()
