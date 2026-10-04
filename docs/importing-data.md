# Importing Data

CBCTer is local-first. Folder imports are read in the browser and are not
uploaded by default.

Supported local inputs:

- CBCTer scan packages (`*.cbct.zip`, or the unzipped folder): the slim
  export described in [scan-package.md](./scan-package.md).
- GALILEOS exports with `*_vol_0` and `*_vol_0_###` files.
- OneVolume exports with `CT_0.vol`. Only `CT_0.vol`, `CtStatus.csv` and
  `Constants1100.xml` are needed; leaving out `Capture.tif` (raw
  projections, ~100 MB) keeps phone imports light.
- DICOM slice folders using native little-endian grayscale CT data. Slices
  without a file extension (DICOMDIR-style discs such as Sirona Sidexis,
  `CT3/000`, `001`, …) are recognised by their `DICM` signature.
- ZIP archives containing any supported folder layout, opened with
  *Open ZIP file* (or found inside a picked folder). A vendor ZIP is
  unpacked entirely in memory, viewer software included, so prefer a
  desktop or a folder import for large discs. A `.cbct.zip` scan package
  is *not* unpacked: only its manifest and the resolution level being
  opened are read.
- NIfTI files through the NIfTI file picker.

See [dental-viewer.md](./dental-viewer.md#pipeline-vendor-export--slim-package--any-device)
for the vendor export → slim package workflow, and
[What to upload](./dental-viewer.md#what-to-upload) for which folder to pick
from each example export and for phone (iOS / Android) notes.

Remote imports can load a direct URL to a ZIP, NIfTI, or a remote manifest JSON:

```json
{
  "name": "Example study",
  "files": [
    { "url": "https://example.org/dicom/0001.dcm" },
    { "url": "https://example.org/dicom/0002.dcm" }
  ]
}
```

Remote URLs depend on browser CORS access. DICOMweb, authenticated S3/GCS, and
progressive range loading are planned extension points rather than current
default behavior.
