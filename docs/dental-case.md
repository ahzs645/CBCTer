# Dental case workflows and exports

CBCTer offers **Scan only** and **Scan + analysis** in the package export dialog. The second option writes a complete `.cbct.zip` case with the full native scan and its optional analysis. Both desktop and mobile layouts expose these options. Scan-only exports retain the classic-resolution options and streamable format; complete cases require the streamable full scan plus preview.

## Dentist workflow

1. Open a scan or case. Streaming opens the preview, then native slice planes, with scan/auto/bone/teeth/soft-tissue/metal contrast presets. Imported tooth outlines can be viewed and selected without loading every mask voxel.
2. Open advanced tools to edit. **Review teeth** is available above the slices on desktop and phones. Select an instance in the list, tooth chart (after FDI assignment), or a labelled slice. Slice picking keeps the crosshair at the clicked point; chart/list selection moves it to the instance centroid.
3. Obtain outlines with a configured anatomy model, separate an existing anatomy region/binary mask with watershed, or **Draw a new tooth outline** manually. Full and pediatric models produce anatomy regions. Universal also supplies per-tooth labels; all proposed identities need review. Watershed produces unassigned instances, not inferred FDI numbers.
4. Assign FDI, accept/reject, brush/erase, split at the current sagittal/coronal/axial crosshair plane, or merge another instance into the selected one. Both sides of a split must contain voxels. A split creates a new stable ID; a merge retains the selected ID and records its parents. Undo/redo restores the mask and associated instance metadata. Renumbering changes metadata, never label voxel values. Duplicate manual FDI assignments are rejected.
5. Use **Show selected tooth**, **Hide teeth**, and **Show surrounding bone**. These filter slice overlays and the 3D texture. The original scan remains available for measurements. A selected surface is highlighted if it has been generated; **Regenerate tooth 3D surface** derives it from the mask.
6. Open Panoramic. Arch control points, reconstruction settings, section width and section angle survive route changes and case export. Tooth-centred sections use the nearest arch normal in physical millimetres, with anisotropic spacing preserved. The arch editor has a usable phone canvas and touch handles.
7. **Save case locally** keeps study state, binary masks, labelmaps, original predictions and surfaces in IndexedDB. **Scan + analysis** downloads the portable case. Local/project restoration checks native scan identity, geometry, displayed scan hash and grid transform. An old standalone project without a fingerprint is refused rather than attached by dimensions alone.

## ZIP layout and compatibility

```text
case.cbct.zip
├── cbct-scan.json                  version 2 native scan manifest
├── chunks/*.zst                    unchanged native scan words
├── preview.i16                     calibrated preview
├── analysis/manifest.json          analysis version 1
├── analysis/layer-N/*.zst          masks, anatomy, teeth, predictions
├── meshes/N.stl                    optional physical-mm surfaces
└── study.json                      notes, measurements, chart, arch, review state
```

The scan manifest advertises `extensions.analysis`. Version-2 readers that ignore that extension still open the scan. Existing classic version-1 scan packages remain supported. Standalone `.cbcter.zip` projects continue to exclude the CT; new ones include scan binding and original predictions. Their optional extra fields are backward compatible with existing project parsers.

Analysis uses canonical native XYZ geometry, X-fastest little-endian uint16 labels, background zero, canonical 64³ edge-aware chunks and the same reversible row-X delta/byte shuffle + Zstd codec as the scan. Binary masks are stored as 0/1 labels and validated before conversion back to Uint8. Each layer records role, ID, original prediction reference and optional model ID. File paths use indices rather than user names or IDs.

Every compressed block has a SHA-256 of its uncompressed words. `hashKind: ordered-chunk-sha256` explicitly identifies the layer root: SHA-256 of the JSON array of ordered raw block hashes. Study and STL bytes have separate hashes. Chunk coverage, checksums, source transforms, instance dictionaries and bounds are checked on import. Scan and analysis readers share one bounded LRU; per-plane label buffers only retain the current planes. Full workspace buffers are transferred from the worker rather than copied.

## Alignment and provenance

