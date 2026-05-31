# Licensing gate for ported code & bundled models

Two separate questions, often conflated:

1. **Source-code license** — governs reusing/porting the *algorithms*. Generally permissive here.
2. **Trained-weight license** — governs bundling/shipping the *model weights*. This is the real hazard and is **not** covered by the source license.

**Rule:** ported math/algorithms (Rodrigues, Horn alignment, FDI heuristic, CTNormalization formula, resampling) are facts/short routines — low-risk to reimplement with attribution. **Gate every model-weight bundle on a weight-license check.**

## Per-source status

| Source | Source-code license | Weights | Weight license / action |
|---|---|---|---|
| **nnU-Net** (framework) | Apache-2.0 | n/a | Architecture & export code are fine to use with attribution. |
| **DentalSegmentator** | Apache-2.0 (Slicer module) | `Dataset112_DentalSegmentator_v100.zip`, **Zenodo DOI 10.5281/zenodo.10829674** | ✅ **CC-BY-4.0** (verified from the Zenodo record) — redistributable **with attribution**. Attributed in `/THIRD_PARTY_NOTICES.md`; cite the Dot et al. 2024 paper. |
| **SlicerAutomatedDentalTools** (AMASSS/ALI/ASO/AReg) | Apache-2.0 | Runtime-downloaded from GitHub releases (none on disk) | You must re-host weights yourself → confirm each model's individual license; do not assume the repo license propagates. |
| **ToothGroupNetwork** | Unstated (MICCAI-2022 challenge code) | Variant `-main` ships `.h5` (~250 MB), research artifacts | Treat as research-only / non-redistributable until clarified. (Moot in-browser — the nets aren't web-portable — but relevant for any microservice.) |
| Presidio / PyTorch3D / shapeaxi | Various | n/a | Out of scope; don't vendor their code. |

## Checklist before shipping a model

- [ ] Located the weight artifact and its **explicit** license (not the code license).
- [ ] License permits redistribution / hosting in a web app (or self-hosted with attribution).
- [ ] Real `plans.json` / preprocessing constants substituted for placeholders (see `PORTING-nnunet-dentalsegmentator.md`).
- [ ] Attribution recorded in `/THIRD_PARTY_NOTICES.md`.

## CBCTer's own license

CBCTer is licensed **MIT** (see `/LICENSE`, `package.json` `"license": "MIT"`).
MIT is compatible with the Apache-2.0 upstreams the algorithm ports derive from.
The ports (`src/lib/geometry/*`, `resample.ts`, `intensityNormalization.ts`,
`fdiNumbering.ts`, `slicerMarkups.ts`, `transformMatrix.ts`) are clean-room
reimplementations of permissively-licensed algorithms, attributed in
`THIRD_PARTY_NOTICES.md`. This covers CBCTer's **own code only** — bundling any
third-party **trained weights** is still gated on the per-model checklist above.
