#!/usr/bin/env python3
"""Generate the spacing-resample experiment Colab notebook.
Re-slices TF2 + clinic resampled to a COMMON voxel spacing (what nnU-Net does and
our 2D YOLO didn't), then trains + evals — testing if scale mismatch is the clinic gap."""
import json
from pathlib import Path

NAS = "/content/drive/MyDrive/UniFi Drive_UNAS Pro 8/UNAS Pro 8_Main Backup/Main/cbct"  # read-only backup
WORK = "/content/drive/MyDrive/cbct"        # exporter + clinic-raw + outputs (writable)

def md(*l): return {"cell_type": "markdown", "metadata": {}, "source": _nl(l)}
def code(*l): return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": _nl(l)}
def _nl(l): return [s + ("\n" if i < len(l) - 1 else "") for i, s in enumerate(l)]

cells = [
    md("# CBCT FDI — Spacing-Resample Experiment (Colab GPU)",
       "",
       "Tests whether **voxel-scale mismatch** is the clinic domain gap. Re-slices ToothFairy2 +",
       "the clinic scan resampled to a **common mm/voxel** (like nnU-Net), with the same fixed CT",
       "window, then trains a browser-size YOLOv8n-seg and re-evaluates the clinic scan.",
       "",
       "**Set Runtime → T4 GPU, then Run all.** Sign in as the account that owns the Drive data."),

    md("## 1. Setup"),
    code("!nvidia-smi -L"),
    code("!pip -q install ultralytics SimpleITK scikit-image onnx onnxslim"),
    code("from google.colab import drive; drive.mount('/content/drive')"),
    code("import os, sys, glob, re, zipfile, subprocess, shutil",
         f"NAS  = {NAS!r}      # read-only NAS backup",
         f"WORK = {WORK!r}        # writable: exporter, clinic-raw, outputs",
         "TARGET_SPACING = 0.3   # mm/voxel; both TF2 and clinic resampled to this -> same tooth scale",
         "STRIDE = 8",
         "EXPORTER = f'{WORK}/export_toothfairy2_mha_yolo_slices.py'",
         "TF2_ZIP  = f'{NAS}/datasets/ToothFairy2_Dataset.zip'",
         "CLINIC_DS = f'{WORK}/clinic-raw/Dataset_clinic'",
         "assert os.path.exists(EXPORTER), EXPORTER",
         "assert os.path.exists(TF2_ZIP), TF2_ZIP",
         "assert os.path.exists(CLINIC_DS), CLINIC_DS",
         "print('inputs OK')"),

    md("## 2. Extract 64 TF2 patients from the zip (same set as before)"),
    code("os.makedirs('/content/tf2', exist_ok=True)",
         "z = zipfile.ZipFile(TF2_ZIP)",
         "imgs = sorted(n for n in z.namelist() if re.search(r'imagesTr/[^/]+_0000\\.mha$', n))",
         "cases = [re.sub(r'.*imagesTr/','',n).replace('_0000.mha','') for n in imgs][:64]",
         "members = []",
         "for c in cases:",
         "    members += [f'Dataset112_ToothFairy2/imagesTr/{c}_0000.mha', f'Dataset112_ToothFairy2/labelsTr/{c}.mha']",
         "z.extractall('/content/tf2', members)",
         "print('extracted', len(cases), 'cases')",
         "# patient-level split: every 5th -> val",
         "val = [c for i,c in enumerate(cases) if (i+1)%5==0]",
         "train = [c for c in cases if c not in val]",
         "print('train', len(train), 'val', len(val))"),

    md(f"## 3. Slice TF2 + clinic at common spacing ({{TARGET_SPACING}} mm) + fixed CT window"),
    code("DS = '/content/tf2/Dataset112_ToothFairy2'",
         "OUT = '/content/data/tf2-spaced'",
         "shutil.rmtree(OUT, ignore_errors=True)",
         "def slice_set(dataset_dir, out, split, cases=None):",
         "    cmd = ['python', EXPORTER, '--dataset-dir', dataset_dir, '--output-dir', out,",
         "           '--split', split, '--stride', str(STRIDE), '--target-spacing', str(TARGET_SPACING),",
         "           '--ct-window', '-113.8', '4021']",
         "    if cases: cmd += ['--cases', *cases]",
         "    print('>>', ' '.join(cmd[:9]), '...'); subprocess.run(cmd, check=True)",
         "slice_set(DS, OUT, 'val', val)",
         "slice_set(DS, OUT, 'train', train)",
         "# clinic eval set, same spacing+window",
         "CLIN = '/content/data/clinic-spaced'; shutil.rmtree(CLIN, ignore_errors=True)",
         "slice_set(CLINIC_DS, CLIN, 'val')",
         "# absolute paths in data.yaml",
         "for y in [f'{OUT}/data.yaml', f'{CLIN}/data.yaml']:",
         "    open(y,'w').write(re.sub(r'^path: .*', f'path: {os.path.dirname(y)}', open(y).read(), flags=re.M))",
         "print('TF2 train', len(glob.glob(f'{OUT}/images/train/*.png')), 'val', len(glob.glob(f'{OUT}/images/val/*.png')))",
         "print('clinic', len(glob.glob(f'{CLIN}/images/val/*.png')))"),

    md("## 4. Train"),
    code("from ultralytics import YOLO",
         "m = YOLO('yolov8n-seg.pt')",
         "m.train(data=f'{OUT}/data.yaml', epochs=40, imgsz=512, batch=16, device=0, patience=12,",
         "        workers=2, project='/content/runs', name='fdi-spaced', exist_ok=True)"),

    md("## 5. Evaluate — clinic mAP50 vs the 0.010 from the no-resample CTNorm run"),
    code("best = '/content/runs/fdi-spaced/weights/best.pt'; m = YOLO(best)",
         "print('=== TF2 held-out ==='); r1 = m.val(data=f'{OUT}/data.yaml', imgsz=512, device=0)",
         "print('box mAP50', round(r1.box.map50,4), 'recall', round(r1.box.mr,4))",
         "print('=== CLINIC (was 0.010 without resampling) ==='); r2 = m.val(data=f'{CLIN}/data.yaml', imgsz=512, device=0)",
         "print('box mAP50', round(r2.box.map50,4), 'recall', round(r2.box.mr,4))"),

    md("## 6. Save model to Drive"),
    code("m.export(format='onnx', imgsz=512, opset=12, simplify=True)",
         "dst = f'{WORK}-outputs/fdi-spaced'; os.makedirs(dst, exist_ok=True)",
         "for f in ['best.pt','best.onnx']: shutil.copy(f'/content/runs/fdi-spaced/weights/{f}', f'{dst}/{f}')",
         "print('saved to', dst)"),
]

nb = {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": [], "gpuType": "T4"},
      "kernelspec": {"display_name": "Python 3", "name": "python3"}, "language_info": {"name": "python"}},
      "nbformat": 4, "nbformat_minor": 0}
out = Path("notebooks/cbct_fdi_spacing_colab.ipynb"); out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(nb, indent=1)); print("wrote", out)
