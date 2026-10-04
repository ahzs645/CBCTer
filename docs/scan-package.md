# CBCTer scan package (`.cbct.zip`)

A slim, vendor-neutral container for one reconstructed CBCT volume. Vendor
export discs carry viewers, installers, raw projection images and patient
metadata around the one volume the app needs; the package keeps only the
volume, its geometry and a display window, so a scan can be shared, opened
on a phone, or archived without the rest.

## Package formats

The export dialog offers **Classic** (version 1, the compatibility default)
and **Streamable · volume + preview** (version 2). Version 2 preserves native
raw words when the importer has them and loads a preview before native
regions. Version 1 stores the processed Int16 display volume.
See [streaming validation and rollout](streaming-validation.md) for the
source audit, complete voxel comparisons, measured package sizes, and
browser results. The legacy results below are sampled comparisons of the
processed workflow; they are not proof of native source fidelity.

## Making and opening classic packages

- **Export:** open any supported scan (whole export folder, series folder,
  or a ZIP of either), then use *Export slim package* (desktop toolbar
  archive icon; phone *More* sheet). Choose what the package carries:
  - **Full + phone version (recommended):** one file with both levels.
    Desktops open full resolution; phones open the phone level and never
    read the full data out of the zip.
  - **Full resolution only.**
  - **Phone version only:** the smallest file to send to a phone.
- **Name:** defaults to the vendor scan ID when it has the `CT_<digits>`
  form, otherwise `CBCT_<date>`, so patient names in folder names never
  reach the file name.
- **Open:**
  - *Open ZIP file* on the import screen, on desktop and phone;
  - the unzipped folder with *Open folder*;
  - a direct URL with *Open URL*.
- **Which level opens:**
  - *Auto* by default: phone level on screens narrower than 768 px or on
    devices reporting ≤ 4 GB of memory; full resolution otherwise.
  - Switch any time with *Resolution: Full / Phone* in the side panel
    (desktop) or *Load full resolution* / *Switch to phone version* in
    *More* (phone). Switching reopens the package at that level.

## Classic levels

The phone level is the same scan averaged over 2×2×2 blocks:
- 1/8 of the voxels at double the voxel size, so a 0.125 mm scan becomes
  0.25 mm;
- measurements stay correct in millimetres;
- padding voxels (outside the field of view) are left out of each average.

When the package is opened from a zip, the importer:
1. reads the zip's central directory (the index at the end of the file);
2. reads the manifest;
3. reads only the compressed bytes of the level it opens
   (`src/lib/import/zipIndex.ts`).

A phone therefore loads about 1/8 of the data and never holds the full
volume in memory.

## Classic contents

```text
CT_20260414110156.cbct.zip
├── cbct-scan.json   manifest (below)
├── volume.i16       primary level (full resolution, or the phone level for a phone-only package)
├── volume-half.i16  phone level (in "full + phone" packages)
└── preview.png      optional axial thumbnail (stored, not deflated)
```

Each level file holds `width × height × depth` signed 16-bit voxels:
- order: x fastest, then y, then z, with z following the imported grid; patient orientation is described
  separately when known;
- `encoding: "byte-shuffle"`: all low bytes first, then all high bytes. On
  noisy CBCT data this deflates 15–20% smaller than interleaved
  little-endian. To decode, interleave `low[i]` and `high[i]` back into
  little-endian Int16;
- `encoding: "raw"`: plain interleaved little-endian Int16. Readers accept
  both.

### Manifest (`cbct-scan.json`, version 1)

