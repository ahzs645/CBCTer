# CBCT Test Resource Candidates

Last updated: 2026-06-05

This note tracks additional public or requestable resources we can use to test
CBCTer against `/Users/ahmadjalil/Downloads/CBCT-Aug2025-dcm` and future local
CBCT cases.

## Staged And Smoke-Tested

### RAIL / RailNet

URLs:

- https://huggingface.co/Tournesol-Saturday/railNet-tooth-segmentation-in-CBCT-image
- https://github.com/Tournesol-Saturday/RAIL
- https://huggingface.co/papers/2505.03538

Status:

- Downloaded under `external/RAIL-HF`.
- Weights downloaded:
  - `roi_best_model.pth`
  - `rail_0_iter_7995_best.pth`
  - `rail_1_iter_7995_best.pth`
  - `rail_2_iter_7995_best.pth`
  - `rail_3_iter_7995_best.pth`
- Sample input downloaded: `external/RAIL-HF/example_input_file/CBCT_01.h5`.
- CPU one-patch smoke test passed with
  `scripts/smoke_test_railnet.py`.
- Smoke-test output: `outputs/railnet-smoke.json`.
- Local CBCT ROI test passed with `scripts/run_railnet_roi_nifti.py`.
  - Input: `outputs/toothseg-cbct-aug2025/input/imagesTs/cbct_aug2025_0000.nii.gz`
  - Output mask: `outputs/railnet-cbct-aug2025/railnet_roi_mask.nii.gz`
  - Summary: `outputs/railnet-cbct-aug2025/railnet_roi_summary.json`
  - Result: non-empty ROI mask with 1,738,840 positive voxels on the resized
    400 x 400 x 280 test grid.

Practical notes:

- License: Apache-2.0 in the Hugging Face model card.
- Output: binary tooth mask, not individual FDI tooth instances.
- Runtime: upstream demo hardcodes CUDA, but the model is VNet/ResVNet and can
  be adapted to CPU/MPS more realistically than Mamba-based models.
- Input: upstream demo expects `.h5` containing `image` and `label`.
- Next useful CBCTer test: adapt full-volume binary tooth-mask ensemble
  inference. Compare with DentalSegmentator upper/lower tooth masks and ToothSeg
  union masks.

## Best New Dataset Targets

### ToothFairy3

URLs:

- https://toothfairy3.grand-challenge.org/
- https://toothfairy3.grand-challenge.org/dataset/

Why it matters:

- Raw CBCT volumes are included in NIfTI format.
- Training set is public after sign-up.
- Dataset page states 0.3 mm isotropic spacing and HU storage.
- Challenge overview describes 77 classes, including pulp cavities, incisive
  nerves, lingual foramen, and maxillofacial structures.

Access/license:

- Sign-up required.
- Dataset page states CC-BY-NC-SA for the training set.
- Test set remains private.
- Current test status: not downloaded. The public dataset page confirms sign-up
  is required, so direct unauthenticated testing from this workspace is blocked.

How to test:

- Download public training set.
- Run ToothSeg on raw CBCT NIfTI cases.
- Map ToothSeg FDI outputs to ToothFairy3 tooth IDs and score teeth.
- Collapse labels to DentalSegmentator classes for coarse-anatomy comparison.

### ToothFairy2

URLs:

- https://toothfairy2.grand-challenge.org/
- https://ditto.ing.unimore.it/toothfairy2/
- https://github.com/AImageLab-zip/ToothFairy2-Benchmark

Why it matters:

- Public training set reportedly includes hundreds of raw CBCT volumes plus
  segmentation maps.
- ToothFairy2 is a strong multi-structure CBCT benchmark with individual tooth
  labels and maxillofacial structures.
- Hidden-test evaluation remains useful if we later containerize a sidecar.

Access/license:

- Registration required through the challenge/download portal.
- Terms need confirmation before redistribution or commercial use.
- Current test status: not downloaded. Public information points to the DITTO /
  Grand Challenge portal rather than direct anonymous archives.

How to test:

- Download public set.
- Use the benchmark repo and `dataset.json` to establish label mappings.
- Run ToothSeg and score FDI teeth directly where mappings align.
- Collapse labelmaps to evaluate DentalSegmentator-style coarse anatomy.

