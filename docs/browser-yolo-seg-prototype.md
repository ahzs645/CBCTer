# Browser YOLO Segmentation Prototype

Last updated: 2026-06-06

This tracks the small client-side segmentation experiment trained from ToothSeg
pseudo-labels on `CBCT-Aug2025-dcm`.

## Server

- Proxmox VM: `cbct-node`
- IP: `192.168.1.52`
- Path: `/opt/cbct-yolo`
- Runtime: CPU-only PyTorch, no NVIDIA GPU

## Dataset

Exporter:

- `scripts/export_toothseg_yolo_slices.py`

Local datasets:

- `outputs/yolo-toothseg-slices-single`
- `outputs/yolo-toothseg-slices-fdi`

Single-class dataset:

- 248 labeled 2D slices
- 198 train slices
- 50 validation slices
- 1,619 tooth-mask objects
- Classes: `tooth`

The labels come from ToothSeg, so this is a pseudo-label browser prototype, not
independent ground truth.

## Smoke Model

Training command on `cbct-node`:

```bash
yolo segment train model=yolov8n-seg.pt \
  data=/opt/cbct-yolo/yolo-toothseg-slices-single/data.yaml \
  epochs=5 imgsz=512 batch=4 device=cpu workers=4 \
  project=/opt/cbct-yolo/runs name=toothseg-single-yolov8n-smoke
```

Local artifacts:

- `outputs/yolo-browser-prototype/toothseg-single-yolov8n-smoke/weights/best.pt`
- `outputs/yolo-browser-prototype/toothseg-single-yolov8n-smoke/weights/best.onnx`
- `outputs/yolo-browser-prototype/toothseg-single-yolov8n-smoke/results.csv`
- `outputs/yolo-browser-prototype/toothseg-single-yolov8n-smoke-predict`
- `outputs/yolo-browser-prototype/yolov8n-smoke-prediction-contact-sheet.jpg`

Sizes:

- PyTorch checkpoint: 6.4 MB
- ONNX export: 13 MB

Final 5-epoch validation on held-out slices from the same scan:

- Box precision: 0.94367
- Box recall: 0.87580
- Box mAP50: 0.95332
- Box mAP50-95: 0.76090
- Mask precision: 0.94367
- Mask recall: 0.87580
- Mask mAP50: 0.95523
- Mask mAP50-95: 0.70345

Predict speed on `cbct-node` CPU:

- About 28.7 ms inference per 512 x 512 slice
- About 1.8 ms postprocess per slice

## Interpretation

This confirms a browser-sized YOLO segmentation model can learn tooth-shaped 2D
masks from ToothSeg pseudo-labels. It does not yet replace ToothSeg because it
was trained and validated on slices from one scan, and it predicts 2D masks
rather than coherent 3D FDI tooth instances.

Next useful steps:

1. Export more ToothSeg-labeled scans into the same YOLO format.
2. Train `yolov8n-seg` or `yolo11n-seg` on multi-scan data.
3. Add browser ONNX Runtime Web inference for slice masks.
4. Reconstruct 3D components from per-slice masks and compare against ToothSeg.
5. Train/test the 32-class FDI dataset after the single-class path is stable.

## ToothFairy4 Server Refinement

Requested source:

- `https://ditto.ing.unimore.it/download/dataset/NDEyOQ/d9qiac-05d20da14b05960cfeb1742bf8cc779e/19`

Current status:

- Downloaded directly on `cbct-node`.
- No dataset bytes were downloaded to the Mac.
- Server archive: `/opt/cbct-yolo/datasets/ditto-19/toothfairy4.zip`
- Archive size: 42 GB.
- Archive contents: 627 CBCT `volume.nii.gz` files plus English/Italian text
  reports.
- No segmentation masks, label folders, or ground-truth annotations were found
  in this archive.

