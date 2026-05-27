import { VolumeAxis, type Vec3, type VolumeCursor } from '../../types';

export interface LabelmapBrushOptions {
  axis: VolumeAxis;
  cursor: VolumeCursor;
  dimensions: Vec3;
  spacing: Vec3;
  voxels?: Int16Array;
  brushSizeMm: number;
  brushShape: 'circle' | 'square';
  operation: 'draw' | 'erase' | 'threshold';
  thresholdRange: [number, number];
  segmentValue: number;
  lockedValues?: Set<number>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function axisPointToVoxel(
  axis: VolumeAxis,
  point: { xRatio: number; yRatio: number },
  cursor: VolumeCursor,
  dimensions: Vec3,
): [number, number, number] {
  const [width, height, depth] = dimensions;
  if (axis === VolumeAxis.Axial) {
    return [
      clamp(Math.round(point.xRatio * (width - 1)), 0, width - 1),
      clamp(Math.round(point.yRatio * (height - 1)), 0, height - 1),
      cursor.z,
    ];
  }
  if (axis === VolumeAxis.Coronal) {
    return [
      clamp(Math.round(point.xRatio * (width - 1)), 0, width - 1),
      cursor.y,
      clamp(Math.round((1 - point.yRatio) * (depth - 1)), 0, depth - 1),
    ];
  }
  return [
    cursor.x,
    clamp(Math.round(point.xRatio * (height - 1)), 0, height - 1),
    clamp(Math.round((1 - point.yRatio) * (depth - 1)), 0, depth - 1),
  ];
}

function inPlaneRadii(
  axis: VolumeAxis,
  spacing: Vec3,
  brushSizeMm: number,
): [number, number] {
  const radiusMm = Math.max(0.25, brushSizeMm / 2);
  if (axis === VolumeAxis.Axial) {
    return [
      Math.ceil(radiusMm / Math.max(spacing[0], 0.001)),
      Math.ceil(radiusMm / Math.max(spacing[1], 0.001)),
    ];
  }
  if (axis === VolumeAxis.Coronal) {
    return [
      Math.ceil(radiusMm / Math.max(spacing[0], 0.001)),
      Math.ceil(radiusMm / Math.max(spacing[2], 0.001)),
    ];
  }
  return [
    Math.ceil(radiusMm / Math.max(spacing[1], 0.001)),
    Math.ceil(radiusMm / Math.max(spacing[2], 0.001)),
  ];
}

function planeVoxel(
  axis: VolumeAxis,
  center: [number, number, number],
  du: number,
  dv: number,
): [number, number, number] {
  if (axis === VolumeAxis.Axial) return [center[0] + du, center[1] + dv, center[2]];
  if (axis === VolumeAxis.Coronal) return [center[0] + du, center[1], center[2] + dv];
  return [center[0], center[1] + du, center[2] + dv];
}

export function paintLabelmapAtVoxel(
  labelmap: Uint16Array,
  center: [number, number, number],
  touched: Set<number>,
  options: LabelmapBrushOptions,
): void {
  const [width, height, depth] = options.dimensions;
  const [ru, rv] = inPlaneRadii(options.axis, options.spacing, options.brushSizeMm);
  const radius = Math.max(0.25, options.brushSizeMm / 2);
  const lockedValues = options.lockedValues ?? new Set<number>();

  for (let dv = -rv; dv <= rv; dv += 1) {
    for (let du = -ru; du <= ru; du += 1) {
      const [x, y, z] = planeVoxel(options.axis, center, du, dv);
      if (x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= depth) {
        continue;
      }
      if (options.brushShape === 'circle') {
        const mm =
          options.axis === VolumeAxis.Axial
            ? Math.hypot(du * options.spacing[0], dv * options.spacing[1])
            : options.axis === VolumeAxis.Coronal
              ? Math.hypot(du * options.spacing[0], dv * options.spacing[2])
              : Math.hypot(du * options.spacing[1], dv * options.spacing[2]);
        if (mm > radius) continue;
      }

      const index = (z * height + y) * width + x;
      const currentValue = labelmap[index];
      if (currentValue !== options.segmentValue && lockedValues.has(currentValue)) {
        continue;
      }

      if (options.operation === 'erase') {
        labelmap[index] = currentValue === options.segmentValue ? 0 : currentValue;
      } else if (options.operation === 'threshold') {
        const value = options.voxels?.[index] ?? 0;
        const [min, max] = options.thresholdRange;
        if (value >= min && value <= max) labelmap[index] = options.segmentValue;
      } else {
        labelmap[index] = options.segmentValue;
      }
      touched.add(index);
    }
  }
}

export function paintLabelmapStroke(
  labelmap: Uint16Array,
  from: [number, number, number] | undefined,
  to: [number, number, number],
  touched: Set<number>,
  options: LabelmapBrushOptions,
): void {
  const start = from ?? to;
  const steps = Math.max(
    Math.abs(to[0] - start[0]),
    Math.abs(to[1] - start[1]),
    Math.abs(to[2] - start[2]),
    1,
  );
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    paintLabelmapAtVoxel(
      labelmap,
      [
        Math.round(start[0] + (to[0] - start[0]) * ratio),
        Math.round(start[1] + (to[1] - start[1]) * ratio),
        Math.round(start[2] + (to[2] - start[2]) * ratio),
      ],
      touched,
      options,
    );
  }
}

export function labelmapToMask(labelmap: Uint16Array, value: number): Uint8Array {
  const mask = new Uint8Array(labelmap.length);
  for (let index = 0; index < labelmap.length; index += 1) {
    if (labelmap[index] === value) mask[index] = 1;
  }
  return mask;
}
