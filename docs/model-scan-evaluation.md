# Segmentation on both native vendor scans — 4 October 2026

The feasible models ran on both authorized vendor examples. They are **unreviewed proposals**, not validated clinical segmentations. OralSeg and TIPs were acquired but cannot run in this CPU environment; GEPAR3D's full checkpoint and TAPSeg's implementation are unavailable. Earlier clinic-scan counts are not results on these two examples.

## Scan results

| Model | OneVolume, partial field of view | Sidexis, full native volume |
| --- | --- | --- |
| YOLOv8n-seg | 7 proposals; 0 at shipping size cutoff; 36.8 s | 32 proposals; 25 at shipping size cutoff; 47.4 s |
| Tooth ROI U-Net (ONNX) | 3 representative ROIs; foreground Dice 1.0 versus other engine; 8.0 s | 3 representative ROIs; foreground Dice 1.0 versus other engine; 10.3 s |
| Tooth ROI U-Net (Python) | 3 representative ROIs; foreground Dice 1.0 versus other engine; 7.2 s | 3 representative ROIs; foreground Dice 1.0 versus other engine; 10.4 s |
| DentalSegmentator | 3 anatomy classes; no tooth instances; 18.4 s | 5 anatomy classes; no tooth instances; 221.2 s |
| Pediatric DentalSegmentator | 3 anatomy classes; no tooth instances; 19.8 s | 5 anatomy classes; no tooth instances; 252.5 s |
| Universal DentalSegmentator | 11 tooth labels + 1 anatomy labels; 32.9 s | 29 tooth labels + 3 anatomy labels; 806.7 s |
| AMASSS skin | Soft-tissue region; no tooth instances; 18.6 s | Soft-tissue region; no tooth instances; 256.1 s |
| AMASSS airway | Only tiny fragments; unsuitable; 16.6 s | Only tiny fragments; unsuitable; 419.4 s |
| ToothSeg pair | 4 distinct instances (FDI needs correction); 524.5 s | 21 distinct instances (FDI needs correction); 2520.9 s |

OneVolume is 341×341×344 at 0.125 mm; Sidexis is 512³ at 0.16 mm. The OneVolume vendor calibration's equivalence to HU and anatomical orientation remain unverified. Sidexis retains DICOM LPS geometry. Neither scan has clinician-labelled ground truth. Counts, framework agreement and archive alignment establish engineering behavior; they do not measure tooth accuracy, canal sensitivity or diagnostic performance.

CPU runs used two threads in a four-core, 16 GiB container, often concurrently with other inference and validation. Times include model initialization and native prediction mapping, but exclude archive generation/most statistics. ROI times above are measured inference per engine, not the combined comparison job. ToothSeg totals add both inference stages and fusion. These are recorded execution times, unsuitable for mobile speed estimates or a fair model ranking.

## What the results mean for CBCTer

