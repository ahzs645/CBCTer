/**
 * Headless viewer core: the framework-agnostic three.js volume engine, the
 * volume slicing/windowing math, and the shared data contracts. None of this
 * imports React, so it can be driven from any UI layer.
 *
 * The engine implementation lives under `src/lib/volume`; this module is the
 * public surface the rest of the app (and any future consumer) imports.
 */

export { createThreePreview } from '../../lib/volume/three-preview';
export type {
  ThreePreviewInstance,
  VolumeColormap,
  VolumeRenderOptions,
  VolumeRenderStyle,
  VolumeViewPreset,
} from '../../lib/volume/three-preview';

export {
  extractAxialImage,
  extractCoronalImage,
  extractSagittalImage,
  prepareVolumeFor3D,
  resolveWindowLevel,
} from '../../lib/volume';

export { VolumeAxis } from '../../types';
export type {
  LoadedVolume,
  PreparedVolumeFor3D,
  RangeBounds,
  SliceImage,
  SliceWindowLevel,
  Vec3,
  ViewerSlices,
  VolumeCursor,
} from '../../types';
