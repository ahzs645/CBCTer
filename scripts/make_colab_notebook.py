#!/usr/bin/env python3
"""Generate the CBCT FDI CTNorm Colab notebook (.ipynb)."""
import json
from pathlib import Path

def md(*lines):
    return {"cell_type": "markdown", "metadata": {}, "source": list(_nl(lines))}

def code(*lines):
    return {"cell_type": "code", "metadata": {}, "execution_count": None,
            "outputs": [], "source": list(_nl(lines))}

def _nl(lines):
    out = []
    for i, ln in enumerate(lines):
        out.append(ln + ("\n" if i < len(lines) - 1 else ""))
    return out

cells = [
    md("# CBCT FDI Tooth Segmentation — CT-Normalization Training (Colab GPU)",
       "",
       "Trains a browser-size **YOLOv8n-seg** model for 32-class **FDI per-tooth** segmentation",
       "on ToothFairy2, using **nnU-Net-style fixed CT normalization** (the fix for the cross-scanner",
       "domain gap). Evaluates on held-out TF2 patients **and** the clinic scan.",
       "",
       "**Before running:** `Runtime -> Change runtime type -> GPU (T4)`, then `Runtime -> Run all`."),

    md("## 1. GPU + install"),
    code("!nvidia-smi -L"),
    code("!pip -q install ultralytics onnx onnxslim"),

    md("## 2. Mount Drive"),
    code("from google.colab import drive",
         "drive.mount('/content/drive')"),

    md("## 3. Get the dataset",
      "",
      "**Quick start:** upload `yolo-ctnorm-bundle.tgz` (from the VM) to a Drive folder",
      "(default `MyDrive/cbct/`), then run the cell below. It extracts to local disk and",
      "rewrites the dataset paths."),
    code("import tarfile, glob, os, re",
         "DRIVE_DIR = '/content/drive/MyDrive/cbct'   # <-- where you put the bundle",
         "BUNDLE = f'{DRIVE_DIR}/yolo-ctnorm-bundle.tgz'",
         "os.makedirs('/content/data', exist_ok=True)",
         "with tarfile.open(BUNDLE) as t: t.extractall('/content/data')",
         "# point each data.yaml at the local extracted path",
         "for y in glob.glob('/content/data/*/data.yaml'):",
         "    root = os.path.dirname(y)",
         "    s = open(y).read()",
         "    s = re.sub(r'^path: .*', f'path: {root}', s, flags=re.M)",
         "    open(y, 'w').write(s)",
         "    print('fixed', y)",
         "print('train imgs:', len(glob.glob('/content/data/yolo-tf2-fdi-ctnorm/images/train/*.png')))",
         "print('tf2 val  :', len(glob.glob('/content/data/yolo-tf2-fdi-ctnorm/images/val/*.png')))",
         "print('clinic   :', len(glob.glob('/content/data/clinic-fdi-ctnorm/images/val/*.png')))"),

    md("## 4. Train on GPU",
      "",
      "Same 52/12 patient split as the CPU run; only the normalization changed. ~10-20 min on a T4."),
    code("from ultralytics import YOLO",
         "model = YOLO('yolov8n-seg.pt')",
         "model.train(data='/content/data/yolo-tf2-fdi-ctnorm/data.yaml',",
         "            epochs=40, imgsz=512, batch=16, device=0, patience=12, workers=2,",
         "            project='/content/runs', name='fdi-tf2-ctnorm', exist_ok=True)"),

    md("## 5. Evaluate — the two numbers that matter"),
    code("best = '/content/runs/fdi-tf2-ctnorm/weights/best.pt'",
         "m = YOLO(best)",
         "print('=== TF2 held-out patients (honest generalization) ===')",
         "r1 = m.val(data='/content/data/yolo-tf2-fdi-ctnorm/data.yaml', imgsz=512, device=0)",
         "print('box mAP50', round(r1.box.map50,4), 'mask mAP50', round(r1.seg.map50,4))",
         "print('=== CLINIC scan (the real test: does CTNorm fix the gap?) ===')",
         "r2 = m.val(data='/content/data/clinic-fdi-ctnorm/data.yaml', imgsz=512, device=0)",
         "print('box mAP50', round(r2.box.map50,4), 'recall', round(r2.box.mr,4), 'mask mAP50', round(r2.seg.map50,4))"),

    md("**Interpretation:** the old per-slice-normalized model scored ~0 on the clinic scan.",
       "If CTNorm works, the clinic box mAP50 here should jump well above 0. The TF2 held-out",
       "number tells you the model is still a good general FDI segmenter."),

    md("## 6. Export ONNX (13 MB browser model) + save to Drive"),
    code("m.export(format='onnx', imgsz=512, opset=12, simplify=True)",
         "import shutil, os",
         "os.makedirs(f'{DRIVE_DIR}/models/fdi-tf2-ctnorm', exist_ok=True)",
         "for f in ['best.pt','best.onnx']:",
         "    shutil.copy(f'/content/runs/fdi-tf2-ctnorm/weights/{f}', f'{DRIVE_DIR}/models/fdi-tf2-ctnorm/{f}')",
         "print('saved to', f'{DRIVE_DIR}/models/fdi-tf2-ctnorm/')"),

    md("---",
       "## Appendix (optional, one-time): seed ToothFairy2 + ToothSeg checkpoints to Drive",
       "",
       "For a sustainable, VM-independent setup. Downloads the 25 GB labeled dataset from DITTO",
       "**straight to Drive** (fast on Colab's network). Needs the DITTO session cookie:",
       "copy `cookies.txt` from the VM (`/opt/cbct-yolo/datasets/ditto-19/cookies.txt`) into",
       "`MyDrive/cbct/`. Then future runs can slice any subset/normalization on Colab itself.",
       "Skip this if you only want the quick-start training above."),
    code("# one-time: download ToothFairy2 (~25GB) to Drive",
         "URL='https://ditto.ing.unimore.it/download/dataset/NDEyOQ/d9qick-0666de59eeb1ad2a141ebc41eed4900d/4'",
         "!curl -L -b '{DRIVE_DIR}/cookies.txt' -C - -o '{DRIVE_DIR}/ToothFairy2_Dataset.zip' '{URL}'"),
    code("# the SimpleITK CTNorm slicer (so Colab can re-slice any subset itself)",
         "# upload export_toothfairy2_mha_yolo_slices.py to MyDrive/cbct/ and use it like:",
         "#   !pip -q install SimpleITK scikit-image",
         "#   !python '{DRIVE_DIR}/export_toothfairy2_mha_yolo_slices.py' \\",
         "#       --dataset-dir <extracted Dataset112_ToothFairy2> --output-dir /content/data/tf2 \\",
         "#       --split train --stride 8 --ct-window -113.8 4021 --cases <ids>",
         "print('see comments')"),
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
