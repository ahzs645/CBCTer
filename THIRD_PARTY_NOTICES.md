# Third-party notices & attribution

CBCTer includes clean-room TypeScript reimplementations of algorithms from the
following open-source projects. No third-party source code is vendored; these
are independent implementations of published/permissively-licensed methods,
listed here for attribution. See `docs/source-repos/LICENSING.md` for the full
gate, especially regarding **trained model weights** (which are NOT bundled and
carry separate licenses).

| CBCTer module | Algorithm / provenance | Upstream | Upstream license |
|---|---|---|---|
| `src/lib/geometry/rigidAlignment.ts` | Closed-form rigid alignment (Horn's unit-quaternion absolute orientation); Rodrigues rotation. Ported from SADT ASO/AReg orientation math. | SlicerAutomatedDentalTools (ASO/AReg); B.K.P. Horn, *J. Opt. Soc. Am. A* (1987) | Apache-2.0 / public method |
| `src/lib/geometry/transformMatrix.ts` | ITK `.tfm` (`MatrixOffsetTransformBase`) parse/serialise; LPS↔RAS convention. | ITK / SlicerAutomatedDentalTools | Apache-2.0 |
| `src/lib/io/slicerMarkups.ts` | 3D Slicer Markups fiducial (`.mrk.json`) schema I/O. | 3D Slicer | BSD-style (Slicer License) |
| `src/lib/volume/intensityNormalization.ts` | nnU-Net `CTNormalization` (clip + standardise) and percentile normalisation. | nnU-Net (Isensee et al., *Nat. Methods* 2021) | Apache-2.0 |
| `src/lib/volume/resample.ts` | Trilinear / nearest voxel-grid resampling between spacings. | Standard method (ITK-equivalent) | — |
| `src/lib/segmentation/maskOperations.ts` (`removeSmallComponents*`) | Spacing-aware small-component removal (nnU-Net/DentalSegmentator post-processing). | nnU-Net / DentalSegmentator | Apache-2.0 |
| `src/lib/segmentation/fdiNumbering.ts` | FDI (ISO 3950) tooth numbering via PCA centre-line + jaw offset; `FDI_NUMBERING` map. | ToothGroupNetwork (`inference_pipeline_tgn`, `web_app.py`) | Unstated (research) — algorithm only, no code/weights reused |

## Models / weights

**None bundled.** Any future bundled model (e.g. DentalSegmentator nnU-Net,
Zenodo DOI 10.5281/zenodo.10829674) must have its weight license verified and
recorded here before shipping — see `docs/source-repos/LICENSING.md`.
