#!/usr/bin/env bash
set -euo pipefail

# Compare ToothSeg checkpoint_final.pth vs checkpoint_best.pth on an already
# prepared case. The normal pipeline writes checkpoint_final outputs; this script
# runs checkpoint_best into sibling folders and summarizes label counts.

CASE_ID="${CASE_ID:-cbct_aug2025}"
WORK_DIR="${WORK_DIR:-outputs/toothseg-cbct-aug2025}"
DICOM_DIR="${DICOM_DIR:-/Users/ahmadjalil/Downloads/CBCT-Aug2025-dcm}"
PUBLIC_BEST_DIR="${PUBLIC_BEST_DIR:-public/sample-segmentation-toothseg-best}"
TOOTHSEG_CODE="${TOOTHSEG_CODE:-external/ToothSeg}"
TOOTHSEG_RESULTS="${TOOTHSEG_RESULTS:-external/ToothSeg-checkpoints/nnUNet_results/ToothSeg}"
DEVICE="${TOOTHSEG_DEVICE:-mps}"
SMOOTH_ITERATIONS="${TOOTHSEG_SMOOTH_ITERATIONS:-8}"

export nnUNet_results="$(cd "$(dirname "$TOOTHSEG_RESULTS")" && pwd)/$(basename "$TOOTHSEG_RESULTS")"
export nnUNet_raw="$(pwd)/${WORK_DIR}/nnUNet_raw"
export nnUNet_preprocessed="$(pwd)/${WORK_DIR}/nnUNet_preprocessed"
export nnUNet_compile=F

if [[ ! -f "${WORK_DIR}/input/imagesTs/${CASE_ID}_0000.nii.gz" ]]; then
  echo "Missing ${WORK_DIR}/input/imagesTs/${CASE_ID}_0000.nii.gz; run scripts/run_toothseg_browser_pipeline.sh first." >&2
  exit 1
fi

if [[ ! -f "${WORK_DIR}/input/imagesTs_resized_for_instanceseg_spacing_02_02_02/${CASE_ID}_0000.nii.gz" ]]; then
  python3 "${TOOTHSEG_CODE}/toothseg/toothseg/test_set_prediction_and_eval/resize_test_set.py" \
    -i "${WORK_DIR}/input/imagesTs" \
    -o "${WORK_DIR}/input/imagesTs_resized_for_instanceseg_spacing_02_02_02"
fi

nnUNetv2_predict --continue_prediction --disable_tta \
  -i "${WORK_DIR}/input/imagesTs" \
  -o "${WORK_DIR}/semseg_branch_best" \
  -d Dataset121_ToothFairy2_Teeth \
  -tr nnUNetTrainer_onlyMirror01_DASegOrd0 \
  -p nnUNetPlans \
  -c 3d_fullres_resample_torch_256_bs8_ctnorm \
  -f 5 \
  -chk checkpoint_best.pth \
  -npp 1 \
  -nps 1 \
  -device "$DEVICE"

nnUNetv2_predict --continue_prediction --disable_tta \
  -i "${WORK_DIR}/input/imagesTs_resized_for_instanceseg_spacing_02_02_02" \
  -o "${WORK_DIR}/instseg_branch_border_core_best" \
  -d Dataset123_ToothFairy2fixed_teeth_spacing02_brd3px \
  -tr nnUNetTrainer \
  -p nnUNetPlans \
  -c 3d_fullres_resample_torch_192_bs8_ctnorm \
  -f 5 \
  -chk checkpoint_best.pth \
  -npp 1 \
  -nps 1 \
  -device "$DEVICE"

python3 "${TOOTHSEG_CODE}/toothseg/toothseg/postprocess_predictions/border_core_to_instances.py" \
  -i "${WORK_DIR}/instseg_branch_border_core_best" \
  -o "${WORK_DIR}/instseg_branch_border_core_best_converted_to_instances" \
  -np 1

python3 "${TOOTHSEG_CODE}/toothseg/toothseg/postprocess_predictions/resize_predictions.py" \
  -i "${WORK_DIR}/instseg_branch_border_core_best_converted_to_instances" \
  -o "${WORK_DIR}/instseg_branch_border_core_best_converted_to_instances_resized" \
  -ref "${WORK_DIR}/input/imagesTs" \
  -np 1

python3 "${TOOTHSEG_CODE}/toothseg/toothseg/postprocess_predictions/assign_majority_tooth_labels.py" \
  -ifolder "${WORK_DIR}/instseg_branch_border_core_best_converted_to_instances_resized" \
  -sfolder "${WORK_DIR}/semseg_branch_best" \
  -o "${WORK_DIR}/final_prediction_best" \
  -np 1

python3 scripts/recover_toothseg_semantic_labels.py \
  --semantic "${WORK_DIR}/semseg_branch_best/${CASE_ID}.nii.gz" \
  --final "${WORK_DIR}/final_prediction_best/${CASE_ID}.nii.gz" \
  --output "${WORK_DIR}/final_prediction_best_recovered/${CASE_ID}.nii.gz"

python3 scripts/export_toothseg_prediction.py \
  --prediction "${WORK_DIR}/final_prediction_best_recovered/${CASE_ID}.nii.gz" \
  --dicom-dir "$DICOM_DIR" \
  --output-dir "$PUBLIC_BEST_DIR" \
  --smooth-iterations "$SMOOTH_ITERATIONS"

python3 scripts/summarize_toothseg_checkpoint_comparison.py \
  --final-public public/sample-segmentation-toothseg \
  --best-public "$PUBLIC_BEST_DIR" \
  --output "${WORK_DIR}/checkpoint-comparison.json"