### Pulpy3D

URLs:

- https://ditto.ing.unimore.it/pulpy3d/
- https://papers.miccai.org/miccai-2024/088-Paper1419.html

Why it matters:

- Raw mandibular CBCT volumes and labels are available.
- Focuses on pulp/root canal and inferior alveolar nerve, useful for future
  endodontic workflows.

Access/license:

- Public portal; license still needs confirmation from the downloaded package.
- Current test status: not downloaded. DITTO portal access needs a browser/login
  flow or stable direct file links before local testing.

How to test:

- Use primarily for raw CBCT preprocessing and pulp/root-canal research.
- ToothSeg/DentalSegmentator will not directly predict pulp, so it is not the
  best individual tooth benchmark.

### CTooth / CTooth+

URLs:

- https://www.kaggle.com/datasets/weiweicui/ctooth-dataset
- https://arxiv.org/abs/2208.01643
- https://arxiv.org/abs/2206.08778

Why it matters:

- Small but important CBCT tooth segmentation benchmark.
- Useful external validation if access is granted.

Access/license:

- Kaggle page indicates CC BY-NC 4.0, but download requires contacting authors
  and signing/agreeing to terms.
- Current test status: not downloaded; request-based access.

How to test:

- Request dataset.
- Run ToothSeg on raw CBCT and score instance/semantic tooth labels after
  confirming the package label scheme.

### STS-Tooth / STS-3D-Tooth

URLs:

- https://zenodo.org/records/10597292
- https://www.nature.com/articles/s41597-024-04306-9

Why it matters:

- Public Zenodo package for semi-supervised tooth segmentation research.
- Useful for binary/semantic tooth-vs-background tests.

Access/license:

- Public Zenodo downloads, but package is large.
- License must be checked before redistribution.
- Current test status: not downloaded because the Zenodo API reports 15 multipart
  files totaling 31.8 GB, while this workspace currently has about 22 GB free.

How to test:

- Download selectively if possible; full package is large.
- Collapse ToothSeg and DentalSegmentator outputs to tooth-vs-background.
- Not ideal for FDI numbering unless downloaded labels prove instance-coded.

## New Model / Pipeline Candidates

### T-Mamba

URLs:

- https://github.com/isjinghao/T-Mamba
- https://huggingface.co/datasets/Bryceee/TED
- https://huggingface.co/papers/2404.01065

Why it matters:

- 3D tooth segmentation method with code, pretrained assets, and TED dataset
  references.

Blocker:

- Mamba/CUDA stack. This is not a good local macOS/MPS target.

Test path:

- Run on Linux CUDA using the repo's `infer_3d.sh`, then compare binary/semantic
  tooth masks against ToothSeg and DentalSegmentator unions.

### U-Mamba2

URLs:

- https://github.com/zhiqin1998/UMamba2
- https://arxiv.org/abs/2509.12069
- https://openreview.net/forum?id=XrGUrxXfXj
- https://toothfairy3.grand-challenge.org/

Why it matters:

- First-place KCL TAIR Lab solution for ODIN challenges including ToothFairy3
  and STSR 2025 according to the repository README.
- ToothFairy3-aware nnU-Net fork with dataset conversion scripts for
  ToothFairy2, ToothFairy3, and STSR25.
- Paper describes multi-anatomy CBCT segmentation to 77 ToothFairy3 classes,
  including tooth and pulp-related classes.

Status:

- Code cloned under `external/UMamba2`.
- GitHub releases are empty.
- No trained ToothFairy3 inference bundle/checkpoint was present in the clone.
- Google Drive pretrained folder from the README was reachable and downloaded
  under `external/UMamba2-weights`.
- Downloaded pretrained files:
  - `ssl_umamba2_3d_depth7_128x256x256.pth` (~542 MB)
  - `ssl_umamba2_3d_depth7_160x256x256_stsr25only.pth` (~542 MB)
  - `ssl_umamba2_3d_depth7_160x288x288.pth` (~541 MB)

Blocker:

