# CBCT Model Inventory And Research

Last updated: 2026-06-02

This note records the models currently present in CBCTer, the observed behavior
on `/Users/ahmadjalil/Downloads/CBCT-Aug2025-dcm`, and external alternatives
worth evaluating for individual tooth extraction.

See also `docs/cbct-test-resource-candidates.md` for the expanded swarm
research list of additional datasets, benchmarks, and model candidates.

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
| `external/OralSeg-weights` | 409 MB | Downloaded Hugging Face OralSeg checkpoint, ignored by git |
| `external/oralseg` | 280 KB | OralSeg code clone, no browser build |
| `external/TIPs` | 5.0 MB | TIPs code clone |
| `external/TIPs-weights` | 2.5 GB | TIPs downloaded Google Drive model package plus extracted nnU-Net results |
| `external/GEPAR3D` | 36 MB | GEPAR3D code clone, checkpoints/assets not included |

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
| ToothSeg `checkpoint_best` comparison export | 28 separated FDI teeth, 28 accepted, shape audit 28/28 OK, `3,780,158` positive voxels | Same FDI coverage as final; does not recover third molars |
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

Additional ToothSeg NIfTI diagnostics were written to
`outputs/toothseg-cbct-aug2025/nifti-label-summary.json`. They confirm:

- `semseg_branch` and `semseg_branch_best` both have 28 semantic labels.
- Missing semantic labels are `8`, `16`, `24`, and `32`, which map to FDI
  `18`, `28`, `38`, and `48`.
- Majority assignment collapses three non-third-molar classes in the final
  instance output, and the recovery script restores those to 28 labels.
- Neither `checkpoint_best` nor `checkpoint_final` predicts any voxels for the
  four third molars on this scan.

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

The controlled `checkpoint_best` vs `checkpoint_final` comparison produced the
same FDI set for this scan: both exports contain 28 teeth and both miss
`18`, `28`, `38`, and `48`. The `best` export has 8,707 more positive voxels
overall, but the largest differences are a redistribution between adjacent
premolars (`14`/`15`, `24`/`25`) rather than new tooth coverage. The comparison
output is `outputs/toothseg-cbct-aug2025/checkpoint-comparison.json`, and the
browser export is `public/sample-segmentation-toothseg-best`.

Pruning recommendation: keep one checkpoint pair for production unless further
cases show a clinically meaningful difference. On this scan, `checkpoint_best`
does not justify keeping both `best` and `final` pairs.

## Interactive Recovery Status

The browser now exposes missing permanent FDI numbers on `/teeth`.

For missing FDI slots, the UI supports:

- `Manual`: stores the recovery target and opens the viewer.
- `Absent`: marks that slot as intentionally absent in local UI state.

In the viewer, a manual recovery target automatically creates and selects an
empty mask/segment group named `Manual FDI <number>`, switches to brush mode,
and shows a banner with the intended tooth name.

Current implementation status:

1. Manual recovery targets create/select an empty viewer mask for the missing
   FDI number.
2. The viewer can export the active painted mask as that FDI number.
3. The export builds a cropped label item, preview image, and smoothed/decimated
   binary STL, then merges it into the in-browser tooth library for the session.

Remaining implementation work:

1. Persist manual exports back to static assets or a project-local storage layer
   instead of the current in-memory session library.
2. Add DentalSegmentator upper/lower tooth masks as hard constraints while
   painting or exporting manual third-molar masks.
3. Add review metadata for intentional absence vs manual recovery so the browser
   can distinguish "not present" from "not yet recovered."

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
- Repo cloned under `external/GEPAR3D`.
- Feasibility status: not smoke-tested yet because the clone does not include
  the required coarse and GEPAR3D checkpoint weights; its checkpoint README
  points to external assets.
- Output appears research-compatible with 32 tooth classes, but production
  readiness is lower than ToothSeg/TIPs because the inference path expects
  project-specific assets and setup.
- Dataset status: Zenodo record `15739014` is reachable, but the files are
  restricted. Unauthenticated API access reports `access_right: restricted` and
  exposes zero files, so `GEPAR3D_dataset.zip` and `32class_labels.zip` cannot
  be downloaded or tested until access is granted.
