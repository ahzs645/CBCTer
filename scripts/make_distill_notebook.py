#!/usr/bin/env python3
"""Generate the distillation Colab notebook: ToothSeg (3D nnU-Net teacher, runs on
Colab GPU) labels ToothFairy4 volumes -> slice -> train tiny YOLO student on
TF2-real + TF4-distilled. The teacher generalizes across scanners, so the student
should inherit clinic robustness."""
import json
from pathlib import Path

NAS = "/content/drive/MyDrive/UniFi Drive_UNAS Pro 8/UNAS Pro 8_Main Backup/Main/cbct"
WORK = "/content/drive/MyDrive/cbct"

def md(*l): return {"cell_type": "markdown", "metadata": {}, "source": _nl(l)}
def code(*l): return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": _nl(l)}
def _nl(l): return [s + ("\n" if i < len(l) - 1 else "") for i, s in enumerate(l)]

cells = [
    md("# CBCT FDI — Distillation: ToothSeg teacher → tiny YOLO student (Colab GPU)",
       "",
       "ToothSeg (3D nnU-Net) **works on your clinic scanner** but is 120 MB+ / GPU-only. Here we run it",
       "on Colab GPU to **label ToothFairy4** volumes (diverse scanners), then train the browser-size",
       "YOLOv8n-seg **student** on TF2-real + these distilled labels. The teacher's cross-scanner",
       "robustness should transfer to the student.",
       "",
       "**Runtime → T4 GPU, Run all.** This is the heavier notebook — start with `N_TF4=12` to validate."),

    md("## 1. Install ToothSeg + nnU-Net (teacher)"),
    code("!nvidia-smi -L"),
    code("!git clone -q https://github.com/MIC-DKFZ/ToothSeg.git /content/ToothSeg",
         "!pip -q install -e /content/ToothSeg SimpleITK ultralytics onnx onnxslim 2>&1 | tail -3",
         "import nnunetv2, torch; print('nnunetv2 OK, cuda', torch.cuda.is_available())"),
    code("from google.colab import drive; drive.mount('/content/drive')"),

    md("## 2. Point nnU-Net at the ToothSeg checkpoints on Drive"),
    code("import os, glob, re, zipfile, subprocess, shutil",
         f"NAS = {NAS!r}; WORK = {WORK!r}",
         "os.environ['nnUNet_results'] = f'{NAS}/checkpoints/nnUNet_results/ToothSeg'",
         "os.environ['nnUNet_raw'] = '/content/nnraw'; os.environ['nnUNet_preprocessed'] = '/content/nnprep'",
         "os.environ['nnUNet_compile'] = 'F'",
         "for d in ['/content/nnraw','/content/nnprep']: os.makedirs(d, exist_ok=True)",
         "assert os.path.isdir(os.environ['nnUNet_results']), 'checkpoints not found on Drive'",
         "TS = '/content/ToothSeg/toothseg/toothseg'   # pipeline scripts live here",
         "print('teacher ready')"),

    md("## 3. Extract N ToothFairy4 volumes to label (teacher inputs)"),
    code("N_TF4 = 12   # start small to validate; raise once the pipeline works",
         "TF4_ZIP = f'{NAS}/datasets/toothfairy4.zip'",
         "W = '/content/ts'; shutil.rmtree(W, ignore_errors=True)",
         "os.makedirs(f'{W}/input/imagesTs', exist_ok=True)",
         "z = zipfile.ZipFile(TF4_ZIP)",
         "vols = sorted(n for n in z.namelist() if n.endswith('volume.nii.gz'))[:N_TF4]",
         "for n in vols:",
         "    case = n.split('/')[0]",
         "    with z.open(n) as src, open(f'{W}/input/imagesTs/{case}_0000.nii.gz','wb') as dst: shutil.copyfileobj(src, dst)",
         "print('staged', len(vols), 'TF4 volumes for the teacher')"),

    md("## 4. Run the ToothSeg pipeline on GPU → FDI label volumes",
      "",
      "Two 3D nnU-Net passes (semantic + instance) + postprocessing — the same pipeline that labeled",
      "your clinic scan. On a T4 expect a few minutes per volume."),
    code("def run(c): print('>>', c); subprocess.run(c, shell=True, check=True)",
         "# resize for the instance branch (spacing 0.2)",
         "run(f'python {TS}/test_set_prediction_and_eval/resize_test_set.py "
         "-i {W}/input/imagesTs -o {W}/input/imagesTs_resized_02')",
         "# semantic branch (FDI teeth)",
         "run('nnUNetv2_predict --disable_tta -i {0}/input/imagesTs -o {0}/semseg "
         "-d Dataset121_ToothFairy2_Teeth -tr nnUNetTrainer_onlyMirror01_DASegOrd0 -p nnUNetPlans "
         "-c 3d_fullres_resample_torch_256_bs8_ctnorm -f 5 -device cuda'.format(W))",
         "# instance (border-core) branch",
         "run('nnUNetv2_predict --disable_tta -i {0}/input/imagesTs_resized_02 -o {0}/instseg "
         "-d Dataset123_ToothFairy2fixed_teeth_spacing02_brd3px -tr nnUNetTrainer -p nnUNetPlans "
         "-c 3d_fullres_resample_torch_192_bs8_ctnorm -f 5 -device cuda'.format(W))"),
    code("# postprocess -> instances -> resize back -> assign FDI numbers",
         "run(f'python {TS}/postprocess_predictions/border_core_to_instances.py "
         "-i {W}/instseg -o {W}/inst -np 2')",
         "run(f'python {TS}/postprocess_predictions/resize_predictions.py "
         "-i {W}/inst -o {W}/inst_resized -ref {W}/input/imagesTs -np 2')",
         "run(f'python {TS}/postprocess_predictions/assign_majority_tooth_labels.py "
         "-ifolder {W}/inst_resized -sfolder {W}/semseg -o {W}/final -np 2')",
         "print('FDI label volumes:', len(glob.glob(f'{W}/final/*.nii.gz')))"),

    md("## 5. Build the distilled dataset (TF4 image + ToothSeg FDI label)"),
    code("DDS = '/content/distill/Dataset_distill'",
         "os.makedirs(f'{DDS}/imagesTr', exist_ok=True); os.makedirs(f'{DDS}/labelsTr', exist_ok=True)",
         "for lab in glob.glob(f'{W}/final/*.nii.gz'):",
         "    case = os.path.basename(lab)[:-7]",
         "    shutil.copy(f'{W}/input/imagesTs/{case}_0000.nii.gz', f'{DDS}/imagesTr/{case}_0000.nii.gz')",
         "    shutil.copy(lab, f'{DDS}/labelsTr/{case}.nii.gz')",
         "print('distilled pairs:', len(glob.glob(f'{DDS}/labelsTr/*.nii.gz')))"),

    md("## 6. Slice TF2-real + distilled into one training set (common spacing + CT window)"),
    code("EXP = f'{WORK}/export_toothfairy2_mha_yolo_slices.py'",
         "TARGET_SPACING, STRIDE = 0.3, 8",
         "OUT = '/content/data/distill'; shutil.rmtree(OUT, ignore_errors=True)",
         "def slice_set(dsdir, split, cases=None):",
         "    cmd = ['python', EXP, '--dataset-dir', dsdir, '--output-dir', OUT, '--split', split,",
         "           '--stride', str(STRIDE), '--target-spacing', str(TARGET_SPACING), '--ct-window','-113.8','4021']",
         "    if cases: cmd += ['--cases', *cases]",
         "    subprocess.run(cmd, check=True)",
         "# TF2 real (52 train / 12 val) from the zip",
         "os.makedirs('/content/tf2', exist_ok=True)",
         "z = zipfile.ZipFile(f'{NAS}/datasets/ToothFairy2_Dataset.zip')",
         "tf2 = [re.sub(r'.*imagesTr/','',n).replace('_0000.mha','') for n in sorted(z.namelist()) if re.search(r'imagesTr/[^/]+_0000\\.mha$', n)][:64]",
         "mem=[]",
         "for c in tf2: mem += [f'Dataset112_ToothFairy2/imagesTr/{c}_0000.mha', f'Dataset112_ToothFairy2/labelsTr/{c}.mha']",
         "z.extractall('/content/tf2', mem)",
         "val=[c for i,c in enumerate(tf2) if (i+1)%5==0]; train=[c for c in tf2 if c not in val]",
         "slice_set('/content/tf2/Dataset112_ToothFairy2','val',val)",
         "slice_set('/content/tf2/Dataset112_ToothFairy2','train',train)",
         "slice_set(DDS,'train')   # distilled TF4 -> train",
         "CLIN='/content/data/clinic-spaced'; shutil.rmtree(CLIN, ignore_errors=True)",
         "subprocess.run(['python',EXP,'--dataset-dir',f'{WORK}/clinic-raw/Dataset_clinic','--output-dir',CLIN,",
         "                '--split','val','--stride','8','--target-spacing','0.3','--ct-window','-113.8','4021'], check=True)",
         "for y in [f'{OUT}/data.yaml', f'{CLIN}/data.yaml']:",
         "    open(y,'w').write(re.sub(r'^path: .*', f'path: {os.path.dirname(y)}', open(y).read(), flags=re.M))",
         "import glob as g; print('train', len(g.glob(f'{OUT}/images/train/*.png')), 'val', len(g.glob(f'{OUT}/images/val/*.png')), 'clinic', len(g.glob(f'{CLIN}/images/val/*.png')))"),

    md("## 7. Train the student + evaluate clinic"),
    code("from ultralytics import YOLO",
         "m = YOLO('yolov8n-seg.pt')",
         "m.train(data=f'{OUT}/data.yaml', epochs=40, imgsz=512, batch=16, device=0, patience=12,",
         "        workers=2, project='/content/runs', name='fdi-distill', exist_ok=True)",
         "m = YOLO('/content/runs/fdi-distill/weights/best.pt')",
         "print('=== TF2 held-out ==='); print('box mAP50', round(m.val(data=f'{OUT}/data.yaml', imgsz=512, device=0).box.map50,4))",
         "print('=== CLINIC (was 0.010) ==='); print('box mAP50', round(m.val(data=f'{CLIN}/data.yaml', imgsz=512, device=0).box.map50,4))"),

    md("## 8. Save student to Drive"),
    code("m.export(format='onnx', imgsz=512, opset=12, simplify=True)",
         "dst = f'{WORK}-outputs/fdi-distill'; os.makedirs(dst, exist_ok=True)",
         "for f in ['best.pt','best.onnx']: shutil.copy(f'/content/runs/fdi-distill/weights/{f}', f'{dst}/{f}')",
         "print('saved to', dst)"),
]

nb = {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": [], "gpuType": "T4"},
      "kernelspec": {"display_name": "Python 3", "name": "python3"}, "language_info": {"name": "python"}},
      "nbformat": 4, "nbformat_minor": 0}
out = Path("notebooks/cbct_distill_toothseg_colab.ipynb"); out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(nb, indent=1)); print("wrote", out)
