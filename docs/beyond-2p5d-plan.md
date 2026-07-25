# Beyond 2.5D — Plan for the Next Round of Tooth Segmentation Work

_Drafted: 2026-07-25. Companion to `fdi-model-scorecard.md` (results),
`yolo-pipeline.md` (how the shipping path works), and `browser-fdi-ideas.md`
(idea bank). This doc is the sequenced, gated version of that idea bank._

## Where we actually are

The 2.5D change (commit `19d8bc9`) maps `z-2, z, z+2` onto the RGB channels of
YOLOv8n-seg. Zero extra FLOPs, unchanged ONNX I/O, and `MODEL_CONFIG` in
`src/workers/toothSegYolo.worker.ts:22` lets `legacy` and `2p5d` ship side by
side. Good instinct, cheap to carry.

Two problems with it as it stands:

1. **The context window is nearly zero.** At `TARGET_SPACING = 0.3` and
   `CONTEXT_SLICES = 2`, the three channels span **1.2 mm**. A molar crown is
   ~8 mm tall, roots 12–15 mm. The channels are near-duplicate anatomy, so they
   carry very little independent information — the network mostly learns a
   denoiser.
2. **It doesn't target the bottleneck.** `fdi-model-scorecard.md` says clinic
   per-slice detection is recall 0.82 / precision 0.48, while 3D assembly
   already recovers 17/17 GT teeth. The pain is (a) instance separation of
   touching teeth and (b) FDI numbering. Channel stacking addresses neither
   directly. The one real win is that z-consistent masks stabilise the new
   seed tracking in `toothSegYolo.worker.ts:194` (`chooseTrack`).

There is also no measurement yet showing whether `2p5d` beats `legacy`. Fixing
that is Phase 0, because two latent bugs below could make 2.5D score *worse*
than the single-slice baseline for reasons that have nothing to do with the
method.

---

## Phase 0 — Stop flying blind (do this first, ~half a day)

### 0.1 Fix the HSV augmentation trap (highest-value single line in this doc)

`make_toothseg_multi_teacher_notebook.py:325` calls `model.train(...)` without
overriding Ultralytics' colour augmentation defaults: `hsv_h=0.015`,
`hsv_s=0.7`, `hsv_v=0.4`.

For the **legacy** model this was harmless. Grayscale replicated to RGB means
`R=G=B`, so saturation is 0; `hsv_s` and `hsv_h` are mathematically no-ops and
only `hsv_v` (brightness jitter) applied.

For the **2.5D** model the three channels are *different anatomical slices*, so
saturation is non-zero and `hsv_s=0.7` becomes an aggressive, non-uniform
perturbation of the inter-channel relationship — precisely the depth signal
2.5D exists to provide. Switching to 2.5D silently switched on an augmentation
that corrupts the new input semantics.

**Action:** pass `hsv_h=0.0, hsv_s=0.0, hsv_v=0.4` in the train call whenever
`CONTEXT_SLICES > 0`. Keep `fliplr=0.5` (arches are near-symmetric and numbering
is geometric anyway) and keep mosaic (purely spatial).

This alone may be the difference between "2.5D does nothing" and "2.5D helps."

### 0.2 Guard the per-channel normalization trap

`export_toothseg_yolo_slices.py:125` calls `normalize()` **once per channel**.
With `--ct-window` set (what the notebook does) each channel gets the same fixed
window — correct. With `ct_window=None` the function falls back to *per-slice
percentiles* (`export_toothseg_yolo_slices.py:87`), so each channel gets its own
window and the depth relationship is destroyed.

**Action:** raise in `image_context()` if `context_slices > 0 and ct_window is
None`. Same guard in `export_toothfairy2_mha_yolo_slices.py`.

### 0.3 Kill the silent train/inference coupling

`CONTEXT_SLICES = 2` and `TARGET_SPACING = 0.3` live in the notebook;
`toothSegYolo.worker.ts:28` hardcodes the matching `contextSlices: 2`. Retrain
at a different offset without editing the worker and you get a quietly degraded
model and no error anywhere.

**Action:** write `contextSlices` / `targetSpacing` / `ctWindow` into the ONNX
`metadata_props` at export time, read them in `getSession()`, and use them to
drive `preprocessSlices`. Fail loudly on missing metadata for non-legacy
variants. This turns every future context experiment into a drop-in `.onnx`
swap with no TS edit — which is what makes Phase 1 cheap.

### 0.4 Declare the scoreboard

`compare_tooth_yolo_onnx_colab.py` already takes repeated `--model name=path`
and emits everything needed. Freeze the promotion gate now, before running
experiments, so results can't be rationalised after the fact:

| Metric (from `evaluate_mask`) | Role |
|---|---|
| `instanceRecall` | **primary** — did we find each GT tooth |
| `falsePositiveInstances` + `duplicateInstances` | **primary** — the precision 0.48 problem |
| `mergedComponents` | **primary** — the separation problem |
| `voxelDice` | secondary — boundary quality |
| wall-clock in browser | budget, not a gate |

Run it across the held-out eval cases (`USE_HELDOUT`, `SPLIT_SEED = 20260615`)
with `--separation-mode both`, comparing `legacy=` vs `2p5d=` in one invocation.
**Promotion rule:** a candidate ships only if it improves a primary metric
without regressing another primary metric, on ≥2 held-out cases.

Everything after this phase is measured against that harness.

---

## Phase 1 — Make 2.5D actually 2.5D (1–2 days)

### 1.1 Context sweep

Re-export and retrain at `--context-slices` ∈ {2, 5, 10, 16} (±0.6 / 1.5 / 3.0 /
4.8 mm). Pure config sweep on infrastructure that already exists. My prediction:
±3 mm clearly beats ±0.6 mm, with a turnover somewhere past that as the outer
channels stop being about the same tooth.

Also try a **non-uniform triplet** (`z-8, z, z+8` vs `z-2, z, z+2`), and a
multi-scale variant (`z-8, z, z+2`) — cheap to test, and gives the network both
fine and coarse depth cues from three channels.

Requires a small generalisation of `image_context()` to accept an explicit
offset list rather than a single symmetric `context_slices` int.

### 1.2 Break the 3-channel ceiling

Three channels is a constraint inherited from the ImageNet RGB stem, not from
the problem. Ultralytics accepts `ch=` in the model YAML; inflate the first
conv by mean-replicating pretrained weights and go to 5–9 slices (e.g. ±4 mm
sampled at 5 depths). The first conv is a rounding error in the FLOP budget.

Browser cost is one line: build `[1,C,512,512]` instead of `[1,3,512,512]` in
`preprocessSlices` — and with 0.3 done, `C` comes from ONNX metadata, so the
worker needs no per-variant edit at all.

**This is the real 2.5D method.** What ships today is its degenerate case.

**Gate:** if the best of 1.1/1.2 doesn't clear Phase 0's promotion rule, keep
`legacy` as default, park 2.5D, and go straight to Phase 2 — that would be a
genuinely useful negative result, not a failure.

---

## Phase 2 — Tri-planar consensus (3–5 days, best win with the current model)

The single highest-leverage change that needs **no new architecture**.

`export_toothseg_yolo_slices.py:179` already supports `--axes z y x`, and
`image_context()` builds context along the *same* axis as the slice — so
tri-planar training is already wired. The notebook just pins `TRAIN_AXES = ['z']`
(`make_toothseg_multi_teacher_notebook.py:84`).

1. Train one plane-agnostic model on all three axes (more data, and the model
   stops overfitting to axial-specific appearance).
2. At inference run axial + coronal + sagittal, accumulate three 3D masks, fuse
   by **2-of-3 vote**.

Why it targets the right thing: a spurious detection in one axial slice is
rarely echoed in the sagittal view of the same voxel, so voting attacks
`falsePositiveInstances` and the 0.48 precision number directly. It also gives
genuine 3D consistency without a single 3D convolution. This is the CellStitch
lesson from `browser-fdi-ideas.md:103` and it is underrated there.

**Cost:** ~3× inference (~25 s → ~75 s). Mitigations: run non-axial planes at
half resolution as a veto-only pass, or expose it as an opt-in "high quality"
toggle in `BrowserLibraryGenerator` alongside the existing button.

**Implementation notes:** `segmentToothVolumeYolo.ts` gains an `axes` option;
the worker loops planes and accumulates a vote count per voxel instead of
writing `mask3d[...] = 1`. Seed tracking (`chooseTrack`) stays axial-only —
tracking across three planes at once is a separate problem, don't mix it in.

---

## Phase 3 — Attack separation directly (1 week, this is the real bottleneck)

Everything above improves the *mask*. `mergedComponents` and
`duplicateInstances` come from the *split*, and that is where the clinic
failures actually live.

1. **Tune what exists, properly.** `watershedSplit` (`coreThreshold`),
   `DEFAULT_MIN_TOOTH_VOXELS = 8000` (`generateLibrary.ts:26`), and the
   `yolo-seeds` / `yolo-seeds+peaks` modes in the compare script are all
   hand-set. Grid-search them against `instanceRecall` /
   `falsePositiveInstances` on the held-out cases. Cheap, and it establishes how
   much headroom is left in post-processing before investing in a model.
