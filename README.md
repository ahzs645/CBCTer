# CBCTer

Local-first CBCT viewer and tooth segmentation scaffold.

## Current status

- Browser shell for a web-first CBCT workflow.
- Local Python validation harness for the Slicer CBCT tooth segmentation model.
- The DICOM sample data remains outside this repository because it contains PHI-bearing metadata.

## Commands

```bash
npm install
npm run dev
npm run build
npm run segment:sample
npm run segment:arch
npm run segment:auto
npm run segment:curate
npm run segment:validate
npm run segment:pipeline
npm run segment:watershed
```

The segmentation scripts read DICOM input from `CBCTER_SAMPLE_DICOM_DIR`.
Set it to a local, untracked sample directory before running sample generation
or segmentation commands:

```bash
export CBCTER_SAMPLE_DICOM_DIR="/path/to/dicom-folder"
```

`npm run segment:sample` runs the downloaded Slicer model against that directory
and writes outputs under `outputs/sample-segmentation`.

Generated demo data is intentionally not committed. These paths can be rebuilt
from the local DICOM sample and model when needed:

- `public/sample-cbct`: created by `npm run sample:build`.
- `public/sample-dicom`: created by `npm run sample:link-dicom`.
- `public/sample-segmentation`: created by `npm run segment:pipeline`.
- `public/sample-segmentation-curated`: created by `npm run segment:pipeline`
  or `npm run segment:curate`.
- `public/sample-segmentation-hybrid`: created by `npm run segment:pipeline`.
- `public/sample-segmentation-watershed`: created by
  `npm run segment:watershed` and then copied into `public/` if you want it
  available to the web viewer.

`npm run segment:arch` runs multiple tight ROI candidates against the sample
series and writes separated instance labels under:

```text
outputs/sample-arch-segmentation
```

Important: the downloaded Slicer model is an ROI-based single-tooth segmenter,
not a full-mouth detector. The current arch command is a bootstrap workflow:
candidate tooth crops are supplied explicitly, each accepted crop receives its
own label, and rejected crops remain in `summary.json` for review. The web UI
still needs ROI drawing/editing so a user can place these crops interactively.

`npm run segment:auto` derives candidate tooth ROIs from the CBCT volume,
runs the ROI model over each candidate, removes duplicate-heavy crops, keeps the
largest 3D component per accepted label, applies centroid duplicate pruning, and
exports separated artifacts under:

```text
outputs/sample-auto-segmentation
```

That folder includes:

- `labels.npz`: compressed uint16 instance label volume.
- `summary.json`: ROI bounds, voxel counts, accepted/rejected status.
- `summary.json`: also includes centroid, bounding-box, extent, assigned-ratio,
  and duplicate-rejection metrics for QC.
- `instances/*.png`: per-label visual QC previews.
- `stl/*.stl`: per-label tooth mesh exports.

`npm run segment:curate` copies the primary ROI-model result into
`public/sample-segmentation-curated` and adds quality status fields so the web
viewer can distinguish usable labels from labels that need review.

`npm run segment:validate` checks the curated separation manifest and fails if
the expected label volume, previews, STL meshes, sequential label IDs, and
minimum accepted-label count are not present.

`npm run segment:pipeline` regenerates the primary sample tooth separation from
the source DICOM folder, publishes it under `public/sample-segmentation`,
creates the curated web result, and validates the curated manifest.

`npm run segment:watershed` creates a secondary hard-tissue watershed
separation result. It is useful for comparison and review, but the ROI-model
pipeline remains the primary output because watershed tends to split
restorations and jaw-adjacent structures into extra fragments on this sample.
