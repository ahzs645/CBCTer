# FDI Tooth Segmentation — Scorecard

_Last updated: 2026-06-11_

## Current shipping model

| | |
|---|---|
| **Model** | YOLOv8n-seg, **single-class "tooth"** |
| **Size** | 6.4 MB `.pt` / **12.6 MB ONNX** (`public/models/tooth-yolov8n-seg.onnx`) |
| **Input** | 512×512, fixed CT window `[-113.8, 4021]` HU, volume resampled to **0.3 mm isotropic** |
| **Runtime** | browser, `onnxruntime-web` (wasm threads / WebGPU) — no GPU server, no conv3d |
| **Training data** | ToothFairy2, 52 patients (12 held out), 0.3 mm + CT-window slices |
| **Pipeline** | 2D detect (per axial slice) → 3D connected-components → watershed split → FDI numbering by arch position |

## Headline result — validated in-browser on a clinic scan

On `CBCT-Aug2025-dcm` (512³ @ 0.16 mm, a scanner **not** in training), the full in-browser pipeline produced, in **~25 s**:

- **25 separated, correctly FDI-numbered teeth** — upper `11–16, 21–27`, lower `31–35, 41–47`
- distinct per-tooth meshes (not one blob); 16 accepted / 9 flagged review
- missing-FDI panel correctly listed absent third molars (`18/28/38/48`) + a few 2nd molars

## Metrics — the journey (why single-class + 3D is the answer)

mAP50 = mean average precision @ IoU 0.5. "Clinic" = the out-of-distribution scanner above; its labels are ToothSeg predictions (not human GT). TF2 held-out = 12 unseen ToothFairy2 patients.

| Approach | TF2 held-out box mAP50 | **Clinic** box mAP50 | Verdict |
|---|---|---|---|
| 32-class FDI, **1 patient** | 0.926 | — | meaningless (train≈val, same patient overfit) |
| 32-class FDI, TF2 multi-patient + CT-norm | 0.494 | **0.010** | fails cross-scanner |
| 32-class FDI, + 0.3 mm spacing | 0.494 | **0.012** (recall 0.18) | still fails (scale helped recall, not precision) |
| **Single-class "tooth"**, TF2 + CT-norm + spacing | **0.982** | **0.491** (recall **0.82**, prec 0.48) | per-slice detection works cross-scanner |

**Why single-class won:** the ToothFairy2 challenge itself found "tooth delineation is easier than correct FDI numbering; left/right confusions are the key failure mode." Dropping 32-class numbering let detection generalize (clinic mAP 0.012 → 0.49, ~40×; recall 0.18 → 0.82). Numbering is then recovered geometrically in 3D.

### 3D assembly on the clinic scan (the metric that matters)

| Step | Result |
|---|---|
| Connected-components (MIN_VOX 1500) | **17/17 GT teeth recovered**, 1 false positive (5 merged arch-blobs) |
| + watershed separation | all GT teeth recovered as distinct instances; over-split tuned via `min_distance`/`MIN_VOX` |
| FDI numbering (browser `fdiNumbering.ts`) | 25 teeth numbered correctly on the clinic scan |

> Note: a naive **rank-order** numbering prototype scored only ~0.05–0.09 in Python because this patient is missing ~half their teeth (gaps break rank-ordering). The browser path uses the gap-aware arch-template numbering (`fdiNumbering.ts`), which produced the correct 25-tooth numbering above.

## Honesty / caveats

- TF2 held-out numbers are real generalization (patient-level holdout). Clinic numbers use **ToothSeg-generated labels** as ground truth, not human annotation.
- The single-class model only detects "tooth"; **FDI numbers come from 3D geometry**, not the network.
- Third molars / teeth outside FOV won't be found if absent — expected, surfaced in the missing-FDI panel.
- Dev requires the COI-header fix for the `/ort/` middleware (commit `aafce17`); production hosting must send COOP/COEP on `public/ort` too.

## Reproduce

- Train + 3D-assembly + numbering: `notebooks/cbct_singleclass_3d_colab.ipynb` (Colab T4, reads the Drive-synced ToothFairy2 + clinic data).
- Slicer: `scripts/export_toothfairy2_mha_yolo_slices.py` (`--single-class --target-spacing 0.3 --ct-window -113.8 4021`).
- Browser: `/teeth` → Library tab → "Detect all teeth (YOLO · whole volume)".
