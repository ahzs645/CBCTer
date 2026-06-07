# CBCT Node Server Handoff

Last updated: 2026-06-06

This is the operational handoff for continuing CBCT browser-size tooth
segmentation work on the server/VM instead of the local Mac.

## Server

- Proxmox host: `root@192.168.1.44`
- VM ID: `202`
- VM name: `cbct-node`
- VM IP: `192.168.1.52`
- SSH user: `ubuntu`
- Working root: `/opt/cbct-yolo`
- CPU/RAM/disk: 8 vCPU, 32 GB RAM, 220 GB disk
- GPU: no NVIDIA GPU available
- Runtime expectation: CPU-only PyTorch/Ultralytics

The old AI VM was suspended/stopped:

- VM ID: `201`
- VM name: `ai-node`
- IP: `192.168.1.51`

## Local Repos

Primary app repo on Mac:

- `/Users/ahmadjalil/github/CBCTer`

Infrastructure repo on Mac:

- `/Users/ahmadjalil/github/personalprox`

The `personalprox` inventory includes:

```yaml
cbct:
  hosts:
    cbct-node:
      ansible_host: 192.168.1.52
      ansible_user: ubuntu
      ansible_connection: ssh
```

## Server Python Environment

Virtualenv:

- `/opt/cbct-yolo/venv`

Activate:

```bash
ssh ubuntu@192.168.1.52
. /opt/cbct-yolo/venv/bin/activate
```

Known installed Python packages:

- `torch` CPU build
- `torchvision` CPU build
- `ultralytics`
- `onnx`
- `onnxruntime`
- `onnxslim`
- `nibabel`
- `scikit-image`

Known system packages added:

- `python3.12-venv`
- `python3-pip`
- `libgl1`
- `libglib2.0-0`
- `unzip`

Check runtime:

```bash
ssh ubuntu@192.168.1.52 '
. /opt/cbct-yolo/venv/bin/activate
python - <<PY
import ultralytics, torch, onnxruntime, cv2, nibabel
print("ultralytics", ultralytics.__version__)
print("torch", torch.__version__, "cuda", torch.cuda.is_available())
print("onnxruntime", onnxruntime.__version__)
print("cv2", cv2.__version__)
print("nibabel", nibabel.__version__)
PY
'
```

## Server Files

Scripts copied to server:

- `/opt/cbct-yolo/scripts/export_nnUNet_teeth_yolo_slices.py`
- `/opt/cbct-yolo/scripts/export_cbct_yolo_unlabeled_slices.py`

Main server datasets/runs:

- `/opt/cbct-yolo/yolo-toothseg-slices-single`
- `/opt/cbct-yolo/yolo-toothseg-slices-fdi`
- `/opt/cbct-yolo/datasets/ditto-19/toothfairy4.zip`
- `/opt/cbct-yolo/datasets/ditto-19/extracted-subset`
- `/opt/cbct-yolo/toothfairy4-unlabeled-slices-subset`
- `/opt/cbct-yolo/yolo-combined-toothseg-toothfairy4-pseudo-conf055`
- `/opt/cbct-yolo/runs/toothseg-single-yolov8n-smoke`
- `/opt/cbct-yolo/runs/toothfairy4-subset-pseudolabel-conf055`
- `/opt/cbct-yolo/runs/toothfairy4-pseudo-refine-yolov8n-5e`

Disk check:

```bash
ssh ubuntu@192.168.1.52 'df -h /opt/cbct-yolo'
```

At handoff, `/opt/cbct-yolo/datasets/ditto-19/toothfairy4.zip` is about
42 GB and the VM still has ample disk space.

## ToothFairy4 Dataset

Downloaded directly on the VM from DITTO after authenticated login.

Do not copy the dataset to the Mac unless explicitly requested.

Archive:

- `/opt/cbct-yolo/datasets/ditto-19/toothfairy4.zip`
- Size: about 42 GB

Observed contents:

- 627 CBCT `volume.nii.gz` files
- English/Italian text reports
- No segmentation masks
- No label, mask, annotation, ground-truth, or segmentation folders found

Useful listing commands:

