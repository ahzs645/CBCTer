# In-Browser YOLO Tooth Pipeline — How It Works

End-to-end flow of the "Detect all teeth (YOLO · whole volume)" feature. Everything
runs client-side; no server, no GPU required, no 3D convolutions.

## Flow at a glance

```
/teeth (Library tab)
  └─ BrowserLibraryGenerator  → button "Detect all teeth (YOLO · whole volume)"
       └─ useSegmentation.generateYolo(volume, coreThreshold, conf)
            └─ generateLibraryYolo(volume, …)                       [generateLibrary.ts]
                 ├─ segmentToothVolumeYolo(volume)                  [segmentToothVolumeYolo.ts]
                 │    └─ toothSegYolo.worker.ts  (Web Worker, ORT)
                 │         resample 0.3mm → per axial slice:
                 │           letterbox 512 + CT-window → session.run → decode → un-letterbox
                 │         → 3D tooth mask  (ToothSegmentationResult)
                 └─ buildLibraryFromSegmentation(volume, segmentation)
                      watershedSplit → components → quality → mesh+preview → assignFdiNumbers
                      → SegmentationManifest  → rendered in the arch viewer
```

## Step by step

### 1. Trigger — UI (`src/components/BrowserLibraryGenerator.tsx`)
The Library tab's ghost button calls `seg.generateYolo(volume, separation)`. Unlike
the UNet "Generate" button it **ignores the ROI box** — it scans the whole volume.
`separation` is the watershed `coreThreshold`.

### 2. Hook (`src/lib/segmentation/useSegmentation.ts`)
`generateYolo` → `runGenerated(() => generateLibraryYolo(...))`. `runGenerated` is the
shared finalizer (sets the manifest, tracks blob URLs, surfaces errors/progress) used
by both the UNet and YOLO paths.

### 3. Driver (`src/lib/segmentation/segmentToothVolumeYolo.ts`)
Copies the volume's `Int16` voxels (`[D,H,W]`, transferable) + dims + spacing and posts
them to the worker. Resolves to a **`ToothSegmentationResult`** — the *same shape* the
UNet path returns (`{mask, dims, origin:[0,0,0], spacing:[0.3,0.3,0.3], voxelCount}`),
which is what lets the rest of the pipeline be shared.

### 4. Worker (`src/workers/toothSegYolo.worker.ts`) — the inference core
1. **Resample** the whole volume to **0.3 mm isotropic** (`resampleVolume`, trilinear) →
   matches training scale so teeth have a consistent pixel size across scanners.
2. **Per axial slice** (first/depth axis = superior–inferior):
   - **Letterbox** the `[H,W]` slice into 512×512 preserving aspect (pad with 0).
   - **CT-window normalize**: `clip(v, -113.8, 4021)` → `[0,1]` (nnU-Net-style fixed
     window; the one preprocessing choice that made it cross-scanner-robust).
   - Build `[1,3,512,512]` tensor (grayscale replicated to RGB), `session.run`.
   - **Decode** outputs (`yoloSegDecode.ts`, see below) → union tooth mask at 512.
   - **Un-letterbox** the 512 mask back to `[H,W]`, OR into the 3D volume at `z`.
3. Returns the assembled `Uint8` 3D mask `[oD,oH,oW]` + voxel count. ORT session uses
   wasm-threads (or WebGPU fallback); model served from `public/models/tooth-yolov8n-seg.onnx`.

### 5. Mask decoder (`src/lib/segmentation/yoloSegDecode.ts`) — unit-tested, pure TS
Single-class YOLOv8-seg outputs:
- `output0` `[1, 37, N]` = 4 bbox + 1 score + **32 mask coefficients** (channel-major)
- `output1` `[1, 32, ph, pw]` = 32 mask prototypes

`decodeDetections` thresholds by `conf` and runs single-class **NMS**. `buildUnionMask`
computes each kept detection's mask = `sigmoid(Σ_k coeff_k · proto_k)`, evaluated only
inside the box (crop-to-box), thresholded at 0.5, unioned → one binary tooth mask/slice.

### 6. 3D assembly + numbering (`buildLibraryFromSegmentation` in `generateLibrary.ts`)
Shared with the UNet path:
- **`watershedSplit(mask, dims, {coreThreshold})`** (`watershed.ts`) — marker-controlled
  watershed on the Euclidean distance transform splits touching teeth that plain
  connected-components merge into arch-blobs.
- Filter components by voxel count → per-tooth submasks.
- **`maskToBinaryStl`** (`maskMesh.ts`) + `maskProjectionDataUrl` → STL mesh + thumbnail
  per tooth; `quality()` flags accepted/review.
- **`assignFdiToItems`** (`toothFdi.ts` → `fdiNumbering.ts`) — PCA of tooth centroids →
  left/right + anterior/posterior axes → split into quadrants → arch sweep-angle order →
  FDI 11–48. (Gap-aware arch template; **the network never predicts numbers**.)
- Emits a `SegmentationManifest` rendered by the existing arch viewer / library UI.

## Why this shape
The detector does only what it generalizes at (find teeth per slice, high recall). The
hard, scanner-fragile parts — instance separation and numbering — are deterministic 3D
geometry that already existed in the repo (`watershed.ts`, `fdiNumbering.ts`) and run in
plain JS. This sidesteps WebGPU's lack of conv3d entirely. See `fdi-model-scorecard.md`
for results and `browser-fdi-ideas.md` for the design rationale.
