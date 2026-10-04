# Native fidelity and streaming validation

The implementation keeps classic package export as the compatibility default
and adds version 2 as an opt-in streamable format. Zstd level 3 with a modular
X-row predictor and byte shuffle is the first shipping codec: it has a
working browser WASM decoder, independently addressable 64³ blocks, and
exact native round trips. The separate codec benchmark found smaller
JPEG-LS/JPEG XL archives, but slice codecs have different costs for coronal,
sagittal and tooth-region access. Package size alone is not the viewer goal.

## Source fidelity

The primary data is the original stored voxel word, independently of the
calibrated display value. DICOM uses signed/unsigned words as declared, with
BitsStored, HighBit, rescale calibration, padding and LPS geometry. OneVolume
retains all source bounds and its vendor calibration and sentinel. Its
vendor coordinates are not relabelled as patient LPS coordinates.

The previously supplied processed OneVolume array was 340³; the native grid
is 341 × 341 × 344, containing 696,664 additional source samples. Display
cropping remains a separate legacy view. The new native sidecar and version
2 export retain every source voxel.

The supplied processed Sidexis array contained 511 slices and omitted the
324th sorted native slice (index 323). The current native parser imports
all 512 files. The historical omission was not reproduced in the current
parser, so this change does not claim to identify or fix its original cause.
It adds rejection of interior slice gaps, irregular grids, and inconsistent
orientation, spacing, calibration or pixel format. Missing boundary slices,
or a uniformly undersampled series, require an external reference to detect.

The test imports the original vendor files with CBCTer's actual parsers and
assemblers, compares the entire canonical raw array with independently
verified hashes, then encodes and decodes every chunk and repeats the whole
comparison. Reversible storage-axis permutation is allowed; cropping,
rescaling and quantization are excluded from the primary raw array.

| Source | Native XYZ grid | Raw bytes | SHA-256 of canonical native words |
| --- | --- | ---: | --- |
| OneVolume | 341 × 341 × 344 | 80,001,328 | `3d833e4447700727d435f3c7d751ac826721e73378c9a7dd2a3bb1666a383c1e` |
| Sidexis | 512 × 512 × 512 | 268,435,456 | `e5c022d44347e61b1e090b0275c179c060f947b1b55549fbcdf4635d1a5ad9f3` |

## Measured package and viewer results

The tables below are generated from the authorized local examples. Package
sizes include the preview, manifest and ZIP overhead. Codec-only benchmark
sizes are smaller. Times are individual local runs, not repeated-trial
estimates or network-performance guarantees.

| Source | Native chunks | Preview | Complete v2 package | Encode package | Decode full raw | Unaligned 64³ ROI |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| onevolume | 52.70 MB | 6.81 MB | **59.55 MB** | 3.79 s | 0.97 s | 3.44 MB / 54 ms |
| sidexis | 160.01 MB | 24.37 MB | **184.47 MB** | 13.55 s | 4.75 s | 2.53 MB / 72 ms |

Encode/decode/ROI times use the actual TypeScript writer and WASM reader in
Node. The 64³ ROI crosses block boundaries and matches the original native
subvolume hash; it does not materialize the full array. Encode includes all
chunk hashes, preview creation, ZIP compression and manifest creation.

| Source / layout | Preview visible | Native view ready | HTTP package bytes to native view | Portion of package | Decoded cache limit |
| --- | ---: | ---: | ---: | ---: | ---: |
| onevolume / desktop | 1.54 s | 2.35 s | **34.99 MB** | 58.8% | 64 MiB |
| onevolume / phone | 1.45 s | 1.49 s | **16.80 MB** | 28.2% | 32 MiB |
| sidexis / desktop | 3.24 s | 5.07 s | **78.66 MB** | 42.6% | 64 MiB |
| sidexis / phone | 3.02 s | 3.83 s | **44.99 MB** | 24.4% | 32 MiB |

Browser times start at the Open URL action. Desktop native readiness covers
three planes; phone readiness covers the selected axial plane. HTTP bytes
include the importer and worker index/manifest reads, preview and required
chunks; they exclude headers and app-shell assets. The LRU stayed within its
limit during rapid paging across chunk boundaries. Both desktop full-volume
loads and subsequent worker exports preserved the verified native hashes.
These measurements use localhost with no bandwidth or CPU throttling.

Raw metrics are retained in [streaming-results.json](streaming-results.json).

## Coverage

