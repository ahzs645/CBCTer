import type { LoadedVolume, Vec3 } from '../../types';

/**
 * Axis-aligned region of interest in volume voxel coordinates.
 * `min` is inclusive, `max` is exclusive, both as [x, y, z] where
 * x indexes width, y height, z depth (matching the loaded volume).
 */
export interface ToothRoi {
  min: Vec3;
  max: Vec3;
}

export function clampRoi(roi: ToothRoi, dimensions: Vec3): ToothRoi {
  const clampAxis = (value: number, axis: number) =>
    Math.max(0, Math.min(dimensions[axis], Math.round(value)));

  const min: Vec3 = [
    clampAxis(roi.min[0], 0),
    clampAxis(roi.min[1], 1),
    clampAxis(roi.min[2], 2),
  ];
  const max: Vec3 = [
    Math.max(min[0] + 1, clampAxis(roi.max[0], 0)),
    Math.max(min[1] + 1, clampAxis(roi.max[1], 1)),
    Math.max(min[2] + 1, clampAxis(roi.max[2], 2)),
  ];
  return { min, max };
}

export interface ExtractedCrop {
  /** Float32 voxels in [depth, height, width] order. */
  data: Float32Array;
  /** [depthCount, heightCount, widthCount]. */
  dims: [number, number, number];
}

/**
 * Copy the ROI sub-volume into a contiguous Float32Array laid out as
 * [D, H, W] (z outer, x inner) to match the reference numpy pipeline.
 */
export function extractCropFloat32(
  volume: LoadedVolume,
  roi: ToothRoi,
): ExtractedCrop {
  const [width, height] = volume.meta.dimensions;
  const [x0, y0, z0] = roi.min;
  const [x1, y1, z1] = roi.max;
  const cw = x1 - x0;
  const ch = y1 - y0;
  const cd = z1 - z0;
  const data = new Float32Array(cw * ch * cd);
  const sliceStride = width * height;

  let out = 0;
  for (let z = z0; z < z1; z += 1) {
    const zBase = z * sliceStride;
    for (let y = y0; y < y1; y += 1) {
      const rowBase = zBase + y * width;
      for (let x = x0; x < x1; x += 1) {
        data[out] = volume.voxels[rowBase + x] ?? 0;
        out += 1;
      }
    }
  }

  return { data, dims: [cd, ch, cw] };
}
