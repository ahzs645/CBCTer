# Browser-Side FDI Model — Ideas Bank

Reusable techniques/leads (mined from the repo, source-repo ports, and research notes)
for getting a client-side (~13 MB ONNX, onnxruntime-web, no-GPU) per-tooth FDI
segmentation model working. Ordered by leverage.

## ⭐ Top idea: decouple detection from numbering
The YOLO model's weakness is **FDI numbering** (precision ~0.46), not finding teeth
(recall ~0.81). We already have a **geometric FDI assignment** in TS:
`src/lib/segmentation/fdiNumbering.ts` → `assignFdiNumbers(teeth, {jaw})` uses PCA of
tooth centroids (left/right + anterior/posterior axes, split at midline, sweep-angle
ordering) to assign FDI 11–48 — ported from ToothGroupNetwork.

**Implication:** train the YOLO model as **single-class "tooth"** (or few-class), which
is easier and had higher recall, then **assign numbers geometrically** as a
deterministic post-process. Sidesteps 32-class confusion entirely. High value, low risk.

## Already-built pipeline (the "annoying part" is done)
The per-slice-mask → 3D-instances → numbered-teeth chain mostly exists:
- `src/lib/segmentation/connectedComponents.ts` — 3D flood-fill labeling (6/26-conn),
  per-component bbox/centroid/voxel count, stack-based (no overflow on big crops).
- `src/lib/segmentation/watershed.ts` — marker-controlled watershed on exact Euclidean
  distance transform; splits touching teeth (`watershedSplit(mask,dims,{coreThreshold:7})`).
- `src/lib/segmentation/maskOperations.ts` — keepLargestComponent, fillHoles,
  splitComponents, regionGrow (cleanup of YOLO masks).
- `src/lib/segmentation/generateLibrary.ts:46-74` — quality thresholds (voxels
  <10k=noise, >140k=merge, extent<18=clipped, off-arch reject) to auto-flag bad instances.
- `src/lib/segmentation/toothInference.ts` + tooth-seg worker — proven onnxruntime-web
  sliding-window harness; the 13 MB YOLO ONNX drops into the same path (predecessor was a
  4.5 MB U-Net). No-GPU CPU/WASM/WebGL, runs in a Web Worker.

**Missing piece = a YOLOv8-seg mask decoder** (output0 [1,68,5376], output1 [1,32,128,128];
sigmoid(coeffs·protos), crop-to-box, threshold, upscale) feeding into the above.

## Cross-scanner domain gap (in flight)
- **Fixed CT-window normalization** (nnU-Net CTNormalization): `--ct-window -113.8 4021`
  in `scripts/export_toothfairy2_mha_yolo_slices.py`. The principled fix — same fixed
  window for train + inference instead of per-slice percentile. This is why ToothSeg
  (nnU-Net on ToothFairy2) generalizes to the clinic and our old YOLO didn't.
- **Histogram matching** (`--histmatch-ref`): match each volume to a reference
  distribution before slicing. Cheap intensity domain adapter.
- **Domain-adaptation fine-tune**: pretrain on TF2 (CTNorm), fine-tune on clinic + a TF2
  sample (frozen backbone optional) — but only 1 labeled clinic patient, so guard overfit.

## Robustness / validators (ensemble gating)
- **DentalSegmentator** (already in browser, 123 MB) — coarse upper/lower teeth + mandible/
  canal masks. Use as a **spatial gate**: reject tooth detections outside its tooth region.
- **UNetTransplant** (binary tooth mask, CPU) / **RAIL** (coarse tooth regions) — optional
  second-opinion validators when YOLO confidence is low. See `docs/non-nvidia-tooth-extraction-plan.md`.

## Missing third molars (18/28/38/48)
- `scripts/generate_third_molar_recovery_candidates.py` + `docs/non-nvidia-tooth-extraction-plan.md:199-250`:
  from 2nd-molar centroid, project posteriorly along arch, run watershed in that ROI,
  score candidates by volume/enamel-HU/proximity, present for review. Addresses the
  zero-training-data wisdom-tooth classes.

## Self-training revisit (lower priority)
- `docs/browser-yolo-seg-prototype.md:92-172` — ToothFairy4 (627 unlabeled) pseudo-labels.
  Earlier attempts regressed; revisit only with per-scanner confidence thresholding and
  the decoupled (single-class) detector, where pseudo-label noise hurts less.

## Research-landscape survey (alternative architectures)
SOTA on ToothFairy2/3 = heavy 3D CNNs, GPU/server only (NOT browser):
- ToothFairy2 winner: nnU-Net ResEnc-L (Dice 0.925). ToothFairy3: MONAI Auto3DSeg +
  3D SegResNet (<8GB GPU). Confirms ToothSeg (our nnU-Net) IS the SOTA tier / ceiling.
