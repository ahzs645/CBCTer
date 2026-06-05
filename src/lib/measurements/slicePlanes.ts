import type { Vec3 } from '../../types';
import { VolumeAxis } from '../../types';
import { clamp } from '../volume/math';

export interface SlicePlane {
  axis: VolumeAxis;
  normal: Vec3;
  referencePoint: Vec3;
  distance: number;
  sliceIndex: number;
}

const AXIS_NORMALS: Record<VolumeAxis, Vec3> = {
  [VolumeAxis.Axial]: [0, 0, 1],
  [VolumeAxis.Coronal]: [0, 1, 0],
  [VolumeAxis.Sagittal]: [1, 0, 0],
};

function axisIndex(axis: VolumeAxis): 0 | 1 | 2 {
  switch (axis) {
    case VolumeAxis.Axial:
      return 2;
    case VolumeAxis.Coronal:
      return 1;
    case VolumeAxis.Sagittal:
      return 0;
  }
}

function axisLimit(axis: VolumeAxis, dimensions: Vec3): number {
  return Math.max(0, dimensions[axisIndex(axis)] - 1);
}

/**
 * Compute an orthogonal slice plane centered on a reference point. The
 * `distance` is expressed in physical units when spacing is provided.
 */
export function computeReferenceSlicePlane(
  axis: VolumeAxis,
  referencePoint: Vec3,
  options: {
    distance?: number;
    spacing?: Vec3;
    dimensions?: Vec3;
  } = {},
): SlicePlane {
  const coordIndex = axisIndex(axis);
  const spacing = options.spacing ?? [1, 1, 1];
  const distance = options.distance ?? 0;
  const rawIndex = referencePoint[coordIndex] + distance / spacing[coordIndex];
  const sliceIndex = options.dimensions
    ? clamp(Math.round(rawIndex), 0, axisLimit(axis, options.dimensions))
    : Math.round(rawIndex);

  return {
    axis,
    normal: AXIS_NORMALS[axis],
    referencePoint,
    distance,
    sliceIndex,
  };
}

export function computeReferenceSliceSet(
  referencePoint: Vec3,
  options: {
    distance?: number;
    spacing?: Vec3;
    dimensions?: Vec3;
  } = {},
): Record<VolumeAxis, SlicePlane> {
  return {
    [VolumeAxis.Axial]: computeReferenceSlicePlane(
      VolumeAxis.Axial,
      referencePoint,
      options,
    ),
    [VolumeAxis.Coronal]: computeReferenceSlicePlane(
      VolumeAxis.Coronal,
      referencePoint,
      options,
    ),
    [VolumeAxis.Sagittal]: computeReferenceSlicePlane(
      VolumeAxis.Sagittal,
      referencePoint,
      options,
    ),
  };
}