- Prepared downloader: `scripts/download_gepar3d_restricted_assets.py`. After
  access approval, set `ZENODO_TOKEN` and run it to download
  `GEPAR3D_dataset.zip` and `32class_labels.zip` into
  `external/GEPAR3D-dataset`.
- Prepared inspector: `scripts/inspect_gepar3d_dataset_assets.py`. Once the
  archives are present, it summarizes archive contents, NIfTI count, sample
  shapes, spacing, and label counts.
- Raw Cui CBCT scans remain a separate access request to the original data
  provider; the Zenodo `32class_labels.zip` contains labels only, not those
  source CBCT volumes.

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
- Code cloned under `external/oralseg`; Hugging Face checkpoint downloaded to
  `external/OralSeg-weights/model_workstation39.pt` (~409 MB on disk).
- Feasibility status: not smoke-tested yet because the repo exposes training and
  validation utilities but not a clean one-command CBCT inference/export wrapper.
  The next step is an adapter around the validation sliding-window path.
- Runtime blocker on this Mac: the checkpoint is a full hybrid OralSeg model
  with Swin and Mamba branches. `mamba-ssm==2.2.0` fails to install locally
  because the package expects an NVCC/CUDA build path; it is not currently
  runnable in the local macOS/Python 3.13/MPS environment.

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
- Repo cloned under `external/TIPs`.
- Google Drive model package downloaded and extracted under
  `external/TIPs-weights`.
- Extracted checkpoints include nnU-Net datasets `803`, `810`, and `812`, matching
  the dataset IDs called by `TIPs.py`; individual checkpoints are about
  322-325 MB each.
- Runtime blocker on this Mac: TIPs uses `nnUNetTrainerUMambaBot`, and importing
  that trainer fails without `mamba_ssm`. The repo requirements specify Ubuntu
  20.04, CUDA 11.8, PyTorch 2.0.1, and Mamba, so the next real smoke test should
  run in a Linux CUDA environment.

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
   - Status: completed on `CBCT-Aug2025-dcm`.
   - Result: `best` and `final` both produce the same 28 FDI teeth and both miss
     third molars `18`, `28`, `38`, and `48`.
   - Recommendation: do not spend more time on checkpoint pruning for the
     third-molar issue; validate one or two more scans before deleting either
     pair, then keep only the selected pair.

2. **OralSeg third-molar smoke test**
   - Downloaded the Hugging Face OralSeg model for experimental use under
     `external/OralSeg-weights`.
   - Compare specifically on FDI `18`, `28`, `38`, and `48`.
   - Current blocker: local `mamba-ssm` install fails without CUDA/NVCC.
   - Next implementation step: run in Linux CUDA, then build an inference adapter
     from the repo's validation code.

3. **TIPs sidecar smoke test**
   - TIPs is cloned and its Google Drive model package is downloaded/extracted.
   - Test whether it catches third molars or produces better tooth+pulp masks.
   - Current blocker: local `mamba_ssm` import fails; requires Linux CUDA/Mamba
     runtime.

4. **ToothSeg baselines smoke test**
   - Download `Baselines.zip` only if disk/network budget allows.
   - Test whether any baseline catches the four third molars on this scan.

5. **GEPAR3D feasibility spike**
   - Repo is cloned and inspected.
   - Run against the same DICOM-derived NIfTI if weights are available.
   - Blocker: external checkpoint/assets are required; they are not included in
     the clone.
   - Dataset download attempt completed: Zenodo metadata is visible, but files
     are restricted and not visible without an approved account/token.
   - After access is granted, run:
     `ZENODO_TOKEN=... scripts/download_gepar3d_restricted_assets.py`, then
     `scripts/inspect_gepar3d_dataset_assets.py external/GEPAR3D-dataset/*.zip`.

6. **Interactive third-molar recovery**
   - Exporting a painted manual mask as FDI `18`, `28`, `38`, or `48` is
     implemented for the in-memory browser tooth library.
   - Use DentalSegmentator upper/lower tooth masks as a constraint.
   - Remaining: persist exported manual assets and add hard anatomy constraints.
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
