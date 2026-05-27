# Importing Data

CBCTer is local-first. Folder imports are read in the browser and are not
uploaded by default.

Supported local inputs:

- GALILEOS exports with `*_vol_0` and `*_vol_0_###` files.
- OneVolume exports with `CT_0.vol`.
- DICOM slice folders using native little-endian grayscale CT data.
- ZIP archives containing any supported folder layout.
- NIfTI files through the NIfTI file picker.

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
