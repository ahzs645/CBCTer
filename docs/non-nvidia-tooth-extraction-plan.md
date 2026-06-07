# Non-NVIDIA Tooth Extraction Plan

Last updated: 2026-06-06

This note tracks the practical route for improving CBCTer tooth extraction
without relying on CUDA/Mamba models such as OralSeg or TIPs.

## Current Runnable Stack

### ToothSeg

Status: runnable and currently best individual-tooth model.

Local result on `/Users/ahmadjalil/Downloads/CBCT-Aug2025-dcm`:

- Final checkpoint: 28 FDI teeth.
- Best checkpoint: 28 FDI teeth.
- Missing third molars: `18`, `28`, `38`, `48`.
- Static browser asset roots:
  - `public/sample-segmentation-toothseg`
  - `public/sample-segmentation-toothseg-best`

Use:

- Primary individual-tooth source.
- Provides FDI labels and smoothed STL exports.
- Should be preserved as the baseline model in the browser pipeline.

### RAIL / RailNet

Status: runnable CPU smoke test and local ROI test completed.

Local result:

- `outputs/railnet-cbct-aug2025/railnet_roi_mask.nii.gz`
- Non-empty binary ROI mask.
- 1,738,840 positive voxels on the original 400 x 400 x 280 RAIL grid.

New comparison against ToothSeg:

- Script: `scripts/analyze_non_nvidia_recovery_candidates.py`
- Outputs:
  - `outputs/non-nvidia-recovery/rail-vs-toothseg-dilate4.json`
  - `outputs/non-nvidia-recovery/rail-vs-toothseg-dilate8.json`
  - `outputs/non-nvidia-recovery/rail-vs-toothseg-best-dilate8.json`
- Dilate-8 result against ToothSeg final:
  - RAIL resized positives: 5,211,038 voxels.
  - ToothSeg positives: 3,773,851 voxels.
  - Direct overlap: 2,703,044 voxels.
  - Residual after subtracting dilated ToothSeg union: 1,958,879 voxels.
  - Candidate connected components over 5,000 voxels: 14.

Interpretation:

- RAIL is useful as a broad detector/gate, but its residual is too broad to add
  teeth automatically.
- It can flag "there is likely tooth-like anatomy outside ToothSeg," then the
  recovery step should use posterior ROI constraints, intensity, and manual
  review.

### UNetTransplant

Status: CPU smoke test passed and downsampled CBCT inference completed.

Local result:

- Code: `external/UNetTransplant`
- Weights: `external/UNetTransplant-weights`
- Smoke output: `outputs/unettransplant-smoke.json`
- Downsampled CBCT output:
  `outputs/unettransplant-cbct-aug2025-zscore/summary.json`
- Preprocessing must match the repo: 0.5/99.5 percentile clipping followed by
  z-score normalization. Fixed HU scaling produced an empty mask.
- 128 x 128 x 128 result:
  - probability range: `7.63e-27` to `1.0`
  - positive voxels at threshold 0.5: `73,923`
  - positive fraction: `0.03525`
- Comparison against ToothSeg:
  `outputs/non-nvidia-recovery/unettransplant-vs-toothseg-dilate8.json`
  - resized positives: `4,822,617`
  - ToothSeg overlap: `3,445,583`
  - residual after subtracting dilated ToothSeg: `273,130`
  - residual components over 5,000 voxels: `6`

Use:

- Secondary binary/coarse tooth detector after writing a full-volume NIfTI
  wrapper. A first downsampled wrapper now exists:
  `scripts/run_unettransplant_teeth_roi.py`.
- Not an FDI instance model.
- Good candidate for a second non-NVIDIA validator when RAIL is too broad.

### DentalSegmentator / SlicerDentalSegmentator

Status: existing coarse anatomy baseline.

Use:

- Upper/lower tooth masks.
- Mandible/maxilla/canal gate.
- Constrains postprocessing so tooth recovery does not leak into jaw/air/artifact.

## New Non-NVIDIA Candidates Found

### STSR 2025 nnU-Net Task 1

URLs:

- https://openreview.net/forum?id=qev4UC2rWt
- https://github.com/Ajogeorge29/STS_MCCAI_TASK_01
- https://www.codabench.org/competitions/6468/

Status:

- Code cloned under `external/STS_MCCAI_TASK_01`.
- No GitHub releases.
- No `.pth`, `.ckpt`, `.safetensors`, or model archive found.
- Repo includes Docker/predict scripts and an nnU-Net notebook.
- Architecture is non-Mamba and CPU-feasible in principle.

Blocker:

- The actual `nnUNet_results` trained model folder is not included.

Test path:

- Ask authors for the trained `nnUNet_results` folder/checkpoint used for STSR
  Task 1.
