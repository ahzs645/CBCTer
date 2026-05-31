# Source repos → CBCTer porting roadmap

_Generated analysis of the three dental-imaging research repos in `~/Downloads/New Folder With Items 2`, assessed for porting into the CBCTer web app._

## Per-repo documentation

- [SADT — Segmentation (AMASSS / DentalSeg batch / CLIC / CNE)](sadt-segmentation.md)
- [SADT — Landmark ID (ALI) & Auto Orientation (ASO)](sadt-landmark-orientation.md)
- [SADT — Registration & Transforms (AREG / AutoMatrix / AutoCrop3D / FlexReg)](sadt-registration-transform.md)
- [SADT — MRI2CBCT / MedX / DOCShapeAXI / VFACE / Anonymizer](sadt-misc-mri2cbct-medx-anonymizer.md)
- [SlicerDentalSegmentator (nnU-Net)](dental-segmentator-nnunet.md)
- [ToothGroupNetwork — three DISTINCT variants](toothgroupnetwork-variants.md)
- [CBCTer current state](cbcter-current-state.md)

## Implementation status

The pure-TS "quick wins" and the nnU-Net **preprocessing kit** are implemented and unit-tested (branch `feat/nnunet-preprocessing-kit`):

| Item | Module | Tests |
|---|---|---|
| Voxel-grid resampler (trilinear / nearest) | `src/lib/volume/resample.ts` | `resample.test.ts` |
| nnU-Net CTNormalization + percentile + z-score | `src/lib/volume/intensityNormalization.ts` | `intensityNormalization.test.ts` |
| Spacing-aware small-component removal | `src/lib/segmentation/maskOperations.ts` | `maskOperations.test.ts` |
| FDI (ISO 3950) tooth numbering | `src/lib/segmentation/fdiNumbering.ts` | `fdiNumbering.test.ts` |
| Rigid alignment (Horn) + Rodrigues + PCA/eigen | `src/lib/geometry/{rigidAlignment,linalg}.ts` | `geometry.test.ts` |
| ITK `.tfm` I/O + Mat4 + LPS↔RAS | `src/lib/geometry/transformMatrix.ts` | `geometry.test.ts` |
| Slicer `.mrk.json` fiducial I/O | `src/lib/io/slicerMarkups.ts` | `slicerMarkups.test.ts` |

Blocked / server-side items have design docs instead of code:

- [Porting DentalSegmentator nnU-Net](PORTING-nnunet-dentalsegmentator.md) — headline model port; blocked on weights + license.
- [Porting AReg / Elastix superimposition](PORTING-areg-elastix.md) — landmark alignment shipped; intensity registration is WASM-Elastix/microservice.
- [Licensing gate](LICENSING.md) — weight-license checklist; project still needs a `LICENSE` file. Attribution in [`/THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).

---

# CBCTer Porting Roadmap — What to Bring Over from the 3 Research Repos

*Sources assessed: SlicerAutomatedDentalTools (SADT) — segmentation, landmark/orientation, registration/transform, misc; SlicerDentalSegmentator; ToothGroupNetwork (3 variants). Target: CBCTer (React19 + Vite + onnxruntime-web + @itk-wasm/dicom + three.js + dexie).*

## 1. TL;DR

- **The single biggest feature win is DentalSegmentator / BATCHDENTALSEG nnU-Net** (jaw + per-tooth + mandibular canal in one pass). It replaces CBCTer's single-class tooth UNet + watershed guessing and reuses your existing `toothSeg.worker.ts` harness almost verbatim. It's XL, but it's the one ML port worth the money.
- **Before any model port, build two cheap shared enablers**: a target-spacing **volume resampler** (M) and **nnU-Net CTNormalization** (S). Every nnU-Net port (DentalSegmentator, AMASSS, MRI2CBCT, VFACE) is *wrong* without them, and they're pure TS math with no deps.
- **Grab the geometry freebies now**: FDI tooth numbering (PCA + midline), the ASO/Rodrigues rigid-alignment linalg core, Slicer `.mrk.json` landmark I/O, percentile normalization, `removeSmallComponents` (60 mm³), and the morphological-close radius step. All S–M, no models, high leverage.
- **Ignore everything LLM/NLP**: CNE, MedX, Medical_Data_Anonymizer (it's a *text* de-identifier, not DICOM). Ignore the **point-cloud neural nets** in ToothGroupNetwork (hand-written CUDA `pointops` — not portable) and **PyTorch3D-render models** (AREG_IOS butterfly U-Net, ALI_IOS, DOCShapeAXI).
- **One marquee feature is server-only-pragmatic, not in-browser**: AREG_CBCT **T1/T2 superimposition** (Elastix rigid registration). The honest path is `itk-wasm/elastix` in a worker or a microservice — a from-scratch TS Mattes-MI optimizer is an XL research trap.
- **Don't rebuild what you have**: connected-components, keep-largest, fill-holes, watershed split, mask→STL/PLY meshing, DICOM/NIfTI import, multi-label overlay rendering, and per-tooth QC/report are all already shipped. The redundancy lists below are extensive — check them before writing anything.

## 2. Quick wins (do first)

High-value, S–M effort, sorted best-first. These need no model weights.

| # | Item | Source area | Web approach | Effort | Why it matters to CBCTer |
|---|------|-------------|--------------|--------|--------------------------|
| 1 | **nnU-Net CTNormalization** (clip −110..3067, then (x−mean)/std; mean 1273.7 / std 558.5 from `plans.json`) | SADT-segmentation / DentalSegmentator | Add a CTNormalization branch beside the z-score block in `toothSeg.worker.ts`; constants hardcoded per model | **S** | Mandatory enabler for *every* nnU-Net port; ~20 lines; without it ported weights are unusable |
| 2 | **Spacing-aware small-island removal** (`removeSmallComponents`, 60 mm³) | DentalSegmentator | New helper next to `maskOperations.ts`: `labelComponents()` then drop comps < `ceil(60/(sx·sy·sz))`, skip canal class | **S** | Cleans nnU-Net output *and* improves current tooth masks/surfaces; builds on existing `connectedComponents.ts` |
| 3 | **Percentile contrast normalization** (`normalize_percentile.py`) | SADT-misc | TS pass over `Int16Array`: histogram (you already compute `scalarRange`), pick lo/hi percentiles, clip+rescale | **S** | Doubles as window/level auto-preset *and* better model input than `toothInference.ts`'s min/max |
| 4 | **FDI tooth numbering** (PCA principal-axis + midline split + jaw offset, `FDI_NUMBERING` map) | ToothGroupNetwork (variant 2) | 3×3 covariance eigen-decomp on existing per-tooth voxel centroids; arithmetic quadrant assignment; copy the dict | **M** | CBCTer has **zero** FDI numbering today; upgrades watershed-split `tooth-1..N` to clinical labels. Highest-value *conceptual* gap |
| 5 | **ASO rigid-alignment math core** (Rodrigues, angle/axis, apply-4×4-to-points, mean-distance) | SADT-landmark-orientation | Mostly exists via three.js `Matrix4`/`Quaternion.setFromAxisAngle`; add landmark-dict apply helpers (~150 lines) | **S** | Foundation for all orientation/registration work; highest value-to-effort in that area |
| 6 | **Transform math core** (read/write `.tfm`, 4×4 compose/invert, LPS↔RAS flip) | SADT-registration-transform | three.js gives compose/invert; add tiny ITK `.tfm` text parser/writer + `diag(-1,-1,1)` flip | **S** | CBCTer has **no** transform-matrix concept; unblocks apply-to-volume, landmark transforms, AutoMatrix |
| 7 | **Slicer Markups `.mrk.json` I/O** + landmark type | SADT-landmark-orientation | Trivial JSON parse/serialize to the Markups schema; add `Landmark` to `domain/types.ts` + study-state layer | **S** | No fiducial concept today; unlocks the entire Slicer/SADT interop ecosystem; watch LPS↔voxel conversion |
| 8 | **Morphological close radius step** (dilate→fill-holes→erode) | SADT-segmentation | Add `binaryDilate`/`binaryErode` via the existing EDT in `watershed.ts` (threshold at radius) to `maskOperations.ts` | **S** | Completes AMASSS `CleanArray` parity; generally improves all mask cleanup; EDT already exists so it's nearly free |
| 9 | **Per-tooth centroid extraction** (vtkMeanTeeth by label) | SADT-landmark-orientation | Average voxel/world coords per label — `generateLibrary.ts` already produces per-tooth masks | **S** | Nearly free from existing data; feeds FDI numbering (#4) and any arch-coordinate UI |
| 10 | **VFACE landmark geometry** (point-to-line, vector projection/rejection, signed plane distance) | SADT-misc | Add the 3 missing primitives to `measurements/geometry.ts` (you already have `distance3d`/`angleDegrees`) | **S** | Cheap cephalometric-measurement expansion; only valuable if landmarking lands, but near-zero cost |
| 11 | **NIfTI/NRRD affine handling** (`approx_utils.py`: RAS↔LPS, SVD direction orthogonalization) | SADT-misc | Wire affine into `niftiLoader.ts` (today it drops qform/sform, treats all volumes axis-aligned) | **M** | Fixes correctness for tilted scans + STL export orientation; closes a real silent-bug gap |
| 12 | **Geometry-preserving NIfTI/NRRD label writer** (`SavePrediction`) | SADT-segmentation | Inverse of `niftiLoader.ts`; RAS↔LPS is an affine sign-flip | **M** | Lets users round-trip predictions to Slicer/clinical tools; self-contained, no heavy deps |

**Recommended bundle:** ship #1, #2, #3 together (the "nnU-Net preprocessing/postprocessing kit"), then #4 + #9 together (the "FDI kit"), then #5–#7 together (the "transform/landmark kit"). Each bundle is a coherent PR.

## 3. Bigger bets (web-with-effort) — ML models worth an ONNX export

CBCTer already has the proof-of-concept: the tooth UNet was exported (~1.4e-5 parity, Dice 0.996) via `scripts/export_tooth_onnx.py` + `validate_onnx_pipeline.py`, staged with `stage-ort.mjs`. Every model below reuses that pipeline and the `toothSeg.worker.ts` sliding-window/reflect-pad harness.

**Keystone (build once, reused by all): nnU-Net ONNX export pipeline** — L effort. Extend `export_tooth_onnx.py` to instantiate nnU-Net's `PlainConvUNet` from `plans.json`, load `fold_0` weights, `torch.onnx.export` at the plans patch size, validate parity. Main risk: nnU-Net's *dynamic* architecture makes export fiddlier than a static MONAI UNet, and weights are runtime downloads (not on disk) — large (tens–hundreds of MB), so plan Cache-Storage versioning (note the MEMORY warning that public-folder binaries dehydrate).

| Model | Source | Realistic pipeline | Effort | Main risk |
|-------|--------|-------------------|--------|-----------|
| **DentalSegmentator / BATCHDENTALSEG** (jaw + teeth + canal, 5/6/55 labels) — *the best target* | SADT-seg / DentalSegmentator | Export nnU-Net→ONNX; resample-in (§2.#enabler) → CTNorm (#1) → sliding-window argmax in worker → resample-out (NN) → small-island removal (#2) → multi-label `StudySegmentGroup`. `plans.json` for `Dataset111_453CT` is shipped (spacing [0.449,0.312,0.449], patch [128,160,112], constants known). | **XL** | Full-res 3D patch inference in WASM is heavy — **use the onnxruntime-web WebGPU EP** to make it tractable; weight size + license (see §6) |
| **AMASSS** multi-structure (mandible/maxilla/cranial-base/airway/cervical-vertebra/skin) | SADT-seg | Same path; merge per-structure logits by documented priority. Per-structure `CleanArray` ≈ free (reuse keep-largest + close from #8) | **XL** | Heaviest; realistic in-browser for 1–2 structures, server for all at full res |
| **MRI2CBCT / VFACE nnU-Net** (ResEnc-XL TMJ/dental) | SADT-misc | Distill to a fixed-shape ONNX UNet into the same worker, accepting lower fidelity | **XL** | ResEnc-XL is desktop/GPU-native; honest answer is server microservice or a smaller distilled net |
| **VFACE LightGBM** tabular asymmetry (sym/mand/max) | SADT-misc | Dump boosters to JSON + tiny TS tree-walker, or `onnxmltools`→ONNX. Inputs = a few landmark features from #10 | **M** | Low value unless facial-asymmetry analysis is a target; technically very portable |
| **ALI_CBCT deep-RL landmark agents** (per-landmark DenseNet3D) | SADT-landmark | Export each `.pth`→ONNX; reimplement the agent walk loop (crop FOV → net → argmax move → focus-average) in the worker | **XL** | Dozens of `.onnx` files (per landmark × scale), sequential per-step inference is slow in WASM; consider server |

**Decision:** do the **keystone + DentalSegmentator** first. It alone delivers jaw + per-tooth FDI + canal, which exceeds everything CBCTer's current tooth pipeline does, and the 55-label UniversalLab variant gives true FDI numbering (combine with the mirror-correction port, M effort).

## 4. Server-side / desktop-only — not in-browser

| Capability | Source | Why not browser | Pragmatic answer |
|-----------|--------|-----------------|------------------|
| **ToothGroupNetwork point-cloud nets** (tgnet, TSegNet, DGCNN, PointMLP, etc.) | ToothGroupNetwork (all 3 variants) | Hand-written CUDA `pointops`/`pointnet2_utils` (FPS/kNN/grouping), unconditional `.cuda()`; ORT-web has no efficient FPS/ball-query | **Skip.** Only if intraoral-scan support is ever added: GPU PyTorch microservice (variant 2's Dockerfile). Variant **A** is the only weights source (8 torch-zip `.h5`, ~250 MB) |
| **CLIC impacted-canine Mask R-CNN** | SADT-seg | Mask R-CNN exports to ONNX poorly (dynamic NMS, RoIAlign, variable detections) | Server-side only if ever needed (niche) |
| **AREG_CBCT Elastix rigid registration** (T1/T2 superimposition) | SADT-reg | Intensity registration is heavy; a TS Mattes-MI optimizer is an XL research project | **`itk-wasm/elastix` in a worker** (weigh multi-MB WASM vs PWA goals) **or** microservice. *This is a marquee dental feature* — worth a microservice if local-first can't carry it |
| **AREG_IOS butterfly U-Net, ALI_IOS, DOCShapeAXI** | SADT-reg/landmark/misc | PyTorch3D differentiable mesh rasterization — no browser equivalent | Server-only. For AREG_IOS, prefer the model-free **FlexReg geometric butterfly** (L, but still IOS-gated) |
| **CNE, MedX, Medical_Data_Anonymizer** (LLM/NLP) | SADT-seg/misc | GGUF/BART/Qwen LLMs + Presidio+spaCy; *not imaging* (the "anonymizer" is text-only, never touches DICOM) | Out of scope. Note: CBCTer's actual privacy gap is DICOM-tag/pixel de-id, which this module does **not** address |

**Microservice verdict:** worth standing up exactly one small onnxruntime/Elastix service *if and only if* you pursue (a) full-res AMASSS at all structures, or (b) T1/T2 superimposition and `itk-wasm/elastix` proves too heavy. Everything else is either in-browser-feasible or skippable. A mandatory GPU backend conflicts with CBCTer's local-first/PWA positioning, so keep it optional.

## 5. Already covered by CBCTer — do not rebuild

- **Connected-components / keep-largest / fill-holes** → `connectedComponents.ts`, `maskOperations.ts` (6/26-conn, bbox, centroid, sizes). *Only the morphological-close radius step is missing (§2.#8).*
- **Tooth instance separation** → `watershed.ts` (EDT watershed) already replaces the Python scipy split and TGN offset-clustering.
- **Mask → surface mesh + STL/PLY** with area/volume → `maskMesh.ts` (marching-tetrahedra + voxel surface, Laplacian smoothing, decimation), `surface.worker.ts`, `generateSurface.ts`. *Net-new only: OBJ/glTF writers (glTF via three.js `GLTFExporter`) and per-class iteration.*
- **3D UNet ONNX inference** (normalize + reflect-pad + sliding-window + sigmoid averaging) → `toothSeg.worker.ts` / `toothInference.ts` — *the exact harness an nnU-Net port reuses.*
- **Multi-label overlay rendering** with per-segment color/opacity/visibility → `StudySegmentGroup` in `domain/types.ts` + `extractLabelmapOverlayImage`.
- **Per-tooth QC + CSV/HTML report** → `generateLibrary.ts` `quality()` + `report.ts`.
- **DICOM import** (incl. ImageOrientationPatient via GDCM) → `itkGdcm.ts` + DICOM adapters; **NIfTI read** → `niftiLoader.ts` (*but affine is dropped — see §2.#11*). dicom2nifti conversion is unnecessary in-browser.
- **Voxel ROI crop** → `roi.ts` (`clampRoi`, `extractCropFloat32`) + 3D crop clipping. *AutoCrop3D adds only physical-mm ROI parsing + re-embed; propagate affine origin on crop when orientation lands.*
- **3D mesh viewing / STL viewport** → `ToothMeshViewport.tsx`, `ToothArchViewport.tsx` (STLLoader + OrbitControls). TGN's Plotly/Dash viewer is a downgrade.
- **Project export** of masks/labelmaps/surfaces → `exportProject.ts` (versioned, round-trips).
- **Per-tooth color palette** → `generateLibrary.ts` `TOOTH_COLORS`. *(The FDI→color mapping is still new; the palette isn't.)*

## 6. Licensing & attribution watch-outs

- **DentalSegmentator / nnU-Net weights are the critical risk.** The Slicer source is Apache-2.0, but that **does not cover the trained weights** (`Dataset111_453CT_v100.zip`, Zenodo **DOI 10.5281/zenodo.10829674**). Verify the Zenodo weight license *before bundling any exported ONNX in a shipped web app*. nnU-Net itself is Apache-2.0 (architecture/export code is fine); the *weights* are the encumbered artifact.
- **SADT model weights are all runtime downloads, none on disk.** AMASSS, ALI, ASO, AREG models are fetched from GitHub releases at runtime. You must obtain and re-host them yourself, which makes their individual licenses *your* responsibility to confirm — don't assume the repo license propagates to released weights.
- **ToothGroupNetwork: license unstated / research-only.** The MICCAI-2022 challenge code has no clear redistribution license; variant A's bundled `.h5` checkpoints (~250 MB) are research artifacts. Treat as non-redistributable until clarified. (Moot for in-browser since the nets aren't portable, but relevant if you stand up a microservice.)
- **CBCTer has no LICENSE file of its own** (confirmed — none in repo). If you bundle any third-party weights or ported code, add proper attribution/NOTICE now; nnU-Net (Apache-2.0) and SADT (check per-module) require attribution.
- **`shapeaxi`, Presidio, PyTorch3D** carry their own licenses — irrelevant since those components are out of scope, but don't vendor their code.
- **Practical rule:** ported *math/algorithms* (Rodrigues, FDI heuristic, CTNormalization constants, ICP) are facts/short routines and low-risk to reimplement with attribution. Ported *weights* are the licensing hazard — gate every model port on a weight-license check.

## 7. Suggested next concrete step

**Build the "nnU-Net preprocessing kit" as one PR**, because it's pure TS math, ships value immediately, and is the prerequisite for the headline DentalSegmentator port:

1. **`src/lib/volume/resample.ts`** — a worker-friendly trilinear (intensity) / nearest-neighbor (label) resampler between source `volume.meta.spacing` and an arbitrary target spacing. Borrow the indexing pattern from `roi.ts` `extractCropFloat32` and the sampling pattern from the panoramic spline code. This is the one genuinely-new primitive CBCTer lacks, and it's also reusable for the 3D renderer and panoramic.
2. **CTNormalization branch in `toothSeg.worker.ts`** — clip to [−110, 3067], then (x−mean)/std with constants read from a small per-model JSON (start with `Dataset111_453CT`: mean 1273.7, std 558.5). ~20 lines beside the existing z-score block.
3. **`removeSmallComponents(mask, dims, spacing, minVolumeMm3)`** in `maskOperations.ts` — wraps existing `labelComponents()`, drops comps below `ceil(60/(sx·sy·sz))`, applied per-class with the canal class skipped.

Validate the resampler against a known volume (round-trip resample → original spacing, check error) using the same parity-test discipline as `validate_onnx_pipeline.py`. Once this kit lands, the DentalSegmentator ONNX export (the keystone, §3) drops into `toothSeg.worker.ts` with only a sigmoid→multi-class-argmax swap.

**Relevant existing files to anchor the work:** `/Users/ahmadjalil/github/CBCTer/src/workers/toothSeg.worker.ts`, `/Users/ahmadjalil/github/CBCTer/src/lib/segmentation/toothInference.ts`, `/Users/ahmadjalil/github/CBCTer/src/lib/segmentation/roi.ts`, `/Users/ahmadjalil/github/CBCTer/src/lib/segmentation/maskOperations.ts`, `/Users/ahmadjalil/github/CBCTer/src/lib/segmentation/connectedComponents.ts`, `/Users/ahmadjalil/github/CBCTer/scripts/export_tooth_onnx.py`, `/Users/ahmadjalil/github/CBCTer/scripts/validate_onnx_pipeline.py`, `/Users/ahmadjalil/github/CBCTer/scripts/stage-ort.mjs`, `/Users/ahmadjalil/github/CBCTer/src/app/sources/niftiLoader.ts`.
