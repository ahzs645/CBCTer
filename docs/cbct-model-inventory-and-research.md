# CBCT Model Inventory And Research

Last updated: 2026-06-02

This note records the models currently present in CBCTer, the observed behavior
on `/Users/ahmadjalil/Downloads/CBCT-Aug2025-dcm`, and external alternatives
worth evaluating for individual tooth extraction.

## Current Local Models

| Model | Local path | Size | Runtime role | Browser-ready |
|---|---|---:|---|---|
| DentalSegmentator | `public/models/dentalsegmentator.onnx` | 123 MB | Coarse dental anatomy: upper skull, mandible, upper teeth, lower teeth, mandibular canal | Yes |
| AMASSS skin | `public/models/amasss-skin.onnx` | 126 MB | Soft-tissue/skin surface | Yes |
| AMASSS UAW | `public/models/amasss-uaw.onnx` | 126 MB | Upper airway, currently best-effort wired | Yes |
| Browser tooth UNet | `public/models/tooth-unet-96.onnx` | 4.5 MB | Legacy in-browser tooth ROI model | Yes |
| ROI tooth crop model | `models/model-toothcrops-CBCT-normalize_best.pth` | 4.6 MB | Legacy Python ROI tooth crop model | No |
| ToothSeg semantic branch, best | `external/ToothSeg-checkpoints/.../Dataset121.../fold_5/checkpoint_best.pth` | 237 MB | FDI semantic tooth classes | Python sidecar |
| ToothSeg semantic branch, final | `external/ToothSeg-checkpoints/.../Dataset121.../fold_5/checkpoint_final.pth` | 238 MB | FDI semantic tooth classes | Python sidecar |
| ToothSeg instance branch, best | `external/ToothSeg-checkpoints/.../Dataset123.../fold_5/checkpoint_best.pth` | 235 MB | Tooth instance border/core branch | Python sidecar |
| ToothSeg instance branch, final | `external/ToothSeg-checkpoints/.../Dataset123.../fold_5/checkpoint_final.pth` | 235 MB | Tooth instance border/core branch | Python sidecar |

Folder totals:

| Folder | Size | Notes |
|---|---:|---|
| `public/models` | 379 MB | Browser ONNX models |
| `models` | 4.6 MB | Legacy local PyTorch ROI model |
| `external/ToothSeg-checkpoints` | 949 MB | ToothSeg downloaded checkpoints, ignored by git |

For ToothSeg production runs, we likely only need `checkpoint_best.pth` for each
branch unless validation shows `checkpoint_final.pth` is better. That would reduce
the active ToothSeg weight footprint from about 949 MB to about 472 MB.

## Observed Performance On CBCT-Aug2025

This is not a ground-truth accuracy benchmark. There is no clinician-verified
labelmap for this scan, so the numbers below are observed output counts,
volumes, shape checks, and practical trust level.

| Model / pipeline | Observed output | Practical result |
|---|---|---|
| ToothSeg + semantic recovery + cleanup | 28 separated FDI teeth, 28 accepted, shape audit 28/28 OK, `3,771,451` positive voxels | Best individual tooth result currently available |
| ToothSeg before recovery | 25 separated FDI teeth | Missed 3 semantically detected teeth due to majority assignment collapse |
| ToothSeg semantic branch alone | 28 FDI classes present | Third molars `18`, `28`, `38`, `48` had zero semantic voxels |
| DentalSegmentator | Upper teeth ~7.879 cm3, lower teeth ~7.586 cm3, plus skull/mandible/canal | Good coarse anatomy gate, not individual teeth |
| AMASSS skin | Skin/soft tissue ~529.249 cm3 | Useful for face surface, not tooth extraction |
| AMASSS UAW | Upper airway ~0.019 cm3 in best-effort run | Not reliable as currently wired |
| Legacy browser tooth UNet / ROI model | Existing sample libraries show 11 accepted / 16 candidates | Not trusted for this scan |
| Hybrid watershed / ROI model | Existing sample library shows 16 accepted / 30 candidates | Better than raw ROI model but weaker than ToothSeg |

