# SlicerDentalSegmentator (nnU-Net)

_Area key: `DentalSegmentator`_

## Purpose
SlicerDentalSegmentator is a 3D Slicer extension that performs fully-automatic multiclass segmentation of dental CT and CBCT volumes using the DentalSegmentator nnU-Net v2 model (trained on 470 dento-maxillo-facial CT/CBCT scans, evaluated on 256 held-out scans from 7 institutions; Dot et al., J. Dentistry 2024). IMPORTANT for porting: this repository is ONLY the Slicer GUI + glue layer. It contains NO model weights, NO inference code, and NO preprocessing/resampling/normalization code. All actual nnU-Net execution, spacing/normalization, and model loading are delegated to an external dependency module called SlicerNNUNetLib (the separate SlicerNNUNet extension), and the trained weights are downloaded at runtime from GitHub releases. To port the model itself you must obtain the weights/plans separately (GitHub release Dataset111_453CT_v100.zip or Zenodo DOI 10.5281/zenodo.10829674) and reimplement the nnU-Net v2 preprocessing+inference pipeline.

**Tech stack:** Python 3 (3D Slicer embedded interpreter), 3D Slicer >= 5.8.0 (qMRML widgets, Segment Editor, vtkSlicerSegmentationsModuleLogic, SampleData), PyQt/PythonQt (qt, ctk), nnU-Net v2 (nnunetv2) — external, the actual segmentation engine, PyTorch >= 2.0 (CUDA / CPU / MPS) — via the SlicerPyTorch extension, SlicerNNUNetLib / SlicerNNUNet extension (external glue that runs nnUNetv2 prediction), SlicerOpenAnatomy extension (optional, for glTF export), PyGithub + requests (weights download), VTK + ITK/GDCM (volume IO and surface generation, via Slicer), numpy

**License:** Apache License 2.0 (Copyright (c) 2024, Gauthier DOT). Model weights are distributed separately via GitHub releases and Zenodo (DOI 10.5281/zenodo.10829674) — verify the model/dataset license independently before redistribution; the Apache-2.0 here covers the Slicer extension source, not necessarily the trained weights.

**I/O formats:** Input: any scalar volume loaded into Slicer (NIfTI/NRRD; DICOM CT/CBCT via DCM import). Passed to nnU-Net as a single-channel image., Model input expectation (nnU-Net): single-modality CT/CBCT volume; nnU-Net internally resamples to the trained target spacing and applies CT-style intensity normalization defined in plans.json (clipping to foreground percentiles + z-score). Exact target spacing/normalization is NOT in this repo — it lives in the model's plans.json inside the downloaded weights zip., Output: multilabel NIfTI labelmap loaded back as a Slicer segmentation., Export formats: STL, OBJ, NIFTI (.nii.gz binary labelmaps, one per segment), glTF.

## Modules

### DentalSegmentator Slicer module (entry/registration)
ScriptedLoadableModule registration for Slicer. Declares title, category (Segmentation), contributors, help text. The Widget.setup() just instantiates SegmentationWidget and wires its logic. No algorithm here.

- **Algorithm:** Slicer ScriptedLoadableModule boilerplate; delegates everything to SegmentationWidget
- **Entry points:** `DentalSegmentator/DentalSegmentator.py`

### SegmentationWidget (UI + orchestration + post-processing)
The main 700-line widget. Builds the Qt UI (input volume selector, device combo cuda/cpu/mps, Segment Editor, export panel, surface-smoothing slider). On Apply it: checks the external NNUNet module is installed, installs python deps, downloads weights if needed, then constructs SlicerNNUNetLib.Parameter(folds='0', modelPath=Resources/ML, device=...) and calls logic.startSegmentation(volumeNode). When inference finishes it loads the result NIfTI labelmap as a Slicer segmentation, renames/colors the 5 segments, and runs post-processing. Inference itself is NOT here — it is in the external SlicerNNUNetLib.SegmentationLogic.

- **Algorithm:** nnU-Net v2 (3D full-resolution multiclass) invoked through external SlicerNNUNetLib; this file only orchestrates + does morphological post-processing
- **Entry points:** `DentalSegmentator/DentalSegmentatorLib/SegmentationWidget.py`

### Segmentation post-processing
After loading the predicted labelmap, removes small connected components (islands) on the 4 bony/teeth classes (Segment_1..4) using Slicer Segment Editor 'Islands' effect with REMOVE_SMALL_ISLANDS. Minimum island size is computed from physical voxel size: minimumIslandSize = ceil(60 mm^3 / voxelVolume_mm3), where voxelVolume = product of volume spacing. The mandibular canal (Segment_5) is deliberately left untouched. A _keepLargestIsland helper (KEEP_LARGEST_ISLAND) also exists but is not called by default.