Because this ToothFairy4 archive is unlabeled for segmentation, it cannot train
the tooth-mask model directly. The first refinement pass used self-training:
the current small YOLO model generated high-confidence pseudo-labels on
ToothFairy4 slices, then the model was fine-tuned on ToothSeg slices plus those
pseudo-labeled ToothFairy4 slices.

Prepared converter:

- `scripts/export_nnUNet_teeth_yolo_slices.py`
- `scripts/export_cbct_yolo_unlabeled_slices.py`

Expected dataset layout after download/unzip:

- `imagesTr` and `labelsTr`, or
- `images` and `labels`

The converter uses ToothFairy3-style FDI whole-tooth labels `11-48` and ignores
pulp labels `111-148` unless `--include-pulp` is passed.

Server conversion command once the zip is available on `cbct-node`:

```bash
python3 /opt/cbct-yolo/scripts/export_nnUNet_teeth_yolo_slices.py \
  --dataset-dir /opt/cbct-yolo/datasets/ditto-19/ToothFairy3 \
  --output-dir /opt/cbct-yolo/yolo-toothfairy3-single \
  --axes z y x --stride 6 --min-area 80 --simplify-step 4 \
  --single-class --max-cases 32
```

Then train:

```bash
export YOLO_CONFIG_DIR=/opt/cbct-yolo/yolo-config
. /opt/cbct-yolo/venv/bin/activate
yolo segment train model=/opt/cbct-yolo/runs/toothseg-single-yolov8n-smoke/weights/best.pt \
  data=/opt/cbct-yolo/yolo-toothfairy3-single/data.yaml \
  epochs=20 imgsz=512 batch=4 device=cpu workers=4 \
  project=/opt/cbct-yolo/runs name=toothfairy3-single-yolov8n-refine
```

Actual ToothFairy4 pseudo-refine run:

- Extracted cases: `A003`, `A004`, `A005`, `A008`, `A009`, `A010`, `A011`,
  `A012`
- Unlabeled slices exported: 726
- Pseudo-label confidence threshold: `0.55`
- Pseudo-labeled slices: 523
- Combined training dataset:
  - 616 train slices
  - 155 validation slices
- Server dataset:
  `/opt/cbct-yolo/yolo-combined-toothseg-toothfairy4-pseudo-conf055`
- Local dataset summary:
  `outputs/yolo-browser-prototype/toothfairy4-pseudo-dataset-summary.json`

Training command:

```bash
yolo segment train \
  model=/opt/cbct-yolo/runs/toothseg-single-yolov8n-smoke/weights/best.pt \
  data=/opt/cbct-yolo/yolo-combined-toothseg-toothfairy4-pseudo-conf055/data.yaml \
  epochs=5 imgsz=512 batch=4 device=cpu workers=4 \
  project=/opt/cbct-yolo/runs name=toothfairy4-pseudo-refine-yolov8n-5e
```

Local artifacts:

- `outputs/yolo-browser-prototype/toothfairy4-pseudo-refine-yolov8n-5e/weights/best.pt`
- `outputs/yolo-browser-prototype/toothfairy4-pseudo-refine-yolov8n-5e/weights/best.onnx`
- `outputs/yolo-browser-prototype/toothfairy4-pseudo-refine-yolov8n-5e/results.csv`

Sizes:

- PyTorch checkpoint: 6.4 MB
- ONNX export: 13 MB

Final 5-epoch pseudo-validation:

- Box precision: 0.85647
- Box recall: 0.88259
- Box mAP50: 0.94009
- Box mAP50-95: 0.73008
- Mask precision: 0.86944
- Mask recall: 0.87174
- Mask mAP50: 0.93767
- Mask mAP50-95: 0.60150

Interpretation:

- This is a domain-adapted browser-size model, not a ground-truth-supervised
  model.
- The numbers measure agreement with generated pseudo-labels, so they are
  useful for stability/regression checks but should not be presented as clinical
  segmentation accuracy.
- The next refinement should add more ToothFairy4 cases and compare refined
  model output against the original YOLO model on `CBCT-Aug2025-dcm` before
  replacing any browser default.
