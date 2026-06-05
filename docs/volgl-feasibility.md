# VolGL Feasibility Notes

Context: `/Users/ahmadjalil/Downloads/cbct-viewer-demo-main` demonstrates a
CBCT volume renderer built around `@volgl/renderer`. It is useful as a reference,
but it is not currently a drop-in dependency for CBCTer.

## Current Availability

- `@volgl/renderer` is not published on npm. `npm view @volgl/renderer` returns
  404.
- The demo README says the package is linked from a sibling `../VolGL/` checkout
  with `npm link`.
- No local `VolGL` checkout was found under `/Users/ahmadjalil/Downloads`.
- The demo lockfile does not include `@volgl/renderer`, consistent with a local
  linked dependency.

Implication: CBCTer should not depend on `@volgl/renderer` until the source repo
or a package tarball is available and can be pinned reproducibly.

## CBCTer Integration Fit

CBCTer already has a working Three.js 3D preview engine:

- `LoadedVolume` keeps native `Int16Array` voxel data plus scalar metadata.
- `PreparedVolumeFor3D` downscales as needed and quantizes preview voxels to
  `Uint8Array` for Three's `Data3DTexture`.
- `VolumeViewport3D` already supports render presets, crop clipping, slice
  planes, surface mesh overlays, snapshots, and camera presets.

The VolGL demo appears to expect a `VolumeData` object with at least:

- `dimensions`
- `spacing`
- renderer-owned volume texture/upload behavior
- renderer-level controls such as `setVolume`, `setPreset`, `setWindowLevel`,
  `setStepSize`, and `setEarlyRayTermination`

That shape is conceptually compatible with CBCTer's import pipeline, but exact
adapter code cannot be verified without the VolGL source types.

## Recommended Path

1. Keep CBCTer's existing renderer as the production path.
2. Port low-risk behaviors from the demo into the existing renderer:
   - WebGL context lost/restored status.
   - FPS and physical extent readout.
   - More explicit physical camera fitting.
   - Optional OBJ guide overlays.
3. If the VolGL source becomes available, create an experimental renderer behind
   a feature flag rather than replacing `VolumeViewport3D`.
4. Compare both renderers on the bundled sample and a real DICOM folder using:
   - initial render success,
   - camera orientation/framing,
   - interaction FPS,
   - memory/context stability,
   - window/level fidelity,
   - surface/OBJ overlay alignment.

## Adapter Sketch

If VolGL exposes `VolumeData` as raw voxel data, an adapter can be built from
`LoadedVolume`:

```ts
function toVolglVolume(volume: LoadedVolume) {
  return {
    dimensions: volume.meta.dimensions,
    spacing: volume.meta.spacing,
    scalarRange: volume.meta.scalarRange,
    data: volume.voxels,
  };
}
```

If it only accepts files through `loadDicomVolume(files)`, then CBCTer cannot
reuse its already-parsed local volume directly. In that case VolGL would be
useful only for a separate DICOM-only path, not for GALILEOS, OneVolume, NIfTI,
sample data, or project-restored volumes.

