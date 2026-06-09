# FDI Tooth-Segmentation Model — Briefing for a Second Opinion

## What I'm trying to build
A **browser-size deep-learning model** that does **per-tooth segmentation with FDI
numbering** on dental CBCT (cone-beam CT) scans, running fully client-side in a web
app via `onnxruntime-web`.

- **Segmentation, not boxes:** the model outputs pixel/voxel masks per tooth.
- **FDI numbering = 32 classes:** standard dental notation (11–18, 21–28, 31–38,
  41–48 — quadrant + tooth position). So it must both *find each tooth* and *assign
  the correct tooth number*.
- **Size constraint:** must stay tiny for the browser. I use **YOLOv8n-seg**
  (~6.5 MB PyTorch, ~13 MB ONNX). For comparison, the full 3D nnU-Net models I also
  use are 120–400 MB.
- The model runs on **2D axial/sagittal/coronal slices** of the CBCT volume; masks
  are reassembled into 3D afterward.

## Compute constraints
- Training runs on a **CPU-only VM** (8-core AMD Ryzen, ~23 GB RAM, **no GPU**).
- A heavier 3D nnU-Net model ("ToothSeg") that I use for *labeling* **segfaults on
  this VM's CPU** (crashes in torch's CPU resampling, across torch 2.2 and 2.12) —
  so I cannot run that model on the VM. I have declined to run it on my Mac.

## Data I have
1. **One labeled clinic patient** ("cbct_aug2025") — a CBCT from the scanner I
   actually care about, auto-labeled with FDI masks by the 3D ToothSeg model.
   Sliced into 248 image/label slices (stride 4, 3 axes). **This is my only data
   from my target/clinic domain.**
2. **ToothFairy2** — a public dataset, **480 labeled patients** with FDI ground-truth
   masks (`.mha` files, nnU-Net format), from research CBCT scanners (two cohorts).
   Different scanner/domain than my clinic.
3. **ToothFairy4** — 627 CBCT volumes but **unlabeled** for segmentation.

## What I've tried, and the results (mAP50 = mean average precision @ IoU 0.5)

### Attempt 1 — "base" model (1 patient)
Trained YOLOv8n-seg on the single clinic patient (train + val both from that one
patient). Scored **box mAP50 0.926** — but this is **same-patient memorization**
(val slices are adjacent slices of the training patient), so the number is
meaningless for generalization. 7 of 32 FDI classes had zero training examples.

### Attempt 2 — self-training on unlabeled ToothFairy4
Used the base model to pseudo-label ToothFairy4 slices, mixed them in, retrained.
Tried confidence thresholds 0.5 and 0.7. **Both regressed** vs the base on its own
val (0.834 and 0.852 < 0.926). Pseudo-label noise (wrong tooth numbers) + partial
labels hurt. Abandoned this approach.

### Attempt 3 — ToothFairy2 (480 labeled patients)  ← current state
Trained YOLOv8n-seg on **52 ToothFairy2 patients** (3,545 slices), validated on
**12 held-out patients** (901 slices, 5,227 tooth instances) — a proper
patient-level split.

| Evaluation | Box mAP50 | Recall | Precision | Mask mAP50 |
|---|---|---|---|---|
| **TF2 held-out patients** (honest generalization) | **0.520** | 0.806 | 0.462 | 0.518 |
| TF2 model on **my clinic scan** (cbct_aug2025) | **0.031** | 0.168 | 0.029 | 0.031 |
| Old 1-patient base on clinic scan (reference) | 0.926 | 0.844 | 0.897 | 0.927 |

**Interpretation:**
- The TF2 model **generalizes** — 0.52 mAP50 / **0.81 recall** on unseen patients. It
  reliably *finds* teeth; the weaker precision (0.46) is mostly **FDI numbering
  errors / duplicate detections**, not missed teeth.
- But it scores **~0 on my clinic scan** — a big domain gap.

## The key uncertainty / confound
The clinic-scan test may be **unfair**, for a concrete technical reason:
- The clinic slices were generated with **nibabel** (NIfTI), whose array axis 0 is
  not necessarily the axial (z) plane.
- The ToothFairy2 slices were generated with **SimpleITK**, whose array order is
  always (z, y, x) = axial first.
- So when I evaluate the TF2 model on the clinic "z" slices, the images may be in a
  **different anatomical plane** than the model trained on — which alone can drop a
  cross-eval to near zero.
- On top of that, there is a **genuine domain gap**: different scanner, intensity
  range, field of view, preprocessing.

So I **cannot currently tell** how much of the 0.03 is (a) an orientation/test bug
vs (b) a real scanner domain gap.

## Where both models stand for real clinical use
- **Old base (0.926):** overfit to one patient; would almost certainly **not**
  generalize to *new* clinic patients (I just can't measure it — only 1 labeled
  clinic patient).
- **TF2 model (0.52 held-out):** genuinely generalizes within the TF2 domain, but
  unproven (likely poor) on my clinic scanner as-is.

Neither is yet a trustworthy clinic model.

## The options I'm weighing
1. **Fair re-test:** re-slice the clinic patient with the *same* SimpleITK pipeline
   (matched orientation/normalization), then re-evaluate the TF2 model. ~30 min.
   Tells me how much of the 0.03 is the orientation confound vs a real domain gap.
2. **Domain-adaptation fine-tune:** take the TF2-pretrained model and fine-tune it on
   the clinic patient (or a TF2 + clinic mix) so it both generalizes and fits my
   scanner. ~1–2 hr on CPU.
3. **Scale up TF2 only:** train on more TF2 patients (150+) to push held-out mAP
   higher as a strong general model, ignoring the clinic gap for now.
4. Stop and ship the TF2 model as a general (non-clinic-tuned) model.

## My questions for you (the second-opinion AI)
1. Given a large labeled out-of-domain dataset (ToothFairy2) and only **one** labeled
   in-domain (clinic) patient, what's the best strategy for a model that works on the
   clinic scanner? (Domain adaptation? Aggressive intensity/geometry augmentation to
   close the gap? Test-time normalization? Pretrain-then-finetune?)
2. How should I handle having only **one** labeled clinic patient for
   fine-tuning/validation without overfitting to it again? (I can't make a real clinic
   test set from 1 patient.)
3. Is per-slice 2D YOLOv8-seg the right tool for **FDI numbering** at all, given that
   tooth identity depends on 3D spatial position and adjacent teeth look similar? The
   recall is good (0.81) but precision/numbering is weak (0.46). Would a 2-stage
   approach (detect-tooth → separately number) or a 3D-consistency post-process be
   better?
4. What augmentations or normalization (e.g., HU windowing, percentile norm,
   CLAHE, intensity matching) would best close a CBCT cross-scanner domain gap for a
   small model?
5. Any concerns about the **patient-level split being too small** (12 val patients)
   or the **train cap** (4,500 slices) biasing the 0.52 number?

## Technical specifics (in case they help)
- Model: YOLOv8n-seg, input 512×512×3, ONNX outputs `output0 [1, 68, 5376]`
  (68 = 4 bbox + 32 FDI classes + 32 mask coefficients) and `output1 [1, 32, 128,
  128]` (32 prototype masks). Mask = sigmoid(coeffs · prototypes), crop to box,
  threshold 0.5, upscale.
- Training: pretrained `yolov8n-seg.pt` init, 40 epochs, batch 8, imgsz 512, CPU,
  early-stop patience 12. Slices kept only if they contain ≥1 tooth label
  (min area 80 px). Polygon labels from mask contours, simplify step 4.
- Browser runtime is `onnxruntime-web` (WebGL/WASM), not TensorFlow.js.
