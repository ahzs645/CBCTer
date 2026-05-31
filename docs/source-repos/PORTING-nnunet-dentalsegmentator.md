# Porting DentalSegmentator (nnU-Net) into CBCTer

Status: **design + prerequisites shipped; model port blocked on weights & license.**

This is the headline feature port from the roadmap: multi-class jaw + teeth + mandibular-canal segmentation in one pass, replacing the current single-class tooth UNet + watershed guessing. The **preprocessing kit it depends on is now implemented and tested** (see below); the remaining work is the ONNX export of the nnU-Net model itself, which cannot proceed until the trained weights are obtained and their license cleared.

## What ships now (the preprocessing kit)

These are the pure-TS prerequisites, each unit-tested. They are model-agnostic and useful on their own:

| Concern | Module | Key exports |
|---|---|---|
| Resample to/from model spacing | `src/lib/volume/resample.ts` | `resampleVolume` (trilinear), `resampleLabelmap` (nearest), `targetDimsForSpacing` |
| nnU-Net CTNormalization | `src/lib/volume/intensityNormalization.ts` | `ctNormalize`, `DENTAL_SEGMENTATOR_CT_NORMALIZATION` ⚠️, `percentileNormalize`, `zScoreNormalize` |
| Per-class speckle cleanup | `src/lib/segmentation/maskOperations.ts` | `removeSmallComponents`, `removeSmallComponentsPerLabel` (skip the thin canal class) |

⚠️ `DENTAL_SEGMENTATOR_CT_NORMALIZATION` holds **placeholder constants** (`lower −110, upper 3067, mean 1273.7, std 558.5`). nnU-Net stores the real values in the model's `plans.json` → `foreground_intensity_properties_per_channel`. DentalSegmentator does **not** ship `plans.json` (weights + plans download from Zenodo at runtime), so these MUST be replaced with the values read from the actual `plans.json` before bundling weights.

## The remaining model port (blocked)

### Target output
DentalSegmentator labels: **Maxilla & upper skull, Mandible, Upper teeth, Lower teeth, Mandibular canal** (the `Dataset111_453CT` plans report spacing ≈ `[0.449, 0.312, 0.449]`, patch `[128, 160, 112]` per the analysis — verify against the real `plans.json`).

### End-to-end runtime flow (reuses `toothSeg.worker.ts` harness)
1. `resampleVolume(volume → model spacing, 'linear')`.
2. `ctNormalize(resampled, plansConstants)`.
3. Sliding-window patch inference at the plans patch size — same reflect-pad + overlap-accumulate loop already in `toothSeg.worker.ts`, but the model emits **C class channels**.
4. **Argmax across channels per voxel** → `Uint16` labelmap (replaces the current sigmoid>0.5 threshold).
5. `resampleLabelmap(labelmap → source grid, 'nearest')`.
6. `removeSmallComponentsPerLabel(..., { skipLabels: [CANAL] })`.
7. Emit a multi-label `StudySegmentGroup` (per-class color/name), which the existing `extractLabelmapOverlayImage` already renders.

### Blockers / risks
1. **Weights not on disk.** Download `Dataset111_453CT_v100.zip` from Zenodo **DOI 10.5281/zenodo.10829674**. **License must be verified before bundling** — the Apache-2.0 on the source code does **not** cover the trained weights. See `LICENSING.md`.
2. **ONNX export of a dynamic nnU-Net.** Extend `scripts/export_tooth_onnx.py`: instantiate `PlainConvUNet` from `plans.json`, load `fold_0` weights, `torch.onnx.export` at the plans patch size, then validate parity with `scripts/validate_onnx_pipeline.py` (the existing MONAI export hit ~1.4e-5 parity / Dice 0.996 — same discipline applies). Harder than the static MONAI UNet because the architecture is plans-derived.
3. **Compute.** Full-res 3-D patch inference in WASM is heavy. Use the **onnxruntime-web WebGPU execution provider**; budget weight size (tens–hundreds of MB) and version the Cache-Storage entry (note the repo memory: public-folder binaries dehydrate).

### Definition of done
- Real `plans.json` constants wired into `DENTAL_SEGMENTATOR_CT_NORMALIZATION`.
- Exported `dentalsegmentator.onnx` staged via `scripts/stage-ort.mjs`, parity-validated.
- Multi-class worker variant + a `StudySegmentGroup` with the 5 classes.
- Weight license cleared and recorded in `THIRD_PARTY_NOTICES.md`.