```bash
ssh ubuntu@192.168.1.52 '
cd /opt/cbct-yolo/datasets/ditto-19
unzip -l toothfairy4.zip | sed -n "1,120p"
unzip -l toothfairy4.zip | awk "{print \$4}" | grep -Eic "label|labels|seg|mask|annotation|ground" || true
unzip -l toothfairy4.zip | awk "{print \$4}" | grep -c "volume.nii.gz" || true
'
```

Because ToothFairy4 is unlabeled for segmentation, current refinement is
self-training/domain adaptation, not ground-truth-supervised training.

## Current Browser-Size Models

### Original ToothSeg-Derived YOLO Smoke Model

Server:

- `/opt/cbct-yolo/runs/toothseg-single-yolov8n-smoke/weights/best.pt`
- `/opt/cbct-yolo/runs/toothseg-single-yolov8n-smoke/weights/best.onnx`

Local copy:

- `/Users/ahmadjalil/github/CBCTer/outputs/yolo-browser-prototype/toothseg-single-yolov8n-smoke/weights/best.pt`
- `/Users/ahmadjalil/github/CBCTer/outputs/yolo-browser-prototype/toothseg-single-yolov8n-smoke/weights/best.onnx`

Sizes:

- PT: about 6.4 MB
- ONNX: about 13 MB

This model was trained from ToothSeg pseudo-labels on `CBCT-Aug2025-dcm`.

### ToothFairy4 Pseudo-Refined Model

Server:

- `/opt/cbct-yolo/runs/toothfairy4-pseudo-refine-yolov8n-5e/weights/best.pt`
- `/opt/cbct-yolo/runs/toothfairy4-pseudo-refine-yolov8n-5e/weights/best.onnx`

Local copy:

- `/Users/ahmadjalil/github/CBCTer/outputs/yolo-browser-prototype/toothfairy4-pseudo-refine-yolov8n-5e/weights/best.pt`
- `/Users/ahmadjalil/github/CBCTer/outputs/yolo-browser-prototype/toothfairy4-pseudo-refine-yolov8n-5e/weights/best.onnx`

Sizes:

- PT: about 6.4 MB
- ONNX: about 13 MB

Final pseudo-validation from 5 epochs:

- Box precision: `0.85647`
- Box recall: `0.88259`
- Box mAP50: `0.94009`
- Box mAP50-95: `0.73008`
- Mask precision: `0.86944`
- Mask recall: `0.87174`
- Mask mAP50: `0.93767`
- Mask mAP50-95: `0.60150`

These metrics are against generated pseudo-labels, not real segmentation
ground truth.

## Reproduce Current ToothFairy4 Pseudo-Refine

Extract a small subset:

```bash
ssh ubuntu@192.168.1.52 '
set -e
cd /opt/cbct-yolo/datasets/ditto-19
mkdir -p extracted-subset
unzip -q toothfairy4.zip "A003/*" "A004/*" "A005/*" "A008/*" \
  "A009/*" "A010/*" "A011/*" "A012/*" -d extracted-subset
'
```

Export unlabeled slices:

```bash
ssh ubuntu@192.168.1.52 '
set -e
. /opt/cbct-yolo/venv/bin/activate
python /opt/cbct-yolo/scripts/export_cbct_yolo_unlabeled_slices.py \
  --input-root /opt/cbct-yolo/datasets/ditto-19/extracted-subset \
  --output-dir /opt/cbct-yolo/toothfairy4-unlabeled-slices-subset \
  --axes z y x --stride 16 --max-cases 8
'
```

Generate pseudo-labels:

```bash
ssh ubuntu@192.168.1.52 '
set -e
export YOLO_CONFIG_DIR=/opt/cbct-yolo/yolo-config
. /opt/cbct-yolo/venv/bin/activate
yolo segment predict \
  model=/opt/cbct-yolo/runs/toothseg-single-yolov8n-smoke/weights/best.pt \
  source=/opt/cbct-yolo/toothfairy4-unlabeled-slices-subset/images \
  imgsz=512 device=cpu conf=0.55 save=True save_txt=True \
  project=/opt/cbct-yolo/runs name=toothfairy4-subset-pseudolabel-conf055 exist_ok=True
'
```

Build combined dataset:

```bash
ssh ubuntu@192.168.1.52 '
set -euo pipefail
ROOT=/opt/cbct-yolo/yolo-combined-toothseg-toothfairy4-pseudo-conf055
rm -rf "$ROOT"
mkdir -p "$ROOT/images/train" "$ROOT/images/val" "$ROOT/labels/train" "$ROOT/labels/val"
cp /opt/cbct-yolo/yolo-toothseg-slices-single/images/train/*.png "$ROOT/images/train/"
cp /opt/cbct-yolo/yolo-toothseg-slices-single/labels/train/*.txt "$ROOT/labels/train/"
cp /opt/cbct-yolo/yolo-toothseg-slices-single/images/val/*.png "$ROOT/images/val/"
cp /opt/cbct-yolo/yolo-toothseg-slices-single/labels/val/*.txt "$ROOT/labels/val/"
PRED=/opt/cbct-yolo/runs/toothfairy4-subset-pseudolabel-conf055/labels
IMG=/opt/cbct-yolo/toothfairy4-unlabeled-slices-subset/images
i=0
for label in "$PRED"/*.txt; do
  stem=$(basename "$label" .txt)
  split=train
  if [ $((i % 5)) -eq 0 ]; then split=val; fi
  cp "$IMG/$stem.png" "$ROOT/images/$split/tf4_${stem}.png"
  cp "$label" "$ROOT/labels/$split/tf4_${stem}.txt"
  i=$((i+1))
done
cat > "$ROOT/data.yaml" <<EOF
path: $ROOT
train: images/train
val: images/val
names:
  0: tooth
EOF
'
```

Fine-tune:

```bash
ssh ubuntu@192.168.1.52 '
set -e
export YOLO_CONFIG_DIR=/opt/cbct-yolo/yolo-config
. /opt/cbct-yolo/venv/bin/activate
yolo segment train \
  model=/opt/cbct-yolo/runs/toothseg-single-yolov8n-smoke/weights/best.pt \
  data=/opt/cbct-yolo/yolo-combined-toothseg-toothfairy4-pseudo-conf055/data.yaml \
  epochs=5 imgsz=512 batch=4 device=cpu workers=4 \
  project=/opt/cbct-yolo/runs name=toothfairy4-pseudo-refine-yolov8n-5e exist_ok=True
'
```

Export ONNX:

```bash
ssh ubuntu@192.168.1.52 '
set -e
export YOLO_CONFIG_DIR=/opt/cbct-yolo/yolo-config
. /opt/cbct-yolo/venv/bin/activate
yolo export \
  model=/opt/cbct-yolo/runs/toothfairy4-pseudo-refine-yolov8n-5e/weights/best.pt \
  format=onnx imgsz=512 opset=12 simplify=True
'
```

## Copy Back Small Artifacts Only

Do not copy the 42 GB dataset back to the Mac.

Copy a run:

```bash
cd /Users/ahmadjalil/github/CBCTer
mkdir -p outputs/yolo-browser-prototype
scp -r ubuntu@192.168.1.52:/opt/cbct-yolo/runs/toothfairy4-pseudo-refine-yolov8n-5e \
  outputs/yolo-browser-prototype/
```

## Local Documentation

Related docs:

- `/Users/ahmadjalil/github/CBCTer/docs/browser-yolo-seg-prototype.md`
- `/Users/ahmadjalil/github/CBCTer/docs/non-nvidia-tooth-extraction-plan.md`

Related local scripts:

- `/Users/ahmadjalil/github/CBCTer/scripts/export_toothseg_yolo_slices.py`
- `/Users/ahmadjalil/github/CBCTer/scripts/export_cbct_yolo_unlabeled_slices.py`
- `/Users/ahmadjalil/github/CBCTer/scripts/export_nnUNet_teeth_yolo_slices.py`

## Recommended Next Work

1. Run the refined ONNX and the original ONNX on `CBCT-Aug2025-dcm` slices and
   compare predicted masks before making the refined model the browser default.
2. Increase ToothFairy4 pseudo-label coverage from 8 cases to 32 or 64 cases.
3. Use a higher pseudo-label threshold, such as `0.65`, and compare whether the
   refined model becomes cleaner or under-detects.
4. Add a 3D reconstruction step that merges per-slice masks into connected tooth
   components.
5. Keep ToothSeg as the reference baseline; the YOLO models are browser-size
   approximations, not replacements yet.