- KEY external validation: ToothFairy2 challenge paper says "tooth delineation is easier
  than correct FDI numbering, left/right confusions a key failure mode" — exactly our
  result. Backs the decouple-numbering plan (even SOTA struggles with FDI labels).

Browser-viable architecture options (in rough order of interest):
1. **Knowledge distillation** — distill heavy ToothSeg teacher → tiny student
   (depthwise-separable / bottleneck-residual U-Net). More principled than self-training;
   the best "new architecture" lever. (openreview MeuvPHcFK7 lightweight nnU-Net KD.)
2. **Interactive SAM on-device** — MobileSAM / EdgeSAM / LiteMedSAM, prompt-driven
   (click tooth → mask), runs in-browser via WebGPU (MS demoed SAM in onnxruntime-web).
   3DTeethSAM shows SAM2 works for teeth. Semi-automatic UX fallback.
3. **WebGPU raises the ceiling** — onnxruntime-web 1.17+ runs much larger models than old
   WASM; a distilled **small 3D U-Net** (real 3D context → better numbering, fewer
   per-slice artifacts) is now feasible in-browser. Not locked to a 13MB 2D CNN.

## More data + harmonization (web survey round 2)
- **Multi-scanner labeled CBCT datasets** (train diversity = generalization fix):
  Cui et al. CBCT-Tooth dataset (15 centers, China; ieee-dataport), CTooth (5803 slices /
  4243 annotated; github liangjiubujiu/CTooth, request access), MMDental (2025, figshare,
  multimodal). Combine with ToothFairy2 (all CT-normalized) for scanner robustness.
- **Harmonization**: 2025 review (PMC12839842) — HU-preserving norm + **ComBat** + kernel
  matching cut cross-scanner degradation to <8%. ComBat = concrete off-the-shelf add-on to
  our fixed CT-window. Deep options: CVH-CT, DeepHarmony (heavier, style transfer).
- **Ready open FDI models** (alt teachers/validators besides ToothSeg): **OralSeg**
  (tooth-level instance seg + full FDI, one-click 3D Slicer, free non-commercial);
  SlicerCBCTToothSegmentation (Kitware, pretrained); open model PMC12464119.
- **Panoramic FDI numbering route**: FDI numbering is well-solved in 2D panoramic/bitewing
  (YOLO+heuristic / Mask R-CNN). We HAVE `src/lib/panoramic/reformatPanorama.ts` — reformat
  CBCT to panoramic, number teeth in that 2D space, map back to 3D. Third numbering option.

## Cross-domain transfers (non-CT fields solving our exact patterns)
- **Vertebrae labeling (spine CT)** = same as FDI numbering (ordered anatomical ID). Lesson:
  DON'T classify instances independently — enforce SEQUENCE consistency. Techniques to steal:
  Graph Neural Networks (node+edge prediction, arXiv 2308.02509) modeling teeth as graph with
  arch-adjacency edges; statistical/graphical priors; SpineCLUE (contrastive + uncertainty).
  This is the principled upgrade to geometric `fdiNumbering.ts` and the real cure for
  left/right FDI confusion. (VerSe SOTA ID only ~87% -> consistency layer matters most.)
- **Cell seg (Cellpose/StarDist/CellStitch)** = our 2D-slice -> 3D-instance assembly. Cellpose
  stitches 2D masks across slices when IoU>thresh; CellStitch uses optimal transport + the
  OTHER planes (xz/yz) to guide — and WE ALREADY slice z/y/x, so multi-plane consensus is free.
  Complements watershed; ensemble (watershed + IoU-stitch + multi-plane) is the robust play.
- **Scene text (detect->recognize)** validates decoupling detection from numbering; caveat =
  error accumulation (detector miss propagates) -> argues for the consistency/graph layer.
- **Transformers.js** (HuggingFace) runs instance/panoptic seg in-browser on onnxruntime-web
  (WASM/WebGPU) — higher-level deploy framework than hand-rolling; SAM2-in-browser examples.

## Back-pocket research
- **INSID3 / DINOv3** (training-free one-shot in-context segmentation, CVPR 2026, GPU-only):
  not a browser model, but a possible **server-side labeler** — propagate one annotated
  tooth mask across slices/patients to grow labeled data cheaply.
- **ToothGroupNetwork** (`external/ToothGroupNetwork-*`, variant A ships .h5 weights) —
  source of the FDI numbering algorithm; point-cloud method, not browser-deployable, but
  the numbering heuristic is already ported to `fdiNumbering.ts`.
