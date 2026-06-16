#!/usr/bin/env python3
"""Generate the CBCT FDI CTNorm Colab notebook (.ipynb), pointed at the
UniFi-NAS Google-Drive backup folder."""
import json
from pathlib import Path

# Read-only NAS backup synced to Drive; outputs go to a separate writable folder.
INPUT_DIR = "/content/drive/MyDrive/UniFi Drive_UNAS Pro 8/UNAS Pro 8_Main Backup/Main/cbct"
OUT_DIR = "/content/drive/MyDrive/Projects/Health/CBCT/cbct-outputs"

def md(*lines):
    return {"cell_type": "markdown", "metadata": {}, "source": _nl(lines)}

def code(*lines):
    return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": _nl(lines)}

def _nl(lines):
    return [ln + ("\n" if i < len(lines) - 1 else "") for i, ln in enumerate(lines)]

cells = [
    md("# CBCT FDI Segmentation — CT-Normalization Training (Colab GPU)",
       "",
       "Trains a browser-size **YOLOv8n-seg** model for 32-class **FDI per-tooth** segmentation,",
       "using **nnU-Net-style fixed CT normalization** (the fix for the cross-scanner domain gap).",
       "Reads the dataset from your NAS→Drive backup; evaluates on held-out TF2 patients **and** the clinic scan.",
       "",
       "**Before running:** `Runtime → Change runtime type → GPU (T4)`, then `Runtime → Run all`."),

    md("## 1. GPU + install"),
    code("!nvidia-smi -L"),
    code("!pip -q install ultralytics onnx onnxslim"),

    md("## 2. Mount Drive"),
    code("from google.colab import drive",
         "drive.mount('/content/drive')"),

    md("## 3. Extract the CTNorm dataset from the NAS backup",
      "",
      "Reads `bundles/yolo-ctnorm-bundle.tgz` from the synced NAS folder, extracts to local disk,",
      "and repoints the dataset paths. (Raw TF2/TF4 + ToothSeg checkpoints are also in this folder",
      "for later distillation work — not needed for this run.)"),
    code("import tarfile, glob, os, re",
         f"INPUT_DIR = {INPUT_DIR!r}   # read-only NAS backup on Drive",
         f"OUT_DIR   = {OUT_DIR!r}     # writable outputs",
         "BUNDLE = f'{INPUT_DIR}/bundles/yolo-ctnorm-bundle.tgz'",
         "assert os.path.exists(BUNDLE), f'bundle not found: {BUNDLE}'",
         "os.makedirs('/content/data', exist_ok=True)",
         "os.makedirs(OUT_DIR, exist_ok=True)",
         "with tarfile.open(BUNDLE) as t: t.extractall('/content/data')",
         "for y in glob.glob('/content/data/*/data.yaml'):",
         "    root = os.path.dirname(y)",
         "    s = re.sub(r'^path: .*', f'path: {root}', open(y).read(), flags=re.M)",
         "    open(y, 'w').write(s)",
         "    print('fixed', y)",
         "print('train:', len(glob.glob('/content/data/yolo-tf2-fdi-ctnorm/images/train/*.png')),",
         "      'tf2_val:', len(glob.glob('/content/data/yolo-tf2-fdi-ctnorm/images/val/*.png')),",
         "      'clinic:', len(glob.glob('/content/data/clinic-fdi-ctnorm/images/val/*.png')))"),

    md("## 4. Train on GPU",
      "",
      "Same 52/12 patient split as the CPU run; **only the normalization changed**. ~10–20 min on a T4."),
    code("from ultralytics import YOLO",
         "model = YOLO('yolov8n-seg.pt')",
         "model.train(data='/content/data/yolo-tf2-fdi-ctnorm/data.yaml',",
         "            epochs=40, imgsz=512, batch=16, device=0, patience=12, workers=2,",
         "            project='/content/runs', name='fdi-tf2-ctnorm', exist_ok=True)"),

    md("## 5. Evaluate — the number that decides everything"),
    code("best = '/content/runs/fdi-tf2-ctnorm/weights/best.pt'",
         "m = YOLO(best)",
         "print('=== TF2 held-out patients (honest generalization) ===')",
         "r1 = m.val(data='/content/data/yolo-tf2-fdi-ctnorm/data.yaml', imgsz=512, device=0)",
         "print('box mAP50', round(r1.box.map50,4), 'mask mAP50', round(r1.seg.map50,4))",
         "print('=== CLINIC scan (does CTNorm fix the gap? old per-slice norm was ~0.007) ===')",
         "r2 = m.val(data='/content/data/clinic-fdi-ctnorm/data.yaml', imgsz=512, device=0)",
         "print('box mAP50', round(r2.box.map50,4), 'recall', round(r2.box.mr,4), 'mask mAP50', round(r2.seg.map50,4))"),

    md("**Read:** clinic box mAP50 well above ~0 ⇒ CTNormalization closed the gap (ship it / wire the same",
       "window into the browser preprocessing). Still ~0 ⇒ the gap is more than normalization → pivot to distillation."),

    md("## 6. Export ONNX (13 MB) + save to Drive"),
    code("m.export(format='onnx', imgsz=512, opset=12, simplify=True)",
         "import shutil",
         "dst = f'{OUT_DIR}/fdi-tf2-ctnorm'; os.makedirs(dst, exist_ok=True)",
         "for f in ['best.pt','best.onnx']:",
         "    shutil.copy(f'/content/runs/fdi-tf2-ctnorm/weights/{f}', f'{dst}/{f}')",
         "print('saved to', dst)"),
]

nb = {"cells": cells,
      "metadata": {"accelerator": "GPU",
                   "colab": {"provenance": [], "gpuType": "T4"},
                   "kernelspec": {"display_name": "Python 3", "name": "python3"},
                   "language_info": {"name": "python"}},
      "nbformat": 4, "nbformat_minor": 0}

out = Path("notebooks/cbct_fdi_ctnorm_colab.ipynb")
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(nb, indent=1))
print("wrote", out)