A case binds to the native word hash and a canonical geometry hash (dimensions, spacing, origin, direction, coordinate system). The analysis manifest also stores the original displayed grid and its displayed-voxel-to-native-voxel affine. Crop/scaling is mapped onto the native grid with nearest label sampling; unsupported shear/rotation is rejected. Measurements, annotations, bookmarks, tooth bounds/centroids and arch coordinates are mapped too. STL vertices use physical millimetres and receive the crop-origin translation.

Original predictions are immutable separate layers; edited labelmaps and current review status are separate. Saved case views include the native-grid cursor, slice axis, zoom, contrast and inversion. Model records contain actual weight SHA-256, model file/variant, known version (or null), preprocessing/resampling/normalization and creation time. Confidence is included only if actually supplied; current argmax outputs do not supply tooth confidence. Revision records store actions, affected stable IDs and split/merge ancestry. Intermediate undo buffers are session-local, not a complete per-revision voxel archive.

The geometric FDI utility now accepts an explicit `archOrigin`, also exposed by its tooth-library adapter. A partial/unilateral arch needs a known midline to determine quadrants. Without it the existing PCA fallback remains a heuristic. The missing-tooth test specifies that known origin and also verifies translated coordinates.

## Validation and practical limits

The implementation passed 164 unit tests, 18 browser tests across the case/streaming/dental/smoke suites, and two separately enabled native vendor case tests. Seven case/smoke browser tests were rerun after the final UI fixes with unchanged screenshot expectations. Lint and the production build passed. Two real-inference browser tests skipped because their authorized scan/model inputs were absent; four opt-in unit tests skip in the default run, including the two vendor case tests run separately.

| Vendor case alignment check | Native grid | Analysis source grid | Native offset | Result |
| --- | --- | --- | --- | --- |
| OneVolume | 341 × 341 × 344 | 340 × 340 × 340 | 0, 0, 1 | Raw scan hash unchanged; both sparse mask points aligned |
| Sidexis | 512 × 512 × 512 | 512 × 512 × 512 | 0, 0, 0 | Raw scan hash unchanged; both sparse mask points aligned |

- Unit tests cover complete archive round trips, cropped alignment of mask/measurements/bookmarks/STL, native word integrity, corrupt analysis, wrong scans with identical dimensions, split/merge ID behavior, original predictions, local labelmaps, physical cross-sections and real texture isolation.
- Browser cases use a labelled **synthetic fixture**, not claimed model inference. Desktop and touch-enabled phone tests exercise review, correction, split/merge/undo, watershed separation, manual drawing, surface generation, actual IndexedDB saves/restores, complete ZIP exports/reopens, and arch persistence. Native streaming regressions use the separately authorized vendor examples.
- Authorized vendor case tests additionally write/read a sparse alignment mask on OneVolume's original 340³ display grid and Sidexis's 512³ grid. Native dimensions and raw hashes remain unchanged. These test masks are alignment probes, not clinical segmentations. Inputs and generated case data stay outside the repository.
- The full/pediatric/universal ONNX weights and staged anatomy test scan are absent from this workspace. Real-inference tests explicitly skip unless their inputs are staged. Missing weights produce a clear UI error. Do not infer clinical segmentation accuracy from fixture or alignment tests.
- Streamed scan/analysis decoding shares 32 MiB on phones, 64 MiB on desktop. Full editing and inference still require dense arrays. The worker rejects full loading above an estimated 512 MiB phone / 2 GiB desktop editing budget before allocation; streaming stays available. Watershed crops to foreground and limits its ROI to 4 million phone / 12 million desktop voxels. These are guardrails, not measured hardware guarantees; real Safari/iOS/Android memory and model performance still need device validation.
- Opening advanced tools is a one-way transition to the native editing grid. A full version-2 session does not offer a half-resolution switch that could discard or misplace ongoing edits.

Reproduce:

```sh
npm test
npm run lint
npm run build
CBCTER_VALIDATION_OUT=/path/to/authorized/native/packages npx vitest run src/lib/case/nativeCase.test.ts
CBCTER_VALIDATION_OUT=/path/to/authorized/native/packages npx playwright test tests/e2e/dental-case.spec.ts tests/e2e/chunked-viewer.spec.ts tests/e2e/dental-viewer.spec.ts --workers=2
```