- These are SSL/pretrained weights, not final ToothFairy3 trained inference
  bundles, so they do not give us an immediate `nnUNetv2_predict` path.
- Runtime requires `mamba-ssm`; local macOS/Python 3.13 previously failed to
  install Mamba packages because they expect CUDA/NVCC-style builds.
- Contributions are CC BY-NC per README, even though the underlying nnU-Net fork
  is Apache-2.0.

Test path:

- Use Linux CUDA for a real run.
- Ask whether final ToothFairy3/STSR trained model folders are available, or
  train/fine-tune from the downloaded SSL weights after ToothFairy3 data access.
- If final model folders are obtained, run through the repo's nnU-Net predictor
  and compare 77-class output against ToothSeg/DentalSegmentator mappings.

### ToothFairy3 Challenge Winners / Public Solution Code

URLs:

- https://toothfairy3.grand-challenge.org/challenge-winners/
- https://github.com/ff741333/toothfairy3_blcakmyth
- https://github.com/tomek1911/TF3
- https://github.com/duola-wa/Toothfairy3
- https://github.com/duola-wa/MICCAI-2025-ToothFairy3-Task-1
- https://github.com/duola-wa/MICCAI-2025-ToothFairy3-Task-2
- https://openreview.net/forum?id=S8b5y0YpB3
- https://openreview.net/forum?id=Lqexc82h2i

Why it matters:

- The ToothFairy3 winner page gives measured challenge performance for these
  teams. Task 1 results include TAIR-Lab rank 1, Black_Myth rank 3, and
  DLaBella29 rank 5. Task 2 results include TAIR_Lab rank 1, BlackMyth rank 2,
  and DLaBella rank 4.
- These repos are closer to runnable engineering than papers alone because they
  include Docker, inference scripts, nnU-Net trainers, or challenge submission
  wrappers.
- ToothFairy3 labels are broader than our current target: 77-class
  maxillofacial anatomy, including teeth and pulp-related labels.

Status:

- `ff741333/toothfairy3_blcakmyth` cloned under
  `external/toothfairy3_blcakmyth`.
  - Repository size: about 20 MB.
  - No `.pth`, `.pt`, `.ckpt`, `.safetensors`, archive, or GitHub release
    checkpoint found.
  - Task 1 uses nnU-Net-style code; Task 2 includes VISTA/interactive code.
  - Includes a NVIDIA OneWay Noncommercial License file in the Task 2 training
    tree, so licensing needs careful review before any product use.
- `tomek1911/TF3` cloned under `external/TF3`.
  - Repository size: about 1.1 MB.
  - No checkpoint files or GitHub releases found.
  - README instructs users to train the model and save trained models to
    `algorithm_docker/checkpoints`.
  - Inference code expects paths such as
    `checkpoints/model_epoch_380.pth` or a CLI-provided `.pth` checkpoint.
  - Method is morphology/deep-watershed based and may be useful for cleaner
    tooth/pulp boundaries if weights are obtained.
- `duola-wa/Toothfairy3` cloned under `external/Toothfairy3-duola`.
  - The top-level repo only links to separate Task 1 and Task 2 repos.
- `duola-wa/MICCAI-2025-ToothFairy3-Task-1` cloned under
  `external/MICCAI-2025-ToothFairy3-Task-1`.
  - No checkpoint files or GitHub releases found.
  - `weights/README.md` says to move `checkpoint_best.pth` there.
  - Inference script expects `/opt/app/weights/checkpoint_best.pth`.
- `duola-wa/MICCAI-2025-ToothFairy3-Task-2` cloned under
  `external/MICCAI-2025-ToothFairy3-Task-2`.
  - No checkpoint files or GitHub releases found.
  - nnU-Net path expects `checkpoint_best.pth`.
  - nnInteractive path points to the public
    `nnInteractive/nnInteractive_v1.0` Hugging Face model, but this is for
    interactive inferior alveolar canal segmentation, not individual teeth.

Blocker:

- These are not immediately testable on CBCT-Aug2025 because final trained
  challenge checkpoints are not included.
- Most of the useful ToothFairy3 public repos are code-only reproducibility
  drops. The high-value next move is asking teams for trained challenge
  checkpoint folders.

Test path:

- Request final Task 1 checkpoints first, because they are closest to our
  browser-client goal.
- For duola Task 1, ask specifically for `checkpoint_best.pth` compatible with
  `MICCAI-2025-ToothFairy3-Task-1/test_3D.py`.
- For Black Myth, ask for the Docker model assets or trained nnU-Net/VISTA
  checkpoint archive used for the Grand Challenge submission.
- For TF3, ask for the trained deep-watershed `.pth` checkpoint used in the
  OpenReview result.
- Once obtained, run each model on our existing NIfTI input:
  `outputs/toothseg-cbct-aug2025/input/imagesTs/cbct_aug2025_0000.nii.gz`.

### STS 2024 Docker Submissions

URLs:

- https://github.com/ricoleehduu/STS-Challenge-2024
- https://sts-challenge.github.io/miccai2024/cbct_winners.html
- https://www.codabench.org/competitions/3025/

Why it matters:

- Strong candidate for individual tooth instance segmentation because the
  challenge output format expects tooth IDs as mask values.

Blocker:

- Docker archives appear to be hosted through Baidu links, which may be awkward
  to access.

Test path:

- If Docker archive is obtained, format one local CBCT as challenge input and
  run the container. Compare predicted mask values to ToothSeg FDI outputs.

### UNetTransplant

URLs:

- https://github.com/LucaLumetti/UNetTransplant
- https://huggingface.co/Lumett/UNetTransplant

Why it matters:

- Apache-2.0 repo and Hugging Face weights are referenced.
- More likely to be CPU/MPS-adaptable than Mamba models.

Status:

- Code cloned under `external/UNetTransplant`.
- ToothFairy weights downloaded under `external/UNetTransplant-weights`.
- Downloaded weights:
  - `Pretrain_Cui.pth`
  - `TaskVector_Teeth_ToothFairy2.pth`
  - `TaskVector_Mandible_ToothFairy2.pth`
  - `TaskVector_Canals_ToothFairy2.pth`
- CPU smoke test passed with `scripts/smoke_test_unettransplant.py`.
- Smoke-test output: `outputs/unettransplant-smoke.json`.
- Output is binary/coarse ToothFairy task head, not individual FDI instances.

Blocker:

- No direct single-volume inference wrapper found yet.
- Task vector heads are semantic/binary tasks rather than individual FDI
  instances.

Test path:

- Write a NIfTI sliding-window inference wrapper for the teeth task vector.
- Compare binary teeth mask against DentalSegmentator tooth masks and ToothSeg
  union masks.

### AMASSS-CBCT

URLs:

- https://github.com/Maxlo24/AMASSS_CBCT
- https://github.com/DCBIA-OrthoLab/SlicerAutomatedDentalTools

Why it matters:

- Useful as a coarse anatomy/root-canal control, not individual teeth.

Blocker:

- Does not output FDI/individual tooth instances.

Test path:

- Use only for coarse anatomical sanity checks if we need another jaw/skin/UAW
  baseline.

### DLaBella29 ToothFairy25

URLs:

- https://github.com/dlabella29/ToothFairy25
- https://arxiv.org/abs/2508.12962

Why it matters:

- ToothFairy3 MICCAI 2025 challenge solution.
- Paper describes a MONAI Auto3DSeg / 3D SegResNet approach trained on 63
  ToothFairy3 CBCT scans with 5-fold cross-validation.
- Preprocessing is sensible for CBCTer testing: CT modality, 0.6 mm isotropic
  resampling, intensity clipping from -1000 to 3880.
- Inference script performs 5-fold prediction fusion with MultiLabel-STAPLE,
  then cleanup/relabeling.

Status:

- Code cloned under `external/ToothFairy25`.
- Repository size is about 11 MB and contains scripts/figures only.
- No README, license, requirements file, MONAI `segmenter.py`, trained
  `segresnet_*` bundle folders, releases, or checkpoints were present in the
  clone.
- GitHub releases API returned an empty release list.

Blocker:

- Not directly testable locally because pretrained MONAI bundle folders are
  missing. The inference script expects author-local paths such as
  `AutoToothWorkDirChallenge/segresnet_0...segresnet_4/configs/hyper_parameters.yaml`.
