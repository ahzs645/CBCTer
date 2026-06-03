#!/usr/bin/env bash
set -euo pipefail

# Run ToothSeg against a DICOM folder and export CBCTer browser assets.
# Usage:
#   scripts/run_toothseg_browser_pipeline.sh /path/to/dicom-folder
#
# Prerequisites:
# - ToothSeg repo installed (`python3 -m pip install -e external/ToothSeg SimpleITK nibabel`)
# - ToothSeg checkpoints extracted under:
#   external/ToothSeg-checkpoints/nnUNet_results/ToothSeg

DICOM_DIR="${1:-/Users/ahmadjalil/Downloads/CBCT-Aug2025-dcm}"
CASE_ID="${CASE_ID:-cbct_aug2025}"
WORK_DIR="${WORK_DIR:-outputs/toothseg-cbct-aug2025}"
PUBLIC_DIR="${PUBLIC_DIR:-public/sample-segmentation-toothseg}"
TOOTHSEG_CODE="${TOOTHSEG_CODE:-external/ToothSeg}"
TOOTHSEG_RESULTS="${TOOTHSEG_RESULTS:-external/ToothSeg-checkpoints/nnUNet_results/ToothSeg}"
DEVICE="${TOOTHSEG_DEVICE:-mps}"
SMOOTH_ITERATIONS="${TOOTHSEG_SMOOTH_ITERATIONS:-8}"

export nnUNet_results="$(cd "$(dirname "$TOOTHSEG_RESULTS")" && pwd)/$(basename "$TOOTHSEG_RESULTS")"
export nnUNet_raw="$(pwd)/${WORK_DIR}/nnUNet_raw"
export nnUNet_preprocessed="$(pwd)/${WORK_DIR}/nnUNet_preprocessed"
export nnUNet_compile=F

mkdir -p \
  "${WORK_DIR}/input/imagesTs" \
  "${WORK_DIR}/input/imagesTs_resized_for_instanceseg_spacing_02_02_02" \
  "${WORK_DIR}/semseg_branch" \
  "${WORK_DIR}/instseg_branch_border_core" \
  "$nnUNet_raw" \
  "$nnUNet_preprocessed"

python3 - "$DICOM_DIR" "${WORK_DIR}/input/imagesTs/${CASE_ID}_0000.nii.gz" <<'PY'
from pathlib import Path
import sys

import numpy as np
import pydicom
import SimpleITK as sitk

dicom_dir = Path(sys.argv[1])
out = Path(sys.argv[2])
records = []
for path in dicom_dir.rglob("*"):
    if not path.is_file():
        continue
    try:
        ds = pydicom.dcmread(str(path))
    except Exception:
        continue
    pos = getattr(ds, "ImagePositionPatient", None)
    key = float(pos[2]) if pos is not None and len(pos) >= 3 else float(getattr(ds, "InstanceNumber", 0))
    records.append((key, ds))
records.sort(key=lambda item: item[0])
if not records:
    raise SystemExit(f"No DICOM files found under {dicom_dir}")

planes = []
for _key, ds in records:
    slope = float(getattr(ds, "RescaleSlope", 1.0))
    intercept = float(getattr(ds, "RescaleIntercept", 0.0))
    planes.append((ds.pixel_array.astype(np.float32) * slope + intercept).astype(np.int16))
volume = np.stack(planes, axis=0)
first = records[0][1]
sy, sx = [float(v) for v in getattr(first, "PixelSpacing", [1, 1])]
if len(records) > 1 and hasattr(records[0][1], "ImagePositionPatient") and hasattr(records[1][1], "ImagePositionPatient"):
    sz = abs(float(records[1][1].ImagePositionPatient[2]) - float(records[0][1].ImagePositionPatient[2]))
else:
    sz = float(getattr(first, "SliceThickness", sy))
image = sitk.GetImageFromArray(volume)
image.SetSpacing((sx, sy, sz))
sitk.WriteImage(image, str(out))
print(f"Wrote {out} shapeZYX={volume.shape} spacingXYZ={(sx, sy, sz)}")
PY

python3 "${TOOTHSEG_CODE}/toothseg/toothseg/test_set_prediction_and_eval/resize_test_set.py" \
  -i "${WORK_DIR}/input/imagesTs" \
  -o "${WORK_DIR}/input/imagesTs_resized_for_instanceseg_spacing_02_02_02"

nnUNetv2_predict --continue_prediction --disable_tta \
  -i "${WORK_DIR}/input/imagesTs" \
  -o "${WORK_DIR}/semseg_branch" \
  -d Dataset121_ToothFairy2_Teeth \
  -tr nnUNetTrainer_onlyMirror01_DASegOrd0 \
  -p nnUNetPlans \
  -c 3d_fullres_resample_torch_256_bs8_ctnorm \
  -f 5 \
  -npp 1 \
  -nps 1 \
  -device "$DEVICE"

nnUNetv2_predict --continue_prediction --disable_tta \
  -i "${WORK_DIR}/input/imagesTs_resized_for_instanceseg_spacing_02_02_02" \
  -o "${WORK_DIR}/instseg_branch_border_core" \
  -d Dataset123_ToothFairy2fixed_teeth_spacing02_brd3px \
  -tr nnUNetTrainer \
  -p nnUNetPlans \
  -c 3d_fullres_resample_torch_192_bs8_ctnorm \
  -f 5 \
  -npp 1 \
  -nps 1 \
  -device "$DEVICE"

python3 "${TOOTHSEG_CODE}/toothseg/toothseg/postprocess_predictions/border_core_to_instances.py" \
  -i "${WORK_DIR}/instseg_branch_border_core" \
  -o "${WORK_DIR}/instseg_branch_border_core_converted_to_instances" \
  -np 1

python3 "${TOOTHSEG_CODE}/toothseg/toothseg/postprocess_predictions/resize_predictions.py" \
  -i "${WORK_DIR}/instseg_branch_border_core_converted_to_instances" \
  -o "${WORK_DIR}/instseg_branch_border_core_converted_to_instances_resized" \
  -ref "${WORK_DIR}/input/imagesTs" \
  -np 1

python3 "${TOOTHSEG_CODE}/toothseg/toothseg/postprocess_predictions/assign_majority_tooth_labels.py" \
  -ifolder "${WORK_DIR}/instseg_branch_border_core_converted_to_instances_resized" \
  -sfolder "${WORK_DIR}/semseg_branch" \
  -o "${WORK_DIR}/final_prediction" \
  -np 1

python3 scripts/recover_toothseg_semantic_labels.py \
  --semantic "${WORK_DIR}/semseg_branch/${CASE_ID}.nii.gz" \
  --final "${WORK_DIR}/final_prediction/${CASE_ID}.nii.gz" \
  --output "${WORK_DIR}/final_prediction_recovered/${CASE_ID}.nii.gz"

python3 scripts/export_toothseg_prediction.py \
  --prediction "${WORK_DIR}/final_prediction_recovered/${CASE_ID}.nii.gz" \
  --dicom-dir "$DICOM_DIR" \
  --output-dir "$PUBLIC_DIR" \
  --smooth-iterations "$SMOOTH_ITERATIONS"

echo "ToothSeg browser assets written to ${PUBLIC_DIR}"