Staged ONNX patch counts on the real CBCT:

| Model | Resampled shape ZYX | Patches |
|---|---:|---:|
| DentalSegmentator | `190 x 263 x 190` | 8 |
| AMASSS skin | `205 x 205 x 205` | 8 |
| AMASSS UAW | `205 x 205 x 205` | 8 |

## Current ToothSeg Pipeline

The current sidecar pipeline is:

1. Convert DICOM folder to NIfTI.
2. Run ToothSeg semantic branch.
3. Resize input for instance branch.
4. Run ToothSeg instance border/core branch.
5. Convert border/core output to instances.
6. Resize instances back to original image grid.
7. Assign semantic labels by majority vote.
8. Recover semantic tooth labels that were swallowed by instance-majority
   assignment.
9. Remove small disconnected islands.
10. Export CBCTer browser assets: `manifest.json`, `labels.npz`, previews, and
    smoothed binary STL meshes.

The reusable command is:

```bash
scripts/run_toothseg_browser_pipeline.sh /Users/ahmadjalil/Downloads/CBCT-Aug2025-dcm
```

The recovery step currently restores FDI `14`, `24`, and `41` on this scan.
It cannot recover FDI `18`, `28`, `38`, or `48` because the semantic branch
predicted zero voxels for those third molars.

## Interactive Recovery Status

The browser now exposes missing permanent FDI numbers on `/teeth`.

For missing FDI slots, the UI supports:

- `Manual`: stores the recovery target and opens the viewer.
- `Absent`: marks that slot as intentionally absent in local UI state.

In the viewer, a manual recovery target automatically creates and selects an
empty mask/segment group named `Manual FDI <number>`, switches to brush mode,
and shows a banner with the intended tooth name.

Remaining implementation work:

1. Export the active manual mask back into the ToothSeg library format as the
   selected FDI.
2. Generate a smoothed STL and preview for the manual tooth.
3. Merge the manual item into `public/sample-segmentation-toothseg/manifest.json`
   or into an in-browser generated manifest without mutating the static sample.

## External Alternatives To Evaluate

### 1. GEPAR3D

URL: https://github.com/tomek1911/GEPAR3D

Paper/project pages:

- https://tomek1911.github.io/GEPAR3D/
- https://arxiv.org/abs/2508.00155

Why it matters:

- MICCAI 2025 work focused on 3D tooth segmentation with geometry priors.
- Reports average DSC 95.0% and recall 95.2% across test sets.
- Specifically emphasizes better root apex segmentation and robustness.
- The project page compares against ToothSeg and highlights missing teeth in
  gray, suggesting missing-tooth handling is part of its evaluation framing.

Fit for CBCTer:

- High-priority Python sidecar candidate.
- Likely not browser-native initially.
- Evaluate for whether pretrained weights are available and whether output is
  FDI-instance compatible.

### 2. OraSeg / OralSeg

Paper:

- https://pmc.ncbi.nlm.nih.gov/articles/PMC12464119/
- https://pubmed.ncbi.nlm.nih.gov/40996470/

Model:

- https://huggingface.co/aiadir/OralSeg

Why it matters:

- Recent CBCT tooth-level instance segmentation framework.
- Article states the dataset annotations include individual teeth with FDI
  numbering, maxilla, mandible, and mandibular canals.
- Hugging Face model card states it segments maxilla, mandible, 32 teeth
  including wisdom teeth, and bilateral mandibular canals.
- Based on SwinUNETR.

Fit for CBCTer:

- High-priority research target if code/weights are accessible.
- Could become a sidecar alternative to ToothSeg.
- Best specific candidate for testing third molars because wisdom teeth are
  explicitly included in the model card.
- License is CC BY-NC 4.0, so commercial use would be blocked unless separately
  licensed.

### 3. TIPs

URL:

- https://github.com/TaoZhong11/TIPs

Paper:

