# CBCTer scan package (`.cbct.zip`)

A slim, vendor-neutral container for one reconstructed CBCT volume. Vendor
export discs carry viewers, installers, raw projection images and patient
metadata around the one volume the app needs; the package keeps only the
volume, its geometry and a display window, so a scan can be shared, opened
on a phone, or archived without the rest.

## Making and opening packages

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

## Levels

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

## Contents

```text
CT_20260414110156.cbct.zip
├── cbct-scan.json   manifest (below)
├── volume.i16       primary level (full resolution, or the phone level for a phone-only package)
├── volume-half.i16  phone level (in "full + phone" packages)
└── preview.png      optional axial thumbnail (stored, not deflated)
```

Each level file holds `width × height × depth` signed 16-bit voxels:
- order: x fastest, then y, then z, with z running inferior → superior (the
  app's internal layout);
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

## Results on the example exports (Oct 2026)

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