- **Algorithm:** Connected-component island filtering (classical morphology) with spacing-aware minimum size threshold of 60 mm^3
- **Entry points:** `DentalSegmentator/DentalSegmentatorLib/SegmentationWidget.py`

### Mesh export
Exports the segmentation to STL, OBJ, NIFTI binary labelmap, and glTF. STL/OBJ/NIFTI use Slicer's vtkSlicerSegmentationsModuleLogic exporters. glTF export delegates to the SlicerOpenAnatomy extension (auto-installed if missing) with a user-set decimation/reduction factor. Surface smoothing is controlled via the Segment Editor closed-surface conversion smoothing parameter.

- **Algorithm:** VTK marching-cubes closed-surface generation + decimation (via Slicer/SlicerOpenAnatomy), not custom
- **Entry points:** `DentalSegmentator/DentalSegmentatorLib/SegmentationWidget.py`

### PythonDependencyChecker (weights download + dep check)
Checks that torch and nnunetv2 are importable. Locates weights by recursively searching Resources/ML for a dataset.json. If missing/outdated, downloads the latest GitHub release asset (a zip) from repo gaudot/SlicerDentalSegmentator via PyGithub, streams it to Resources/ML, unzips it, and writes download_info.json recording the source URL for version comparison. This is the only place that defines the model file layout: an unzipped nnU-Net results folder containing dataset.json (and, by nnU-Net convention inside the zip, plans.json and fold checkpoint .pth files).

- **Algorithm:** Runtime asset download + zip extraction; no ML algorithm
- **Entry points:** `DentalSegmentator/DentalSegmentatorLib/PythonDependencyChecker.py`

### Utils / IconPath / Signal (helpers)
Small Slicer/Qt helpers: createButton, collapsible layout, 3D view background/box/label config; icon path resolver; a custom Qt-like Signal class used to decouple logic callbacks from the widget (avoids PythonQt crash). Generic, not algorithmic.

- **Algorithm:** UI/event-plumbing utilities
- **Entry points:** `DentalSegmentator/DentalSegmentatorLib/Utils.py`, `DentalSegmentator/DentalSegmentatorLib/IconPath.py`, `DentalSegmentator/DentalSegmentatorLib/Signal.py`

## ML models