- https://www.sciencedirect.com/science/article/pii/S0933365725001824

Why it matters:

- Public tool for tooth instance and pulp segmentation from CBCT.
- README states final instance labeling follows FDI World Dental Federation
  notation.
- Provides a model download link and requires no retraining for inference.
- Apache 2.0 license in the repository.

Fit for CBCTer:

- Strong Python sidecar candidate, especially if pulp/root association becomes
  useful.
- Not browser-native initially: requirements include Ubuntu 20.04, CUDA 11.8,
  PyTorch 2.0.1, and Mamba dependencies.
- Worth testing after ToothSeg because it is public, FDI-oriented, and may
  behave differently on missing/third-molar cases.

### 4. TAPSeg

Paper:

- https://pubmed.ncbi.nlm.nih.gov/41865812/

Why it matters:

- Open-source tool for instance-level tooth and pulp segmentation in CBCT.
- PubMed abstract reports tooth DSC ranges of 91.5%-94.2% and pulp DSC ranges
  of 91.0%-92.2% across test sets.
- Tooth+pulp association could be useful for endodontic workflows beyond crowns.

Fit for CBCTer:

- Promising sidecar candidate.
- Need to locate public repository, license, and checkpoint availability.

### 5. ToothSeg Baselines

URL:

- https://zenodo.org/records/14893540
- https://github.com/MIC-DKFZ/ToothSeg

Why it matters:

- The ToothSeg Zenodo record includes `Baselines.zip` in addition to ToothSeg
  checkpoints.
- Baselines may include alternative architectures from the ToothSeg paper.

Fit for CBCTer:

- Practical next experiment because it is the same ecosystem and checkpoint
  source.
- Downside: `Baselines.zip` is about 2.8 GB, so this is heavier than the current
  ToothSeg weights.

### 6. DentalSegmentator

URL:

- https://github.com/gaudot/SlicerDentalSegmentator

Why it matters:

- Already effectively present in browser ONNX form.
- Robust coarse anatomy gate for skull, mandible, upper/lower teeth, mandibular
  canal.

Fit for CBCTer:

- Keep as coarse detection/validation, not as individual extraction.
- Use it to constrain interactive/manual tooth recovery and reject off-arch
  masks.

### 7. ToothFairy2 Benchmark

URLs:

- https://github.com/AImageLab-zip/ToothFairy2-Benchmark
- https://toothfairy2.grand-challenge.org/toothfairy2/

Why it matters:

- Multi-structure CBCT benchmark with 530 CBCT volumes.
- Published description reports 42 annotated classes including maxilla,
  mandible, restorations/implants, canals, sinuses, pharynx, and teeth using
  FDI numbering.
- Useful anchor for comparing ToothSeg, baselines, and future CBCTer sidecars.

Fit for CBCTer:

- Benchmark/training substrate rather than a drop-in model.
- Use its class conventions to keep FDI label output consistent.
- Dataset terms need review before any commercial use.

### 8. STS 2023 / STS 2024 Challenges

URLs:

- https://sts-challenge.github.io/
- https://arxiv.org/abs/2511.22911
- https://www.codabench.org/competitions/3025/

Why it matters:

- STS 2024 includes semi-supervised instance-level tooth segmentation on
  panoramic X-ray and CBCT.
- The arXiv summary reports over 90,000 2D images/3D axial slices, 2,380 OPG
  images, and 330 CBCT scans with instance-level FDI annotations on part of the
  data.
- Codabench task requires predicted masks to use the exact FDI number as the
  instance value, matching CBCTer’s desired output format.
- Evaluation includes segmentation accuracy plus runtime and GPU memory.

Fit for CBCTer:

- Strong benchmark and data/source of ideas.
- Not a single drop-in production model; challenge submissions vary and may
  require cleanup.
- Useful for designing our own evaluation harness for missing teeth and runtime.

### 9. ToothNet / Historical CBCT Instance Segmentation

Paper:

- https://openaccess.thecvf.com/content_CVPR_2019/papers/Cui_ToothNet_Automatic_Tooth_Instance_Segmentation_and_Identification_From_Cone_Beam_CVPR_2019_paper.pdf

Related repository found:

- https://github.com/ErdanC/Tooth-and-alveolar-bone-segmentation-from-CBCT

Why it matters:

- Established top-down detection + segmentation approach.
- Useful conceptually for third molars because it treats tooth detection as a
  separate step.

Fit for CBCTer:

- Lower priority unless pretrained weights are available.
- More useful as design input for a third-molar detector/seed proposal workflow.

### 10. PXseg And 2D/3D Hybrid Methods

Paper:

- https://link.springer.com/article/10.1186/s12903-025-06356-w

Why it matters:

- Combines CBCT and panoramic radiographs for tooth segmentation/numbering and
  abnormal morphology detection.
- Relevant to using panoramic projections as a fast detector layer.

Fit for CBCTer:

- Not a direct 3D replacement.
- Useful for a browser-first detector that proposes missing third-molar ROIs on
  panoramic or MIP projections, then hands off to manual/region-grow refinement.

## Recommended Next Experiments

1. **ToothSeg checkpoint pruning**
   - Run a controlled `best` vs `final` comparison for both branches.
   - If `best` and `final` are equivalent for our cases, keep only one pair.

2. **OralSeg third-molar smoke test**
   - Download/test the Hugging Face OralSeg model if non-commercial terms are
     acceptable for this experiment.
   - Compare specifically on FDI `18`, `28`, `38`, and `48`.

3. **TIPs sidecar smoke test**
   - Clone TIPs, review model download and environment requirements.
   - Test whether it catches third molars or produces better tooth+pulp masks.

4. **ToothSeg baselines smoke test**
   - Download `Baselines.zip` only if disk/network budget allows.
   - Test whether any baseline catches the four third molars on this scan.

5. **GEPAR3D feasibility spike**
   - Clone repo.
   - Check license, install complexity, pretrained weights, expected input/output
     format.
   - Run against the same DICOM-derived NIfTI if weights are available.

6. **Interactive third-molar recovery**
   - Finish exporting a painted/grown manual mask as FDI `18`, `28`, `38`, or
     `48`.
   - Use DentalSegmentator upper/lower tooth masks as a constraint.
   - Add a panoramic/MIP locator to jump to likely third-molar regions.

## Sources

- ToothSeg repository: https://github.com/MIC-DKFZ/ToothSeg
- ToothSeg checkpoints: https://zenodo.org/records/14893540
- ToothSeg paper summary / DOI: https://xrayinterpreter.com/paper/doi/10.1109/JBHI.2025.3650444
- ToothFairy2 benchmark: https://github.com/AImageLab-zip/ToothFairy2-Benchmark
- DentalSegmentator: https://github.com/gaudot/SlicerDentalSegmentator
- GEPAR3D project: https://tomek1911.github.io/GEPAR3D/
- GEPAR3D arXiv: https://arxiv.org/abs/2508.00155
- OraSeg / OralSeg article: https://pmc.ncbi.nlm.nih.gov/articles/PMC12464119/
- OralSeg Hugging Face model: https://huggingface.co/aiadir/OralSeg
- TIPs repository: https://github.com/TaoZhong11/TIPs
- TIPs paper: https://www.sciencedirect.com/science/article/pii/S0933365725001824
- TAPSeg PubMed: https://pubmed.ncbi.nlm.nih.gov/41865812/
- STS Challenge: https://sts-challenge.github.io/
- STS 2024 arXiv: https://arxiv.org/abs/2511.22911
- STS 2024 Codabench: https://www.codabench.org/competitions/3025/
- PXseg article: https://link.springer.com/article/10.1186/s12903-025-06356-w
- ToothNet paper: https://openaccess.thecvf.com/content_CVPR_2019/papers/Cui_ToothNet_Automatic_Tooth_Instance_Segmentation_and_Identification_From_Cone_Beam_CVPR_2019_paper.pdf