- **YOLO:** 1500 voxels on the 0.3 mm model grid is 40.5 mm³; the shipping 8000 cutoff is 216 mm³. The stricter cutoff leaves 25 Sidexis proposals and **zero** OneVolume proposals. Seven survive the exploratory cutoff on OneVolume, but overlays show incomplete/fractured tooth coverage. Expose minimum-size filtering as a review choice; do not mistake a detection count for complete teeth. YOLO has one tooth class; geometry-derived FDI numbering needs review.
- **ROI U-Net:** both formats agree exactly at the binary threshold on all six tested crops; maximum probability differences are about 2×10⁻⁶. This verifies ONNX/Python parity, not segmentation quality. Only three YOLO-centred 80³ native crops per scan were assessed; outside those regions is unassessed. Use as a local refinement candidate, not whole-mouth detection.
- **DentalSegmentator / pediatric:** anatomy regions are useful context for bone/teeth/canal review. Both produce three classes on the partial OneVolume field and all five on Sidexis. They do not create individual tooth instances. Testing the pediatric model on these examples does not validate pediatric clinical performance.
- **Universal:** proposes separate semantic tooth identities and anatomy. The OneVolume run includes tiny molar/incisor fragments and unlikely lower-jaw labels. Keep the proposals unreviewed, allow renumbering/removal, and preserve bone separately for isolation. Semantic tooth classes can contain disconnected components; their count is not an instance-accuracy score.
- **AMASSS skin:** supports soft-tissue context, not tooth isolation. The predicted region also contains small disconnected components.
- **AMASSS airway:** remains unsuitable on both scans: only about 0.64 and 0.43 mm³ of scattered voxels. The old staged validation incorrectly reused SKIN intensity statistics. The validator now uses UAW's own released plans: clip [-1103,-314], mean -830.5769653, std 171.675293. The UAW dataset JSON reuses the generic label “Skin”; the evaluation names it Upper airway from its released model folder. Do not enable this as a trusted clinical result.
- **ToothSeg:** default 256³ semantic patches failed here (OneVolume exit 139; Sidexis killed, exit 137). Semantic inference was rerun at 128³, overlap 0.5. OneVolume border inference completed with its 192³ patch. Sidexis border inference at 192³ was stopped after four patches because of throughput; it completed at 128³, overlap 0.25. These are CPU adaptations, not the official GPU pipeline or accuracy reproduction. Border/core conversion follows upstream 16 mm³ centre/instance thresholds, then assigns majority semantic classes including background. Stable instances are retained separately from suggested FDI numbers, including duplicate numbers. No semantic-only recovery is applied. Numbering is inconsistent on the partial OneVolume scan; the historical “28 teeth” clinic result must not be generalized.

The nnU-Net-family CPU adapter uses released plan normalization, spacing, transpose settings and strict checkpoint loading. It uses centre-aligned resampling, reflect padding and maximum-softmax-confidence overlap fusion to match the current browser adaptation. Official nnU-Net Gaussian averaging, mirroring/TTA and ensembles were not reproduced. Universal uses a 128³ window matching the browser export, instead of its training window. OneVolume benchmark input calibration used float32: comparison with exact browser display rounding differs by at most 1 unit in 17,897 of 40,000,664 voxels (0.045%). Archive scan identity/display binding uses original native words and exact browser rounding; inference-only padding replacement never modifies scan exports.

## Verified sizes

MB here means 1,000,000 bytes. Checkpoint containers include training state; parameter payloads are **not** measured ONNX exports.

| Model | Acquired artifact | FP32 parameter bytes measured in loaded network |
| --- | ---: | ---: |
| YOLOv8n-seg | 13,227,123 B ONNX (13.23 MB) | — |
| ROI U-Net ONNX | 4,763,683 B (4.76 MB) | — |
| ROI U-Net Python | 4,799,074 B checkpoint (4.80 MB) | — |
| DentalSegmentator | 247,050,939 B checkpoint (247.05 MB) | 123,156,856 B |
| Pediatric DentalSegmentator | 250,280,254 B checkpoint (250.28 MB) | 124,795,256 B |
| Universal DentalSegmentator | 819,880,677 B checkpoint (819.88 MB) | 409,572,960 B |
| AMASSS skin | 249,703,167 B checkpoint (249.70 MB) | 124,782,376 B |
| AMASSS airway | 249,785,919 B checkpoint (249.79 MB) | 124,782,376 B |
| ToothSeg, two checkpoints | 495,868,996 B total (495.87 MB; 472.90 MiB) | 246,390,992 B total |
| OralSeg | 428,278,566 B checkpoint (428.28 MB; 408.44 MiB) | Not instantiated without Mamba; stored tensors total 428,138,344 B |
| TIPs | 1,258,074,583 B ZIP; three fold_all inference checkpoints total 1,015,548,971 B | Not instantiated without Mamba |

