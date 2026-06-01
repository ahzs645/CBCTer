# Porting DentalSegmentator (nnU-Net) into CBCTer

Status: **weights pulled, exported to ONNX, validated on a real CBCT (Python), wired into the viewer UI ("Full anatomy"), and the in-browser execution path resolved — runs on multi-threaded wasm (~1 min/volume).**

## Browser execution path (✅, resolved)

The in-browser EP question is settled by direct measurement (Chrome on macOS, Apple GPU, driven over CDP):

- **WebGPU does NOT work for this model.** onnxruntime-web's WebGPU EP cannot run 3D `ConvTranspose` (the U-Net decoder's learned upsampling) — it hard-errors (`"currently only support 2-dimensional conv"`) and does **not** fall back. So `['webgpu','wasm']` would *fail*, not run slow.
- **wasm (CPU) works and is correct.** A real preprocessed patch on the wasm EP matched the CPU reference to ~0.003% (checksum within 0.027%).
- **Speed needs threads.** Multi-threaded wasm (14 threads, cross-origin isolated) ran **~7 s/patch → ~1 min for a full CBCT (8 patches)**. Single-threaded is several minutes/patch — too slow.

Implemented accordingly: `dentalSeg.worker.ts` uses `executionProviders: ['wasm']` and sets `ort.env.wasm.numThreads` from `navigator.hardwareConcurrency` when `crossOriginIsolated`; `vite.config.ts` sends COOP/COEP (`credentialless`) on dev + preview to enable isolation. **Production hosting must send the same COOP/COEP headers** for threads.

Future GPU acceleration (optional): rewrite each kernel=stride 3D `ConvTranspose` as `Conv` + pixel-shuffle (`Reshape`/`Transpose`) — ORT-web WebGPU runs those — to move the whole net onto WebGPU. Exact (no accuracy loss) but real graph-surgery work; wasm-MT's ~1 min is good enough for now.

## Real-scan validation (✅)

`scripts/validate_dentalseg_real.py` runs the exact pipeline (resample → CTNorm →
reflect-pad → sliding-window → softmax-avg → argmax) with the exported ONNX on a
real 512³ 0.16 mm CBCT. Result — **all 5 structures segmented with plausible
volumes** and spatially coherent overlays (not noise):

| Class | Volume |
|---|---|
| Upper Skull | 14.7 cm³ |
| Mandible | 20.2 cm³ |
| Upper Teeth | 7.9 cm³ |
| Lower Teeth | 7.6 cm³ |
| Mandibular canal | 0.46 cm³ |

This confirms the export + preprocessing constants are correct. Caveat: upper/lower
*labeling* depends on the superior-axis direction — verify orientation per scan
(the segmentation of each structure is correct regardless).

Multi-class jaw + teeth + mandibular-canal segmentation in one pass — replacing the single-class tooth UNet + watershed. The weight-license blocker is **cleared**: the weights are CC-BY-4.0 (attribution-required, redistributable).

## The model (verified facts, read from the shipped package)

`Dataset112_DentalSegmentator_v100` — Zenodo DOI **10.5281/zenodo.10829674**, **CC-BY-4.0**.

| Property | Value (from `plans.json` / `dataset.json`) |
|---|---|
| Classes (6) | 0 background, 1 Upper Skull, 2 Mandible, 3 Upper Teeth, 4 Lower Teeth, 5 Mandibular canal |
| Architecture | `PlainConvUNet`, 6 stages, base 32 → max 320 features |
| Patch size | `[128, 160, 112]` (d, h, w) |
| Target spacing | `[0.4316, 0.3120, 0.4316]` (nnU-Net plans axis order) |
| Normalization | `CTNormalization`: clip `[-208, 3070]`, then `(x − 1178.2615) / 611.7099` |

These constants are wired into code, not guessed:
- `src/lib/segmentation/dentalSegmentator.ts` — labels (+colors), patch size, spacing, class count, canal label.
- `src/lib/volume/intensityNormalization.ts` `DENTAL_SEGMENTATOR_CT_NORMALIZATION` — the verified CTNormalization params.

## What is built

| Piece | File | Tested |
|---|---|---|
| ONNX export script | `scripts/export_dentalseg_onnx.py` (`npm run segment:export-dentalseg`) | Produced a 123 MB single-file ONNX; `strict=True` weight load validates the rebuilt architecture; onnxruntime run confirms output `[1, 6, 128, 160, 112]` |
| Preprocessing kit | `resample.ts`, `intensityNormalization.ts`, `maskOperations.removeSmallComponents*` | unit-tested |
| Inference orchestration | `src/lib/segmentation/dentalSegInference.ts` (resample → CTNorm → reflect-pad → sliding-window → per-voxel softmax average → argmax → resample back → per-class cleanup) | unit-tested with a **mock** model |
| ONNX/WebGPU worker | `src/workers/dentalSeg.worker.ts` (thin adapter; `executionProviders: ['webgpu','wasm']`) | compile-checked |

The 123 MB model is **gitignored** (`public/models/dentalsegmentator.onnx`) — regenerate it with:

```bash
# 1. download + unzip the weights (CC-BY-4.0)
curl -L -o w.zip "https://zenodo.org/api/records/10829675/files/Dataset112_DentalSegmentator_v100.zip/content"
unzip w.zip -d /tmp/dseg
# 2. export to a single-file ONNX (needs: pip install torch dynamic_network_architectures onnx onnxscript)
DENTALSEG_MODEL_DIR="/tmp/dseg/Dataset112_DentalSegmentator_v100/nnUNetTrainer__nnUNetPlans__3d_fullres" \
  npm run segment:export-dentalseg
```

## Remaining work

1. **Runtime validation in-browser.** The orchestration is verified with a mock model; run the real 123 MB ONNX over a CBCT and compare against the Slicer DentalSegmentator output. Use the **WebGPU EP** — full-res 3-D patch inference is heavy for wasm.
2. **Axis order.** `plans.json` spacing/patch are in nnU-Net plans axis order; confirm it matches CBCTer's `[D,H,W]` voxel frame (or reorder in the worker before `runDentalSegmentation`). nnU-Net also applies a transpose during preprocessing — verify parity on a known case.
3. **UI wiring.** Surface the 5 classes as a multi-label `StudySegmentGroup` (colors already defined in `dentalSegmentator.ts`); the existing `extractLabelmapOverlayImage` renders it. Add a "Full anatomy segmentation" action that spawns `dentalSeg.worker.ts`.
4. **Delivery of the 123 MB weight.** Decide host/caching (Cache-Storage versioned) — note the repo memory: public-folder binaries dehydrate.
