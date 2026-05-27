# Architecture Notes

CBCTer currently avoids a vtk.js dependency. Slices are rendered with canvas,
3D preview uses Three.js, and import workers assemble raw `Int16Array` volumes.

VolView features are brought over selectively:

- portable import behaviors: archive expansion, MIME/type detection, manifests.
- portable project behaviors: versioned archive manifests and migrations.
- portable interaction behavior: drag window/level and interpolated paint
  strokes.

Features that require product decisions before implementation:

- ITK/GDCM DICOM split-and-sort for broader transfer syntax and series support.
- DICOMweb browsing and authenticated remote sources.
- VolView session compatibility.
- vtk-style oblique MPR and cinematic rendering controls.

The default stance remains local-first. Server-side segmentation, DICOM proxying,
and remote archive storage should be introduced behind explicit APIs and tests.