- Also depends on ToothFairy3 data access for reproducing training.

Test path:

- Ask the author whether the 5 trained `segresnet_*` MONAI bundles/checkpoints
  from the paper can be released.
- If bundle folders are obtained, adapt `inference_Tooth_iSTAPLE.py` to accept
  CBCTer NIfTI/MHA input paths and run its 5-fold STAPLE fusion.
- Expected output is multi-class ToothFairy3-style labels, not necessarily direct
  FDI-only tooth instances.

### TAPSeg

URLs:

- https://pubmed.ncbi.nlm.nih.gov/41865812/
- https://www.sciencedirect.com/science/article/pii/S0300571226003143
- https://github.com/simzhangbest/TAPSeg
- https://www.bilibili.com/video/BV1SCPyziEcG/

Why it matters:

- 2026 Journal of Dentistry paper describes an "open-source" one-click 3D Slicer
  tool for instance-level tooth and pulp segmentation in CBCT.
- Reported tooth segmentation DSC range: 91.5% to 94.2% across 198 CBCT test
  scans.
- Reported pulp segmentation DSC range: 91.0% to 92.2% across 148 CBCT test
  scans.
- Architecture is practical for our goals: a three-stage V-Net tooth pipeline
  for arch localization, single-tooth centroid detection, and single-tooth fine
  segmentation, plus nnU-Net for pulp.
- External evaluations included 100 ToothFairy3 cases and 50 Cui cases, so this
  is directly relevant to wisdom teeth, pulp, and root morphology.

Status:

- Paper/source pages and the intended GitHub repository found.
- Code cloned under `external/TAPSeg`.
- Local clone contents:
  - `README.md`
  - `202603042259.mp4` demo video, about 34 MB
- Repository size: about 68 MB.
- No source code, Python files, Slicer extension files, model archives, releases,
  or checkpoint files are currently present.
- README says source code and pretrained model weights will be partially released
  upon paper acceptance, including core architecture, pretrained tooth/pulp
  weights, inference scripts, and documentation.
- README says expected input is CBCT scans in NIfTI `.nii.gz` format.
- Author contact emails are listed on PubMed/ScienceDirect pages:
  `dengshuli@zju.edu.cn` and `yuanwang@zju.edu.cn`.

Blocker:

- Not testable yet. The repository exists and has a demo/README, but it does not
  currently include the Slicer extension code or pretrained weights.
- Paper text says the source code will be released at the repository after
  formal acceptance and the extension will be submitted to the 3D Slicer
  Extension Manager after official publication. The repository has not caught up
  to that promise yet.

Test path:

- Ask authors for the TAPSeg 3D Slicer extension repository, model weights, and
  standalone inference instructions.
- Watch `simzhangbest/TAPSeg` for commits/releases.
- If provided, test TAPSeg first on CBCT-Aug2025 because the advertised input
  format is already NIfTI `.nii.gz`. Compare against ToothSeg's missing
  third-molar failure mode and any ToothFairy3 challenge models we obtain.

## Current Priority Order

1. Adapt RAIL full-volume binary tooth-mask inference and compare against
   DentalSegmentator/ToothSeg union masks.
2. Adapt UNetTransplant ToothFairy teeth task-vector inference as a second
   non-Mamba binary tooth-mask candidate.
3. Request/download ToothFairy3 and ToothFairy2 public training sets.
4. Ask DLaBella29 for ToothFairy25 trained MONAI SegResNet bundle folders.
5. Ask U-Mamba2 authors whether final ToothFairy3/STSR trained model folders are
   available; SSL weights are already downloaded.
6. Ask ToothFairy3 public-solution teams for trained checkpoints:
   Black Myth, TF3/deep-watershed, and duola Task 1.
7. Ask TAPSeg authors for the open-source Slicer plugin/code and trained
   checkpoints; it is highly aligned if the assets are available.
8. Try STS 2024 Docker submissions if Baidu-hosted assets can be obtained.
9. Use Pulpy3D for pulp/root-canal research, not primary FDI tooth extraction.
10. Request CTooth/CTooth+ only if we need a smaller external benchmark.