Unit tests cover both signed and unsigned full 16-bit words, predictor
round trips, odd edges, complete coverage, physical metadata, cross-block
regions, cache eviction and reuse, corrupt ZIP/chunk hashes, malformed
metadata, and invalid HTTP ranges. Native MPR images match the dense renderer
pixel-for-pixel on all three axes, including odd slice indices. Preview
alignment checks reversed Z, odd edges and in-plane spacing. DICOM fixtures
exercise gap and calibration rejection, stored word width, bit placement and
signed padding.

Browser tests cover exporting version 2 in the worker, opening local ZIPs,
contrast changes without new reads, native slice navigation, measurements,
explicit advanced-tool loading with measurement and view-state handoff, both authorized scans over real HTTP ranges,
rapid paging across block boundaries, bounded cache sizes, desktop/phone
layouts, and failure on a host returning `200` instead of `206`. Explicit
full loading checks every native chunk and the complete raw hash before
mounting the existing dense viewer. Existing classic exports, resolution
switching, tooth chart/probe/measurement controls and MPR screenshot tests
are exercised as regression tests.

The unrelated FDI numbering test `preserves an interior FDI gap when a tooth is missing` fails on the unchanged base commit `8a97dbf` as well. It is outside
this compression change; it prevents reporting the full unit suite as green.

## Check results

- Production build and ESLint pass.
- Focused storage/import/rendering suite: 31 tests pass.
- Normal full unit suite: 151 pass, 2 native-data tests skip without explicit
  access, and 1 pre-existing FDI numbering test fails on both branches.
- Authorized source suite: both complete native import/package round trips
  and cross-block ROI comparisons pass.
- Browser coverage: 14 cases pass across the new and existing workflows;
  the two native desktop cases additionally export through the browser worker
  with verified source hashes. Three relevant export/resolution cases were
  rerun after adding the measurement/view-state handoff and pass.

## Reproduction

Normal tests use synthetic data and do not require private scans:

```sh
npm ci
npm run build
npm run lint
npm test
npm run test:e2e -- tests/e2e/chunked-viewer.spec.ts tests/e2e/dental-viewer.spec.ts tests/e2e/viewer-smoke.spec.ts --workers=1
```

The optional native test expects an authorized benchmark directory containing
`vendor/onevolume.vol`, `vendor/constants.xml`, and
`vendor/sidexis-ct3/{000..511}`. Files are read from outside the repository.
An explicit output directory writes native packages and metrics for the
browser test; neither scan arrays nor generated packages belong in Git or
the public build:

```sh
CBCTER_BENCHMARK_ROOT=/path/to/authorized/benchmark \
CBCTER_VALIDATION_OUT=/path/to/private/validation \
npx vitest run --config vitest.config.ts src/lib/import/nativeExamples.test.ts

CBCTER_VALIDATION_OUT=/path/to/private/validation \
npx playwright test tests/e2e/chunked-viewer.spec.ts --workers=1
```

Playwright starts a temporary localhost range server for those packages.
Only synthetic fixtures are staged under `public/`.

## Rollout limits and next decisions

Keep streamable export opt-in until Safari/WebKit, physical iOS/Android
phones, slow networks, and the intended production host have been exercised.
The current browser measurements use Linux headless Chromium with software
rendering and emulated phone dimensions; they do not establish real-phone
RAM, battery, GPU or mobile-network performance.

A 32/64 MiB decoded-chunk cache is not a whole-app memory limit. Preview,
plane/RGBA arrays, pending reads, WASM memory, textures, export buffers and
explicit full-volume raw/display arrays add to it. Advanced tools currently
retain their dense-volume implementation; the region reader is available
for a later tooth-ROI segmentation integration. The 3D pane remains a
preview, not streamed high-resolution volume rendering. Measurements made
in the progressive viewer transfer into the existing measurement/project
store when the full volume is loaded; closing a scan still discards unsaved
work, as in the existing viewer.

This package preserves reconstructed voxel words and selected geometry; it
is not a complete DICOM/vendor archive. Headers, acquisition details and
other series are omitted. The existing native/ITK format support boundary is
unchanged: formats without a native sidecar export their already processed
values, explicitly labelled as such. Enhanced DICOM currently uses the
existing parser's resolved shared geometry/calibration; this work does not
add general support for varying per-frame functional groups.

Before considering another codec, measure first native slice, tooth ROI,
all three MPR orientations, interaction latency, transferred bytes and total
memory on target devices. Add JPEG-LS or JPEG XL through a new declared codec
only if those measurements justify the added decoder and format complexity.
Do not replace the lossless primary representation with a lossy codec.