| Model | Framework | Format | Present? | Notes |
|---|---|---|---|---|
| DentalSegmentator (Dataset111_453CT) | nnU-Net v2 / PyTorch | nnU-Net results folder (dataset.json + plans.json + fold_0/checkpoint .pth), distributed as a zip (Dataset111_453CT_v100.zip) | no | NOT present in this repo. Downloaded at runtime from GitHub releases (https://github.com/gaudot/SlicerDentalSegmentator/releases/.../Dataset111_453CT_v100.zip) into DentalSegmentator/Resources/ML, or available on Zenodo (DOI 10.5281/zenodo.10829674) for raw nnU-Net CLI use. Architecture: nnU-Net v2 self-configured 3D U-Net, almost certainly the 3d_fullres configuration (encoder-decoder CNN with deep supervision, instance norm, leaky ReLU, sliding-window patch inference with Gaussian weighting + test-time mirroring). Only fold 0 is used at inference (folds='0' in SegmentationWidget.py line 256). 6-class output. |

## Reusable utilities

- `DentalSegmentator/DentalSegmentatorLib/SegmentationWidget.py` — Spacing-aware small-island removal: minimumIslandSize = ceil(60 mm^3 / prod(spacing)). A directly reusable post-processing recipe (connected-components filter sized by physical volume) that any web port should replicate to clean nnU-Net output. Also the canonical class list, segment colors (#E3DD90/#D4A1E6/#DC9565/#EBDFB4/#D8654F), and per-class 3D opacities (0.45,0.45,1,1,1).
- `DentalSegmentator/DentalSegmentatorLib/PythonDependencyChecker.py` — Self-contained model-weights download/version manager: getLatestReleaseUrl via PyGithub, streamed download, zip extract to Resources/ML, dataset.json discovery via rglob, download_info.json version tracking. Useful template for a server-side model fetch/cache step.
- `DentalSegmentator/DentalSegmentatorLib/Signal.py` — Tiny dependency-free Qt-like Signal/slot class (connect/disconnect/emit/blockSignals). Portable observer-pattern helper, framework-agnostic.
- `DentalSegmentator/DentalSegmentatorLib/Utils.py` — Generic Slicer/Qt UI helpers (button, collapsible layout, 3D view config). Slicer-specific, low port value.

## Web-portability assessment

**Overall:** 🟡 web w/ effort

| Item | Tier | Effort | Value | Web approach |
|---|---|---|---|---|
| **DentalSegmentator nnU-Net v2 multiclass model (6-class CT/CBCT seg)** | 🟡 web w/ effort | XL | high | Obtain the .pth checkpoint + plans.json, rebuild the nnU-Net v2 3d_fullres network in PyTorch, export to ONNX (single conv-net forward, no nnU-Net runtime), and run it through onnxruntime-web in a worker. CBCTer's toothSeg.worker.ts is a near-drop-in template: swap the binary sigmoid for a multi-class argmax over output channels and reuse the existing sliding-window + reflect-pad loop. The hard part is faithfully reproducing nnU-Net preprocessing from plans.json (resample to trained target spacing, CT-style foreground-percentile clip + z-score normalization) — without that the model is wrong. Patch size from plans.json drives the window size. Consider WebGPU EP for the larger 3d_fullres patches. |
| **nnU-Net v2 preprocessing: resample-to-target-spacing + CT normalization** | 🟢 direct web | M | high | Reimplement in TypeScript as a worker step: a trilinear 3D resampler from source spacing (volume.meta.spacing) to plans.json target spacing producing a Float32 grid, followed by percentile clip + (value-mean)/std normalization with the constants read from plans.json. CBCTer already has the crop/Float32 plumbing (roi.ts extractCropFloat32) and panoramic spline sampling to borrow interpolation patterns from; no existing general volume resampler exists, so this is genuinely new but self-contained math. |
| **Spacing-aware small-island post-processing (60 mm^3 threshold)** | 🔵 reimplement in TS | S | high | Add a removeSmallComponents(mask, dims, spacing, minVolumeMm3) helper next to maskOperations.ts: run the existing labelComponents(), compute minVoxels = ceil(60 / (sx*sy*sz)), drop components below it. Apply per-class over the multiclass labelmap, skipping the canal class. ~20 lines on top of the existing connected-components code. |
| **Multilabel labelmap -> per-class STL/OBJ/glTF mesh export** | 🟢 direct web | M | medium | Reuse CBCTer's surface.worker.ts / maskMesh.ts marching-cubes+smooth+decimate pipeline, looping per class of the multiclass labelmap to emit one mesh each (the worker already takes a binary mask + spacing + quality). STL is already produced; add OBJ and glTF writers — glTF is easy from the existing triangle buffers via three.js GLTFExporter (already a dependency). Per-segment NIfTI export overlaps with the existing project export. |
| **Model weights download + version/cache manager** | 🟢 direct web | S | low | For a web app, host the exported ONNX (+ derived plans/normalization JSON) yourself in public/models/ (as the existing tooth-unet-96.onnx is) and lazy-fetch with Cache Storage / the existing PWA service worker (sw.ts) keyed by a version string. The Python download/zip/version logic is not portable as-is, but the pattern (fetch-by-version, cache, fall back) maps cleanly onto fetch + Cache API. No PyGithub. |
| **Signal observer helper** | 🔵 reimplement in TS | S | low | No port needed — React state/effects and the existing worker postMessage/onmessage event flow already provide this decoupling. If an event-emitter is ever wanted, it's a 15-line TS class, but there's no reason to introduce one. |

- **DentalSegmentator nnU-Net v2 multiclass model (6-class CT/CBCT seg)** — The actual segmentation engine: an nnU-Net v2 self-configured 3d_fullres U-Net (fold 0 only) outputting 5 anatomical classes (maxilla/mandible, upper teeth, lower teeth, canal, etc.) + background. Weights are NOT in the repo; download Dataset111_453CT_v100.zip from GitHub releases or Zenodo (DOI 10.5281/zenodo.10829674), which contains plans.json + dataset.json + fold_0 checkpoint. _(depends on: nnU-Net v2 preprocessing (resample-to-target-spacing + CT normalization from plans.json), Spacing-aware small-island post-processing (60 mm^3))_ Highest-value capability: gives CBCTer fully-automatic multiclass bone+teeth+canal segmentation, a clear gap (current model is single-class tooth-only over a manual ROI). Verify the model/weights license (Zenodo) before shipping weights in a web app — Apache-2.0 covers only the Slicer source, not the trained weights. If WASM/WebGPU memory proves infeasible for full 3d_fullres on large CBCT, fall back to a server-side ONNX/torch microservice; the rest of the port (pre/post) stays client-side.
- **nnU-Net v2 preprocessing: resample-to-target-spacing + CT normalization** — The spacing/normalization step nnU-Net applies before inference, defined in the model's plans.json: trilinear-resample the input volume to the trained target spacing, then clip intensities to foreground percentiles and z-score normalize (CT scheme). This code is NOT in the DentalSegmentator repo — it lives inside nnUNetv2/SlicerNNUNetLib. This is the load-bearing correctness piece for the model port AND a reusable utility CBCTer lacks (a general resample-to-isotropic/target-spacing op is useful for the 3D renderer and panoramic too). Must extract exact target spacing + normalization params from the downloaded plans.json; getting these wrong silently degrades segmentation. After inference, resample the label volume back to the original grid with nearest-neighbor.
- **Spacing-aware small-island post-processing (60 mm^3 threshold)** — DentalSegmentator's only real post-processing: on the 4 bony/teeth classes (not the canal), remove connected components smaller than minimumIslandSize = ceil(60 mm^3 / prod(spacing)) using REMOVE_SMALL_ISLANDS. The canal class (Segment_5) is deliberately left untouched. Cheap, high-leverage win that directly cleans nnU-Net output and is independently useful for any mask in CBCTer. CBCTer already has labelComponents + keepLargestMaskComponent; this just adds a physical-volume-sized threshold variant. Also port the canonical 5-class list, segment colors (#E3DD90/#D4A1E6/#DC9565/#EBDFB4/#D8654F) and per-class 3D opacities (0.45,0.45,1,1,1) into studyState so the result matches the reference look.
- **Multilabel labelmap -> per-class STL/OBJ/glTF mesh export** — DentalSegmentator exports the segmentation to STL, OBJ, binary NIfTI (one per segment), and glTF (via SlicerOpenAnatomy) with a user decimation factor and surface smoothing. Underlying mesh gen is VTK marching cubes + decimation. _(depends on: DentalSegmentator nnU-Net v2 multiclass model (6-class CT/CBCT seg))_ Mostly already covered by surface.worker.ts; net-new work is just multi-class iteration + OBJ/glTF serializers. glTF via three.js GLTFExporter is the natural web equivalent of the SlicerOpenAnatomy dependency. Lower value because STL export from masks already works; this is an enhancement, not a gap.
- **Model weights download + version/cache manager** — PythonDependencyChecker.py: fetches the latest GitHub release asset (weights zip) via PyGithub, streams + unzips it to Resources/ML, discovers dataset.json via rglob, and tracks the source URL in download_info.json for version comparison. _(depends on: DentalSegmentator nnU-Net v2 multiclass model (6-class CT/CBCT seg))_ Only relevant once there's an ONNX model to fetch. CBCTer already ships a model from public/models and has a service worker; reuse that pattern rather than porting the GitHub-release machinery. Note the MEMORY warning that large model binaries in the Downloads/public folder can dehydrate mid-session — a versioned Cache-Storage fetch mitigates that.
- **Signal observer helper** — Signal.py: a tiny dependency-free Qt-like signal/slot class (connect/disconnect/emit/blockSignals) used to decouple logic callbacks from the Qt widget. Pure plumbing; listed only for completeness. Skip it.

## Already covered by CBCTer (skip)

- Binary tooth segmentation via ONNX in a worker — toothSeg.worker.ts already does normalize + reflect-pad + sliding-window + sigmoid averaging + threshold, the exact shape of an nnU-Net-style inference loop
- Connected-components labeling, keep-largest, and fill-holes — connectedComponents.ts / maskOperations.ts already implement these in TS
- Surface/mesh generation from a mask to STL with smoothing + decimation + area/volume metrics — surface.worker.ts / maskMesh.ts / generateSurface.ts already cover this (DentalSegmentator just delegates to VTK marching cubes)
- Volume IO incl. DICOM CT/CBCT import — itkGdcm.ts + DICOM adapters already do what Slicer's DCM import does
- Labelmap overlay rendering / per-segment colors+opacity in 2D MPR and study state — extractLabelmapOverlayImage + studyState already model multi-segment labelmaps with color/opacity/visibility
- Project export of masks/labelmaps/surfaces — exportProject.ts already versions and round-trips these
