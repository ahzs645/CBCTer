import type {
  Data3DTexture,
  Group,
  IUniform,
  Texture,
  Vector2,
  Vector3,
} from 'three';

export type ThreeModule = typeof import('three');
export type TrackballControlsModule =
  typeof import('three/addons/controls/TrackballControls.js');
export type VolumeShaderModule =
  typeof import('three/addons/shaders/VolumeShader.js');

export type VolumeShaderUniforms = Record<string, IUniform> & {
  u_size: IUniform<Vector3>;
  u_renderstyle: IUniform<number>;
  u_renderthreshold: IUniform<number>;
  u_clim: IUniform<Vector2>;
  u_data: IUniform<Data3DTexture>;
  u_cmdata: IUniform<Texture>;
};

export type VolumeRenderStyle = 'mip' | 'iso';

export type VolumeColormap = 'grayscale' | 'bone' | 'hot' | 'viridis';

export interface VolumeRenderOptions {
  renderStyle: VolumeRenderStyle;
  /** Iso/MIP density threshold, 0..1. */
  threshold: number;
  /** Colormap opacity multiplier, 0..1. */
  opacity: number;
  /** Lower contrast limit, 0..1. */
  climLow: number;
  /** Upper contrast limit, 0..1. */
  climHigh: number;
  /** Volume transfer-function colormap (default grayscale). */
  colormap: VolumeColormap;
}

export interface SurfaceMeshPreview {
  id: string;
  stl: ArrayBuffer;
  color: string;
  opacity: number;
  visible: boolean;
}

export type VolumeViewPreset =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom';

export interface ThreePreviewInstance {
  dispose: () => void;
  focusCursor: (cursor: import('../../types').VolumeCursor | null) => void;
  setPlanesVisible: (visible: boolean) => void;
  setGridVisible: (visible: boolean) => void;
  setSurfaceMeshes: (surfaces: SurfaceMeshPreview[]) => void;
  setRenderOptions: (options: Partial<VolumeRenderOptions>) => void;
  setView: (preset: VolumeViewPreset) => void;
  resetView: () => void;
  /** PNG data URL of the current 3D frame, or null if capture failed. */
  snapshot: () => string | null;
}

export interface CursorPlaneSet {
  root: Group;
  update: (target: Vector3) => void;
  dispose: () => void;
}