TIPs fold_all checkpoints are 337,235,449 B (binary teeth), 337,672,633 B (pulp), and 340,640,889 B (tooth instances). The ZIP also contains a redundant 337,599,865 B pulp checkpoint outside fold_all. This package differs from historical reported sizes. GEPAR3D's public 7,920,382 B file is only a coarse one-class UNet, not the missing 33-class GEPAR3D model. TAPSeg has no measured weights.

## Web workflow without owning a GPU

[Open the experimental Colab GPU runner](https://colab.research.google.com/github/ahzs645/CBCTer/blob/main/notebooks/CBCTer_GPU_models.ipynb).

1. Choose a Colab GPU runtime. Free availability is not guaranteed. No cloud GPU was launched or tested in this CPU session.
2. Select OralSeg or TIPs. The notebook creates an isolated Python 3.10/Torch CUDA/Mamba environment and pins upstream code versions. CUDA/Mamba installation can still fail as Colab images change; retain the log rather than replacing the model with a stub.
3. Export **Scan only** from CBCTer and upload its native v2 `.cbct.zip` to the notebook. This explicitly sends the chosen scan to the user's Google runtime; the CBCTer viewer does not upload it automatically.
4. Download `.cbct.zip` for complete streamed viewing or `.cbcter.zip` for **Review teeth → Import model result** on the matching full native grid.
5. Select a stable tooth instance, inspect all planes, correct numbering/outlines and explicitly accept reviewed proposals. Export **Scan + analysis** to keep the original prediction, model fingerprint and corrections.

The archive bridge verifies every native chunk and full scan hash, reads NIfTI physical registration, maps labels back with nearest-neighbour sampling and emits native analysis chunks. It preserves original model predictions and provenance, keeps FDI separate from instance identity, and rejects mismatching scan/display bindings during import. The importer adds results while preserving notes, chart, measurements, accepted/corrected outlines and view. Repeated imports of the same archive are rejected. Phone editing budgets are checked before labelmap inflation; larger complete cases remain viewable by streaming.

The bridge has been executed and checked with actual CPU predictions, and a synthetic rotated-geometry cross-language test. Notebook syntax, checkpoint structure and source preprocessing have been checked. **The OralSeg and TIPs GPU adapters have not been executed on a GPU**, so no inference success, runtime or quality is claimed for them. OralSeg uses the published validation settings (RAS, 0.6 mm, [0,2500] → [0,1], 64³ windows, overlap 0.5) and strict checkpoint loading. TIPs runs its upstream teeth/instance/pulp pipeline; this notebook exports the tooth instances. Upstream TIPs does not propagate every subprocess failure: inspect every stage and output. Pulp outputs remain in its runtime for separate review.

OralSeg weights are published under CC-BY-NC-4.0. They need separate permission for commercial deployment. TIPs and other third-party weight licensing must be checked before public redistribution; no newly acquired weights are committed or deployed by this change. This runner is an optional research workflow, not a hosted CBCTer inference service.

## Reproduce privately

Keep scans, weights, predictions and screenshots outside the repository. The only committed results are aggregate engineering metrics in [model-scan-results.json](model-scan-results.json); acquired model identities are in [model-weight-artifacts.json](model-weight-artifacts.json).

```bash
python3 -m venv "$EVALUATION_ROOT/venv"
"$EVALUATION_ROOT/venv/bin/pip" install torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu
"$EVALUATION_ROOT/venv/bin/pip" install -r scripts/requirements-model-benchmark.txt
"$EVALUATION_ROOT/venv/bin/python" scripts/prepare_model_benchmark.py --scans "$NATIVE_SCAN_PACKAGES" --root "$EVALUATION_ROOT"
# Input directory contains onevolume.cbct.zip and sidexis.cbct.zip.
# Defaults to the tested float32 calibration; --calibration-precision float64
# uses exact browser rounding for future evaluations.
"$EVALUATION_ROOT/venv/bin/python" scripts/benchmark_cbct_models.py --root "$EVALUATION_ROOT" --scan sidexis --model yolo --weights public/models/tooth-yolov8n-seg.onnx
"$EVALUATION_ROOT/venv/bin/python" scripts/benchmark_cbct_models.py --root "$EVALUATION_ROOT" --scan sidexis --model legacy --weights public/models/tooth-unet-96.onnx --python-weights models/model-toothcrops-CBCT-normalize_best.pth
# nnU-Net families: --weights <trainer-directory-containing-plans-and-dataset>
# ToothSeg: --checkpoint checkpoint_best.pth and its inherited configuration.
# See recorded preprocessing/window values in model-scan-results.json.
"$EVALUATION_ROOT/venv/bin/python" scripts/fuse_toothseg_evaluation.py --root "$EVALUATION_ROOT" --scan sidexis
npx --yes tsx scripts/export_model_evaluation_cases.ts --root "$EVALUATION_ROOT" --scans "$NATIVE_SCAN_PACKAGES"
npx --yes tsx scripts/verify_model_evaluation_cases.ts "$EVALUATION_ROOT"
CBCTER_MODEL_PYTHON="$EVALUATION_ROOT/venv/bin/python" npm test -- --run src/lib/case/gpuBridge.test.ts
CBCTER_MODEL_EVALUATION_ROOT="$EVALUATION_ROOT" npm run test:e2e -- --grep 'model results' --workers=1
```

Acquire public models from [DentalSegmentator Zenodo 10829675](https://zenodo.org/records/10829675), [SADT model releases](https://github.com/DCBIA-OrthoLab/SlicerAutomatedDentalTools/releases), [AMASSS release](https://github.com/DCBIA-OrthoLab/SlicerAutomatedDentalTools/releases/tag/AMASSS_CBCT), [ToothSeg Zenodo 14893540](https://zenodo.org/records/14893540), [OralSeg weights](https://huggingface.co/aiadir/OralSeg), and [TIPs](https://github.com/TaoZhong11/TIPs). `scripts/download_model_zip_members.py` can select plans/dataset/checkpoints from large public ZIPs using verified HTTP range lengths and ZIP CRC. Verify hashes against the artifact catalog. Do not use the full large checkpoint container as a browser weight download; ONNX exports need separate numerical/browser validation and licensing.

GEPAR3D was inspected at [tomek1911/GEPAR3D](https://github.com/tomek1911/GEPAR3D); its linked public folder contains only a coarse checkpoint and auxiliary class weights/Wasserstein matrix. [TAPSeg](https://github.com/simzhangbest/TAPSeg) states that code, models and inference scripts will be released later. Both remain blocked before scan inference, rather than failed quality tests.

## Validation performed

- Full unit suite with the optional CPU bridge: 179 passed; four original private vendor-input tests skip when their environment paths are absent. Added import preservation, duplicate rejection, byte-grid checks and pre-inflation memory tests.
- Python/TypeScript bridge test: passed, including a rotated direction matrix with small floating-point terms, raw scan identity, full native labelmap bytes and unreviewed FDI metadata.
- Default Chromium suite: 16 passed; 11 optional tests skipped. New model-import controls passed at desktop and 390×844 touch/mobile layout.
- Actual model-result browser tests: four passed: OneVolume YOLO streamed/dense review and another-model import (desktop), safe memory rejection (mobile), and Sidexis anatomy streamed viewing on both layouts.
- Native range/cache/full-volume browser checks: all five passed, covering both vendor scans at desktop/mobile layouts and the no-Range error path.
- All exported result packages: metadata/scan fingerprint, model provenance, prediction preservation and sampled chunk voxel alignment checked against their dense analysis projects. New large weights are not present in the deployed webapp; optional pediatric/universal ONNX browser inference tests remain unexecuted.
- TypeScript compilation, ESLint, production build, Python syntax and notebook cell syntax checked. Mobile tests use Chromium emulation, not physical iPhone/Android devices.