```json
{
  "format": "cbcter-scan",
  "version": 1,
  "name": "CT_20260414110156",
  "createdAt": "2026-10-04T01:10:00.000Z",
  "generator": "CBCTer",
  "source": { "format": "onevolume", "formatLabel": "OneVolume CT" },
  "volume": {
    "file": "volume.i16",
    "dtype": "int16",
    "byteOrder": "little-endian",
    "encoding": "byte-shuffle",
    "layout": "x-fastest",
    "dimensions": [340, 340, 340],
    "spacing": [0.125, 0.125, 0.125],
    "scalarRange": [-6588, 5826],
    "paddingValue": -32768
  },
  "display": { "window": 7427, "level": 315 },
  "orientation": { "nativeAxis": "axial" },
  "resolution": "full",
  "levels": [
    {
      "id": "half",
      "file": "volume-half.i16",
      "encoding": "byte-shuffle",
      "dimensions": [170, 170, 170],
      "spacing": [0.25, 0.25, 0.25],
      "scalarRange": [-5571, 5180]
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `volume.dimensions` / `spacing` | Voxel counts and voxel size in mm (x, y, z). |
| `volume.scalarRange` | Min/max voxel value, ignoring padding. Values are the importer's HU-like scale. |
| `volume.paddingValue` | Value marking voxels outside the reconstructed field of view (OneVolume uses −32768), or `null`. |
| `display` | Window/level the scan was showing when exported. |
| `orientation` | Native slice axis and, when known, patient axes in voxel space. |
| `resolution` | Level of the primary `volume`: `full`, or `half` for a phone-only package. |
| `levels` | Additional levels of the same scan (geometry and file each). Optional; a reader that ignores it still gets a complete scan from `volume`. |

The importer rejects a package if:
- the manifest has the wrong `format`;
- the `version` is newer than the app supports;
- the geometry is invalid;
- the size of `volume.i16` does not match the dimensions.

## What is left out

- vendor viewers, installers, DLLs and help files;
- raw projection images (OneVolume `Capture.tif`, about 100 MB);
- other DICOM series on the disc, such as screenshots, reports and
  encapsulated PDFs;
- all patient and study identifiers: name, ID, birth date, accession and
  UIDs, plus original file headers and source paths.

The package does not include measurements or the tooth chart; save those
with the project export.

**The scan date is still there.** The default name (for example
`CT_20250826132733`) encodes the acquisition date and time. Strict
de-identification rules (such as HIPAA Safe Harbor) treat full dates as
identifiers, so rename the package before sharing it outside the clinic. Clinical information can still be visible *in the
image itself*, so treat a package as patient data.

## Earlier classic-package measurements (Oct 2026)

Measured in the test container (Chromium, software rendering, iPhone 15 Pro
Max emulated in Chromium):

| Example | Original export | One package (full + phone) | Desktop opens | Phone opens | Phone → full on request |
| --- | --- | --- | --- | --- | --- |
| Morita OneVolume, Apr 2026 | 271 MB, 82 files | **47.9 MB** | full 340³ in 5.0 s, reads 42.7 MB | phone 170³ in **2.7 s**, reads **5.4 MB** | 2.7 s |
| Sirona Sidexis disc, Aug 2025 | 867 MB, 743 files | **167 MB** | full 512³ in 12.1 s, reads 148 MB | phone 256³ in **3.6 s**, reads **18.9 MB** | 10.3 s |

Single-level packages for comparison:

| Example | Full only | Phone only |
| --- | --- | --- |
| OneVolume | 42.6 MB | 5.4 MB |
| Sidexis | 148 MB | 18.9 MB |

The package contents were checked independently in Python against the
original vendor files:
- **Full level:** identical (20 000 / 20 000 random voxels for OneVolume
  using the app's half-up rounding; 3000 / 3000 for Sidexis).
- **Phone level:** matches the 2×2×2 average (3000 / 3000 for each).
- **No identifiers:** no patient name, ID or folder name appears in any
  manifest.

The reopened packages show the same window/level, and at full resolution
the same dimensions, spacing and voxel values, as the original import.


## Streamable packages (version 2)

```text
scan.cbct.zip
├── cbct-scan.json
├── chunks/0.zst
├── chunks/1.zst
├── …
├── preview.i16
└── preview.png       optional thumbnail
```

`volume` describes the complete canonical source grid: XYZ dimensions and
spacing, signed or unsigned 16-bit dtype, stored bit count, optional DICOM
high bit, padding, origin, three voxel-axis directions, coordinate system,
source calibration, and whether the words are native or already processed.
DICOM patient geometry is LPS. OneVolume coordinates are explicitly labelled
`vendor`; the importer does not infer a patient transform. Calibration is
`(raw / divisor) * slope + intercept`. Raw stored words are the primary
representation; windowing uses a separately rounded, clamped Int16 view.

Blocks are 64 × 64 × 64 voxels, with smaller edge blocks. Block descriptors
are ordered X, then Y, then Z and include their start, actual shape, encoded
byte count and raw SHA-256. Within each block, subtract the preceding X
sample modulo 65536, restarting each row at zero. Store all low delta bytes,
then all high delta bytes, and encode this stream with Zstd level 3. Decode
by unshuffling and cumulatively adding modulo 65536, then interpreting the
restored words according to dtype. The predictor preserves every bit,
including padding and unused DICOM bits. ZIP stores the already compressed
Zstd entries without outer compression, allowing independent range reads.

`preview` is a derived Int16 array sampled at native indices `2*x, 2*y, 2*z`,
with dimensions `ceil(nativeDimensions / 2)` and twice the spacing. It keeps
odd edges and the source grid origin. It is ZIP-deflated and checked against
its SHA-256. It is used for initial MPR and 3D display. Measurements are
blocked until the visible native slice has loaded; MPR crosshairs and slice
navigation always use native dimensions and spacing.

The manifest also contains the whole canonical raw-volume SHA-256, display
window, scalar range and known orientation. The reader checks ZIP CRCs,
geometry, complete nonoverlapping block coverage, declared Zstd content
sizes and decoded raw hashes. Full-volume loading verifies the complete
raw-volume hash. These checks detect corruption; the package is not an
authenticated provenance record.

Both desktop and phone open version 2 preview-first. Desktop fills three
native MPR planes; the phone fetches the selected plane. The worker uses a
64 MiB desktop / 32 MiB light-device LRU cache of decoded chunks and at most
four chunk operations per request. Plane requests cancel at chunk boundaries
when the cursor changes. Window/level changes reuse the current raw plane.
**Load full volume for advanced tools** explicitly materializes the raw and
derived dense arrays for the existing segmentation and panoramic tools.
The cache limit covers decoded chunks, not total application RAM.

Old readers cannot open version 2. Current CBCTer retains version 1 import,
export and resolution switching. Exporting an existing version 1 package as
version 2 labels its words `processed`: it cannot restore source samples
that were previously cropped, calibrated, averaged or omitted.

### Hosting

The app must run on HTTPS or localhost for SHA-256 verification. Local ZIPs
and unpacked folders support independent reads. Direct remote
package URLs should end in `.cbct.zip`; query strings are supported. The
host must return exact `206 Partial Content` responses with `Content-Range`.
For cross-origin access, allow CORS and expose `Content-Range` and `ETag`;
if a strong ETag is supplied, allow `If-Range` requests as well. The reader
rejects changing resources, invalid ranges and full `200` responses, cancels
their bodies, and tells the user to download and open the ZIP locally.
Generic download URLs and remote folder manifests retain their existing
whole-file import path. The app service worker bypasses all Range requests.

ZIP64 and encrypted archives are unsupported. Version 2 currently requires
16-bit source words, a regular orthogonal grid, and blocks in the specified
order. Larger-than-64 MiB region outputs require explicit full loading.
