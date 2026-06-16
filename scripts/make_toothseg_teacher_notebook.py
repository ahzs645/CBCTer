#!/usr/bin/env python3
"""Generate a Colab notebook for ToothSeg-teacher YOLO instance training.

The notebook fine-tunes the browser-sized YOLOv8n-seg model on ToothSeg's
per-tooth instance labelmap for the Aug 2025 CBCT, exports ONNX, and evaluates
the candidate against the ToothSeg teacher with label-mode=nonzero.
"""

from __future__ import annotations

import json
from pathlib import Path


WORK = "/content/drive/MyDrive/Projects/Health/CBCT/cbct-notebook"
OUT = "/content/drive/MyDrive/Projects/Health/CBCT/cbct-outputs"


def _nl(lines: tuple[str, ...]) -> list[str]:
    return [line + ("\n" if idx < len(lines) - 1 else "") for idx, line in enumerate(lines)]


def md(*lines: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": _nl(lines)}


def code(*lines: str) -> dict:
    return {
        "cell_type": "code",
        "metadata": {},
        "execution_count": None,
        "outputs": [],
        "source": _nl(lines),
    }


cells = [
    md(
        "# CBCT — ToothSeg teacher → browser YOLO instance student",
        "",
        "This notebook fine-tunes the browser YOLOv8n-seg model on the ToothSeg output for",
        "`CBCT-Aug2025-dcm`. The labels are exported as **per-tooth instance polygons** with",
        "one browser-compatible class: `tooth`. Evaluation uses the full ToothSeg labelmap",
        "with `--label-mode nonzero`, so it scores all teacher teeth rather than only FDI-valued voxels.",
        "",
        "**Runtime:** T4 GPU recommended.",
    ),
    md("## 1. Setup"),
    code("!nvidia-smi -L"),
    code("!pip -q install ultralytics SimpleITK scikit-image scipy opencv-python-headless onnx onnxslim onnxruntime"),
    code("from google.colab import drive; drive.mount('/content/drive')"),
    code(
        "import json, os, shutil, subprocess, textwrap",
        "from pathlib import Path",
        "from ultralytics import YOLO",
        f"WORK = {WORK!r}",
        f"OUT = {OUT!r}",
        "TEACHER_DIR = f'{WORK}/teacher-toothseg'",
        "TEACHER_IMAGE = f'{TEACHER_DIR}/cbct_aug2025_0000.nii.gz'",
        "TEACHER_LABELS = f'{TEACHER_DIR}/cbct_aug2025_toothseg_recovered.nii.gz'",
        "EXPORTER = f'{WORK}/export_toothseg_yolo_slices.py'",
        "COMPARE = f'{WORK}/compare_tooth_yolo_onnx_colab.py'",
        "BASE_PT = f'{OUT}/fdi-1cls/best.pt'",
        "BASE_ONNX = f'{OUT}/fdi-1cls/best.onnx'",
        "RUN = '/content/runs/toothseg-teacher-1cls'",
        "DATA = '/content/data/toothseg-teacher-1cls'",
        "DST = f'{OUT}/toothseg-teacher-1cls'",
        "for path in [TEACHER_IMAGE, TEACHER_LABELS, EXPORTER, COMPARE]:",
        "    assert os.path.exists(path), f'Missing {path}'",
        "Path(DST).mkdir(parents=True, exist_ok=True)",
        "print('teacher image:', TEACHER_IMAGE)",
        "print('teacher labels:', TEACHER_LABELS)",
        "print('base weights:', BASE_PT if os.path.exists(BASE_PT) else 'yolov8n-seg.pt')",
    ),
    md("## 2. Export ToothSeg teacher labels as YOLO instance slices"),
    code(
        "shutil.rmtree(DATA, ignore_errors=True)",
        "cmd = [",
        "    'python', EXPORTER,",
        "    '--volume', TEACHER_IMAGE,",
        "    '--labels', TEACHER_LABELS,",
        "    '--output-dir', DATA,",
        "    '--axes', 'z', 'y', 'x',",
        "    '--stride', '3',",
        "    '--min-area', '25',",
        "    '--simplify-step', '3',",
        "    '--val-every', '5',",
        "    '--single-class',",
        "    '--label-mode', 'nonzero',",
        "    '--target-spacing', '0.3',",
        "    '--ct-window', '-113.8', '4021',",
        "    '--case-id', 'cbct_aug2025_toothseg',",
        "]",
        "subprocess.run(cmd, check=True)",
        "summary = json.loads(Path(DATA, 'summary.json').read_text())",
        "print(json.dumps(summary, indent=2))",
    ),
    md("## 3. Fine-tune YOLOv8n-seg from the current browser model"),
    code(
        "base = BASE_PT if os.path.exists(BASE_PT) else 'yolov8n-seg.pt'",
        "model = YOLO(base)",
        "model.train(",
        "    data=f'{DATA}/data.yaml',",
        "    epochs=30,",
        "    imgsz=512,",
        "    batch=16,",
        "    device=0,",
        "    workers=2,",
        "    patience=10,",
        "    lr0=0.001,",
        "    close_mosaic=10,",
        "    project='/content/runs',",
        "    name='toothseg-teacher-1cls',",
        "    exist_ok=True,",
        ")",
    ),
    md("## 4. Export ONNX and save candidate to Drive"),
    code(
        "best_pt = '/content/runs/toothseg-teacher-1cls/weights/best.pt'",
        "model = YOLO(best_pt)",
        "model.export(format='onnx', imgsz=512, opset=12, simplify=True)",
        "for name in ['best.pt', 'best.onnx', 'last.pt']:",
        "    src = Path('/content/runs/toothseg-teacher-1cls/weights') / name",
        "    if src.exists():",
        "        shutil.copy2(src, Path(DST) / name)",
        "for name in ['args.yaml', 'results.csv']:",
        "    src = Path('/content/runs/toothseg-teacher-1cls') / name",
        "    if src.exists():",
        "        shutil.copy2(src, Path(DST) / name)",
        "shutil.copy2(Path(DATA, 'summary.json'), Path(DST, 'dataset-summary.json'))",
        "print('saved candidate to', DST)",
    ),
    md("## 5. Evaluate browser ONNX candidates against the ToothSeg teacher"),
    code(
        "models = []",
        "if os.path.exists(BASE_ONNX):",
        "    models += ['--model', f'baseline={BASE_ONNX}']",
        "models += ['--model', f'toothseg_teacher={DST}/best.onnx']",
        "report = f'{DST}/comparison-nonzero.json'",
        "cmd = [",
        "    'python', COMPARE,",
        "    '--image', TEACHER_IMAGE,",
        "    '--labels', TEACHER_LABELS,",
        "    '--output', report,",
        "    '--conf', '0.15',",
        "    '--mask-threshold', '0.7',",
        "    '--core-threshold', '7',",
        "    '--min-voxels', '8000',",
        "    '--label-mode', 'nonzero',",
        "] + models",
        "subprocess.run(cmd, check=True)",
        "data = json.loads(Path(report).read_text())",
        "rows = []",
        "for item in data['models']:",
        "    m = item['metrics']",
        "    rows.append({",
        "        'name': item['name'],",
        "        'dice': m['voxelDice'],",
        "        'precision': m['voxelPrecision'],",
        "        'recall': m['voxelRecall'],",
        "        'predInstances': m['predInstanceCount'],",
        "        'gtTeeth': m['gtToothCount'],",
        "        'matchedGtTeeth': m['matchedGtTeeth'],",
        "        'falsePositiveInstances': m['falsePositiveInstances'],",
        "    })",
        "print(json.dumps(rows, indent=2))",
        "print('report:', report)",
    ),
    md(
        "## 6. Decision rule",
        "",
        "Promote the candidate to `public/models/tooth-yolov8n-seg.onnx` only if it improves the",
        "ToothSeg-teacher comparison without losing recall. For this scan, the current baseline was:",
        "",
        "- Dice `0.90677`",
        "- Precision `0.88822`",
        "- Recall `0.92611`",
        "- `24` predicted instances versus `28` teacher teeth",
        "",
        "The key improvement to look for is `predInstances` moving closer to `28` with Dice/recall stable or better.",
    ),
]


nb = {
    "cells": cells,
    "metadata": {
        "accelerator": "GPU",
        "colab": {"provenance": [], "gpuType": "T4"},
        "kernelspec": {"display_name": "Python 3", "name": "python3"},
        "language_info": {"name": "python"},
    },
    "nbformat": 4,
    "nbformat_minor": 0,
}

out = Path("notebooks/cbct_toothseg_teacher_colab.ipynb")
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(nb, indent=1), encoding="utf-8")
print("wrote", out)
