# Viewer kit (`src/viewer`)

A reusable CBCT/volume viewer split into composable pieces. Import everything
from the package root:

```ts
import {
  // headless
  createThreePreview,
  prepareVolumeFor3D,
  useVolumeViewerState,
  // components
  AxisViewportGrid,
  VolumeViewport3D,
  SliceCanvas,
  ViewportFrame,
  // theming / strings
  defaultViewerTheme,
  defaultAxisViewportLabels,
  defaultVolumeViewport3DLabels,
} from '../viewer';
```

The app's `src/pages/ViewerPage.tsx` is the canonical, full example — read it
alongside this file.

## Layers

| Path | What | React? |
| --- | --- | --- |
| `core/` | three.js volume engine (`createThreePreview`), volume math (`extract*Image`, `prepareVolumeFor3D`), and the data types | no |
| `useVolumeViewerState.ts` | headless state hook: cursor, window/level, zoom, selected axis, derived slices | hook only |
| `react/` | `SliceCanvas`, `AxisViewportGrid`, `VolumeViewport3D`, `ViewportFrame`, `MeasurementOverlay` | yes |
| `theme.ts` | `ViewerTheme` + `defaultViewerTheme` | no |
| `labels.ts` | label contracts + English defaults | no |

The components have **no i18n dependency** — every string is a prop with an
English default. Colors that carry meaning (per-plane, crosshair) come from a
`theme` prop.

## Bring your own volume

If you already have a `LoadedVolume` (and a `PreparedVolumeFor3D` from
`prepareVolumeFor3D`), you can drive the viewer without any loading code. The
state hook owns cursor/window-level/zoom and re-initializes when the volume
changes.

```tsx
import { useEffect, useRef } from 'react';
import {
  AxisViewportGrid,
  VolumeViewport3D,
  type VolumeViewport3DHandle,
  useVolumeViewerState,
  type LoadedVolume,
  type PreparedVolumeFor3D,
} from '../viewer';

function MyViewer({
  volume,
  prepared3D,
}: {
  volume: LoadedVolume | null;
  prepared3D: PreparedVolumeFor3D | null;
}) {
  const state = useVolumeViewerState(volume);
  const viewport3D = useRef<VolumeViewport3DHandle>(null);

  // Cursor is pushed to the 3D view imperatively so scrubbing never re-renders it.
  useEffect(() => {
    viewport3D.current?.focusCursor(state.cursor);
  }, [state.cursor]);

  return (
    <>
      <VolumeViewport3D ref={viewport3D} volume={prepared3D} />
      <AxisViewportGrid
        hasVolume={Boolean(volume)}
        cursor={state.cursor}
        dimensions={state.dimensions}
        spacing={state.spacing}
        slices={state.slices}
        mprZoom={state.mprZoom}
        selectedAxis={state.selectedAxis}
        onSelectAxis={state.updateCursor}
        onSelectedAxisChange={state.setSelectedAxis}
        onZoomChange={state.setMprZoom}
      />
    </>
  );
}
```

## Injecting i18n

Build a label object once (memoized) and pass it in. Defaults are English:

```tsx
import { useMemo } from 'react';
import { AxisViewportGrid, defaultAxisViewportLabels } from '../viewer';

const labels = useMemo(
  () => ({ ...defaultAxisViewportLabels, noVolume: t('myKey.noVolume') }),
  [t],
);

<AxisViewportGrid labels={labels} /* ... */ />;
```

`src/app/viewer-i18n.ts` shows the full mapping from this app's i18next catalog
onto `AxisViewportLabels` / `VolumeViewport3DLabels`.

## Theming

```tsx
import { AxisViewportGrid, defaultViewerTheme } from '../viewer';

const theme = {
  ...defaultViewerTheme,
  planeColors: { axial: '#22d3ee', coronal: '#f59e0b', sagittal: '#a78bfa' },
  crosshairColor: '#22d3ee',
};

<AxisViewportGrid theme={theme} /* ... */ />;
```

Every top-level component also accepts a `className` (merged onto its root via
`tailwind-merge`) so you can override the major surfaces, e.g.
`<VolumeViewport3D className="bg-white" />`.

## Headless engine only

`createThreePreview(hostEl, preparedVolume)` returns an imperative instance
(`focusCursor`, `setRenderOptions`, `setView`, `snapshot`, `dispose`, …) with no
React involved — useful if you want a 3D volume render in a non-React context.

## Dependencies & caveats

- Peer runtime: `react`, `react-dom`, `three`, and `lodash` (debounce in the
  state hook). `lucide-react` for icons.
- Styling assumes a **Tailwind** build that emits the utility classes used here.
- **Known limitation:** the dark `slate`/`sky` chrome (panel backgrounds, hover
  states) is still hardcoded. `className` overrides + `theme` cover the common
  cases; full token-level restyling (CSS variables for the internal panels) is a
  planned follow-up. `planeColors`, `crosshairColor`, and labels are fully
  parameterized today.
- The 3D scene background color is currently fixed inside the engine.
