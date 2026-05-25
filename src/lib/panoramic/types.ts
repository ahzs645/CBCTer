import type { Vec3 } from '../../types';

/** A point in the axial plane, expressed in voxel coordinates (x = column, y = row). */
export interface ArchPoint {
  x: number;
  y: number;
}

/**
 * The dental arch as a set of control points in axial-plane voxel coordinates.
 * Auto-fit and manual editing both produce this same shape; the spline +
 * reformation stages consume it identically.
 */
export interface ArchCurve {
  controlPoints: ArchPoint[];
}

export type PanoramicProjection = 'mip' | 'mean';

export interface PanoramicOptions {
  /** Inclusive axial slice range projected into the panorama (output height). */
  zMin: number;
  zMax: number;
  /** Buccal-lingual half-thickness sampled either side of the curve, in mm. */
  depthMm: number;
  /** Sampling step across the depth band, in mm. */
  depthStepMm: number;
  /** Output sampling along the arch, in mm per output column. */
  archStepMm: number;
  /** Combine the depth band by max (MIP) or average (mean). */
  projection: PanoramicProjection;
  /** Window/level applied when mapping projected intensity to gray. */
  window: number;
  level: number;
}

export interface PanoramicResult {
  /** RGBA pixels, length = width * height * 4. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Millimetres per output pixel along the arch (horizontal). */
  mmPerPixelX: number;
  /** Millimetres per output pixel along Z (vertical). */
  mmPerPixelY: number;
}

/** A point on the resampled arch, in physical (mm) coordinates, with unit normal. */
export interface ArchSample {
  /** Position in mm. */
  x: number;
  y: number;
  /** Unit normal (buccal-lingual direction) in mm space. */
  nx: number;
  ny: number;
}

export interface ArchPolyline {
  samples: ArchSample[];
  /** Spacing between consecutive samples, in mm (== requested archStepMm). */
  stepMm: number;
  /** Total arch length, in mm. */
  lengthMm: number;
}

export const DEFAULT_PANORAMIC_OPTIONS: Omit<
  PanoramicOptions,
  'zMin' | 'zMax' | 'window' | 'level'
> = {
  depthMm: 10,
  depthStepMm: 0.5,
  archStepMm: 0.3,
  projection: 'mean',
};

/** Convenience accessor for [width, height, depth] dimension tuples. */
export function dims(dimensions: Vec3): {
  width: number;
  height: number;
  depth: number;
} {
  return {
    width: dimensions[0],
    height: dimensions[1],
    depth: dimensions[2],
  };
}
