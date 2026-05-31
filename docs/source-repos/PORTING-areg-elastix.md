# Porting AReg (registration / T1–T2 superimposition) into CBCTer

Status: **landmark-based rigid alignment shipped; intensity-based superimposition is server/WASM-Elastix territory.**

SADT's AReg covers two very different problems. The cheap one is now done; the expensive one is documented here so it isn't mistaken for a quick win.

## 1. Landmark / point-based rigid alignment — DONE (in-browser)

The closed-form, least-squares rigid transform that aligns two corresponding landmark sets (the core of ASO orientation and the point-based half of AReg) is implemented and tested:

- `src/lib/geometry/rigidAlignment.ts` — `absoluteOrientation(source, target)` (Horn's unit-quaternion method) returns rotation, translation, a `Mat4`, and RMSE. Plus `rodrigues`, `rotationBetween`, `meanPointDistance`, `applyTransformToPoints`.
- `src/lib/geometry/transformMatrix.ts` — `Mat4` compose/invert, ITK `.tfm` parse/serialise, LPS↔RAS flip (`flipLpsRas`).
- `src/lib/io/slicerMarkups.ts` — read/write Slicer `.mrk.json` fiducials to drive the above.

This is enough to: orient a scan to a reference frame from landmarks (ASO), rigidly register two scans by matched fiducials, and round-trip transforms to ITK/Slicer.

## 2. Intensity-based T1/T2 superimposition — NOT a TS rewrite

AReg_CBCT's marquee feature registers two CBCTs by **image intensity** (Elastix rigid/affine, Mattes mutual information optimiser). A from-scratch TS MI optimiser is an XL research trap — don't.

Two pragmatic paths:

| Option | How | Trade-offs |
|---|---|---|
| **`itk-wasm/elastix` in a worker** | Run a WASM build of Elastix client-side; feed it the two volumes + a rigid parameter map; get back a transform consumable by `transformMatrix.ts`. | Keeps the app local-first/offline (fits the PWA goal). Cost: multi-MB WASM payload, slower than native, memory pressure on large CBCT pairs. |
| **Small registration microservice** | Python `SimpleITK`/`itk-elastix` behind an HTTP endpoint; CBCTer uploads two volumes, gets a `.tfm` back. | Fast, full-fidelity, simplest to build. Cost: breaks offline/local-first; data leaves the browser (privacy/PHI implications — gate behind explicit consent). |

**Recommendation:** try `itk-wasm/elastix` first (CBCTer already depends on `@itk-wasm/dicom`, so the toolchain is familiar and the offline story is preserved). Fall back to a microservice only if WASM Elastix proves too heavy for the target volumes. Either way, the resulting transform plugs into the existing `Mat4` / `.tfm` utilities.

## Out of scope (mesh registration)
AReg_IOS (butterfly U-Net) and FlexReg operate on intraoral **surface meshes** via PyTorch3D differentiable rasterisation — no browser equivalent, and CBCTer has no intraoral-scan import path. Server-only, and only if surface-scan support is ever added.
