/**
 * Public API for the reusable CBCT viewer module.
 *
 * Layers:
 *  - `core`   headless three.js engine + volume math + data contracts (no React)
 *  - `react`  presentational components (SliceCanvas, AxisViewportGrid,
 *             VolumeViewport3D, ViewportFrame) — labels and theme injected
 *  - theme / labels  the injection contracts, each with English defaults
 *
 * `src/pages/ViewerPage.tsx` is the example that composes these into the app.
 */

export * from './core';

export {
  useVolumeViewerState,
  type VolumeViewerState,
} from './useVolumeViewerState';

export { SliceCanvas } from './react/SliceCanvas';
export {
  SliceCanvasFit,
  type SliceCanvasFit as SliceCanvasFitType,
} from './react/SliceCanvas.constants';
export { AxisViewportGrid } from './react/AxisViewportGrid';
export {
  VolumeViewport3D,
  type VolumeViewport3DHandle,
} from './react/VolumeViewport3D';
export { ViewportFrame } from './react/ViewportFrame';
export {
  MeasurementOverlay,
  type CompletedSliceMeasurement,
} from './react/MeasurementOverlay';
export {
  useSliceInteraction,
  type Rect,
  type SliceInteraction,
  type SliceInteractionParams,
} from './react/useSliceInteraction';

export { defaultViewerTheme, type ViewerTheme } from './theme';
export {
  defaultAxisViewportLabels,
  defaultVolumeViewport3DLabels,
  defaultMeasurementLabels,
  type AxisViewportLabels,
  type VolumeViewport3DLabels,
  type MeasurementLabels,
} from './labels';