2. **Improve the seeds, not the splitter.** The tracker in
   `toothSegYolo.worker.ts:194` uses greedy sparse-intersection matching with
   `MAX_TRACK_GAP = 2` and `MIN_TRACK_OVERLAP = 0.12`. Two upgrades: Hungarian
   assignment instead of greedy best-first (currently a high-confidence seed can
   steal a track that fits a later seed better), and centroid-motion
   continuity so a track survives a gap without stealing a neighbouring tooth.
   Better seeds feed `watershedSplit`'s `markerLabels` and improve separation
   with no retraining.
3. **Boundary-aware masks.** YOLOv8-seg's 32 prototypes at 128×128 upscaled to
   512 are inherently blobby at cervical margins; on a 0.3 mm grid the
   *prototype resolution*, not slice context, is the boundary-precision limiter.
   Option: YOLO for boxes + a small 2D U-Net for the mask inside each box. This
   sharpens exactly the interproximal contacts that watershed then has to split.

---

## Phase 4 — A small 3D refiner (2–3 weeks, the principled fix)

`fdi-model-scorecard.md:12` says "no conv3d". That is a **WebGPU-EP**
limitation, not a wasm one — `src/workers/amasssSkin.worker.ts:68` and
`src/workers/dentalSeg.worker.ts:87` already push `[1, 1, d, h, w]` 5D tensors
through onnxruntime-web today, and we ship a 123 MB DentalSegmentator. We have
more headroom than the docs claim.

**Shape:** coarse-to-fine, not whole-volume 3D.

1. Existing 2D/2.5D pass localises the arch and proposes per-tooth ROIs (we
   already compute component bboxes in `buildLibraryFromSegmentation`).
2. A distilled 2–5 M-param 3D U-Net runs on 64³–96³ patches per candidate tooth
   at 0.6 mm, outputting a clean single-instance mask.

This is the one option that fixes separation *at the model level* instead of
tuning a watershed, and the harness is proven — `toothInference.ts`'s
sliding-window path plus `tooth-unet-96.onnx` (4.7 MB) is the template. Teacher
for distillation is ToothSeg, which we already run offline.

Only start this once Phase 3.1 has shown post-processing is genuinely tapped
out.

---

## Phase 5 — Numbering consistency (parallel track, independent of the above)

`fdiNumbering.ts` numbers teeth from PCA + arch sweep angle and got 25/25 right
on the clinic scan, but it treats each tooth semi-independently and the known
failure mode across the whole field is left/right confusion and gap handling.

Two options, both already scouted in `browser-fdi-ideas.md`:

1. **Sequence-consistency layer** — the vertebrae-labelling lesson
   (`browser-fdi-ideas.md:97`): don't assign labels independently, enforce a
   globally consistent ordering along the arch. A small graph/dynamic-programming
   pass over candidate assignments is pure TS, no model, and directly attacks
   the field's #1 failure mode.
2. **Panoramic route** — we already have `src/lib/panoramic/reformatPanorama.ts`.
   FDI numbering is well-solved in 2D panoramic space; number there and map
   back. Good cross-check even if it doesn't become primary.

Cheap and decoupled — worth running alongside Phase 2/3 rather than after.

---

## What I would *not* do

- **Whole-volume 3D U-Net in the browser.** Memory and wall-clock make it a
  non-starter versus the ROI-refiner shape in Phase 4.
- **Return to 32-class FDI detection.** The scorecard settled this: clinic mAP
  0.012 vs 0.491. Numbering stays geometric.
- **Self-training on ToothFairy4 pseudo-labels**, until Phase 0's harness can
  actually detect a regression. `browser-yolo-seg-prototype.md:92` records that
  earlier attempts regressed; don't repeat that blind.
- **Chase mAP50.** Per-slice box mAP is a proxy. `instanceRecall` /
  `falsePositiveInstances` after 3D assembly is what the user sees.

## Suggested order

```
Phase 0  (0.5 d)  ─ measurement + the two augmentation/normalization bugs
   │
   ├─ Phase 1  (1-2 d)   context sweep + N-channel      ┐ cheap, settles 2.5D
   ├─ Phase 5  (2-3 d)   numbering consistency          ┘ parallel, independent
   │
Phase 2  (3-5 d)  ─ tri-planar consensus        ← best win / effort
   │
Phase 3  (1 w)    ─ separation: tune, seeds, boundary masks
   │
Phase 4  (2-3 w)  ─ 3D ROI refiner              ← only if Phase 3 taps out
```

If only one thing gets done: **Phase 0.1** (the HSV fix) plus **Phase 0.4** (the
scoreboard). Without them every later result is uninterpretable.