- If obtained, run on `cbct-node` first because it has 213 GB usable disk.

### Cui Tooth / Alveolar Bone VNet Pipeline

URLs:

- https://github.com/ErdanC/Tooth-and-alveolar-bone-segmentation-from-CBCT
- https://www.nature.com/articles/s41467-022-29637-2

Status:

- Code cloned under `external/Cui-Tooth-Alveolar`.
- VNet-style code, no Mamba.
- No trained weights found.
- README explicitly says the trained model from the large dataset cannot be
  released for commercial reasons.

Use:

- Strong source for postprocessing ideas: ROI localization, centroid/skeleton
  detection, single-tooth segmentation.
- Not immediately runnable as a model.

### Internal Tooth Segmentation

URLs:

- https://github.com/Saeeeae/Internal-Tooth-Segmentation
- https://conferences.miccai.org/2023/papers/084-Paper2746.html

Status:

- Code cloned under `external/Internal-Tooth-Segmentation`.
- README says training and prediction code will be updated soon.
- No usable code or weights found.

Use:

- Track for pulp/internal structure only. Not useful for current FDI recovery.

### CISA-UNet / FDNet / 3D-U-SAM / PPA-SAM

Status:

- Paper-level leads found.
- No immediately usable pretrained CBCT weights found in this pass.

Use:

- Candidate methods for future training/fine-tuning if we obtain labeled data.
- Not immediate sidecar candidates.

## Practical Recovery Strategy

### Stage 1: ToothSeg Baseline

Use ToothSeg final or best checkpoint output as the authoritative FDI set.
Export browser assets with smoothed STLs.

### Stage 2: Coarse Gates

Create a consensus tooth-likelihood mask from:

- ToothSeg union.
- RAIL binary ROI.
- DentalSegmentator upper/lower teeth.
- Optional UNetTransplant tooth mask once a full-volume wrapper exists.

Do not add RAIL residual components directly. Use them as suggestions.

### Stage 3: Third-Molar Recovery

For missing `18`, `28`, `38`, `48`:

1. Estimate each missing target's posterior ROI from neighboring second molar
   centroid and arch direction.
2. Intersect the target ROI with RAIL/DentalSegmentator/thresholded hard tissue.
3. Run connected components and watershed inside the ROI.
4. Score candidate masks by:
   - proximity to the neighboring second molar,
   - tooth-like volume range,
   - high-intensity enamel/dentin fraction,
   - separation from existing ToothSeg labels,
   - whether RAIL or another detector includes the region.
5. Present candidates in the interactive recovery UI rather than auto-committing
   them.

Initial run:

- Script: `scripts/generate_third_molar_recovery_candidates.py`
- Output: `outputs/non-nvidia-recovery/third-molar-candidates`
- Contact sheet:
  `outputs/non-nvidia-recovery/third-molar-candidates/contact-sheet.png`
- Candidate count: 5.
- Candidate FDIs: `18` x2, `28` x1, `38` x1, `48` x1.
- Score range: 0.0115 to 0.2209.

Interpretation:

- The first pass did not find convincing full third-molar masks.
- Visual review shows small posterior hard-tissue fragments/cortical regions
  rather than tooth-shaped third molars.
- These candidates should be rejected by default and used only to debug the
  recovery ROI logic.
- This supports the possibility that the scan truly lacks visible/extractable
  third molars, or that the third molars are too artifact-limited for the current
  non-NVIDIA recovery gates.

Second run with RAIL and UNetTransplant agreement:

- Output:
  `outputs/non-nvidia-recovery/third-molar-candidates-rail-unettransplant`
- Candidate count: 0.

Interpretation:

- Requiring both non-NVIDIA detectors removes the weak RAIL-only fragments.
- Current evidence does not support automatic third-molar recovery on this scan.
- The browser workflow should present missing `18`, `28`, `38`, and `48` as
  absent/unconfirmed unless the user manually paints or accepts a future stronger
  candidate.

### Stage 4: Browser Library Export

When a candidate is accepted:

- add it as a manual/recovered tooth item,
- assign the target FDI number,
- generate preview image,
- generate smoothed STL,
- export it into the same tooth-library manifest shape as ToothSeg.

## Current Priority

1. Implement a third-molar candidate generator from ToothSeg + RAIL +
   DentalSegmentator/hard-tissue thresholding.
2. Improve UNetTransplant from downsampled one-pass inference to tiled
   higher-resolution inference if we need a second tooth gate.
3. Add accepted recovered masks to persistent browser sample assets, not only
   in-memory manual library.
4. Request STSR 2025 nnU-Net trained `nnUNet_results` folder.
5. Keep watching TAPSeg and request its Slicer extension/weights when released.
