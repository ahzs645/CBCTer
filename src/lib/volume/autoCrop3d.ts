/**
 * AutoCrop3D — crop a volume to a physical (millimetre) region of interest and
 * re-embed cropped results back into the full grid. Ported from SADT's
 * AutoCrop3D module, which applies the *same* physical ROI to a folder of CBCT
 * scans so a batch shares one field of view.
 *
 * CBCTer's existing `roi.ts` works in voxel coordinates; this adds the physical
 * layer: convert an mm box to a voxel box given `spacing`/`origin`, crop, and
 * track the new origin so downstream geometry (landmarks, transforms, meshing)
 * stays registered. Re-embedding lets a prediction computed on the crop be
 * written back into the original grid.
 *
 * Conventions: `dimensions` is `[width, height, depth]` (matching the loaded
 * volume meta), data is laid out `[z, y, x]`, `spacing`/`origin` are `[x, y, z]`
 * in millimetres. A voxel box is a {@link ToothRoi} (`min` inclusive, `max`
 * exclusive).
 */
import type { Vec3 } from '../../types';
import { clampRoi, type ToothRoi } from '../segmentation/roi';

/** Axis-aligned region of interest in world millimetres. */
export interface PhysicalRoi {
  /** Lower corner `[x, y, z]` in millimetres. */
  minMm: Vec3;
  /** Upper corner `[x, y, z]` in millimetres. */
  maxMm: Vec3;
}

/**
 * Convert a physical-mm ROI to a clamped voxel ROI. The box is expanded to whole
 * voxels (floor of the lower corner, ceil of the upper) so the requested extent
 * is fully covered, then clamped to the grid.
 */
export function physicalRoiToVoxel(
  roi: PhysicalRoi,
  dimensions: Vec3,
  spacing: Vec3,
  origin: Vec3 = [0, 0, 0],
): ToothRoi {
  const toVoxel = (mm: number, axis: number) =>
    (mm - origin[axis]) / spacing[axis];
  // Normalise so min ≤ max regardless of how the corners were supplied.
  const lo: Vec3 = [
    Math.min(roi.minMm[0], roi.maxMm[0]),
    Math.min(roi.minMm[1], roi.maxMm[1]),
    Math.min(roi.minMm[2], roi.maxMm[2]),
  ];
  const hi: Vec3 = [
    Math.max(roi.minMm[0], roi.maxMm[0]),
    Math.max(roi.minMm[1], roi.maxMm[1]),
    Math.max(roi.minMm[2], roi.maxMm[2]),
  ];
  const min: Vec3 = [
    Math.floor(toVoxel(lo[0], 0)),
    Math.floor(toVoxel(lo[1], 1)),
    Math.floor(toVoxel(lo[2], 2)),
  ];
  const max: Vec3 = [
    Math.ceil(toVoxel(hi[0], 0)),
    Math.ceil(toVoxel(hi[1], 1)),
    Math.ceil(toVoxel(hi[2], 2)),
  ];
  return clampRoi({ min, max }, dimensions);
}

export interface CroppedVolume<T> {
  /** Cropped voxels in `[z, y, x]` order (same constructor as the input). */
  data: T;
  /** New `[width, height, depth]`. */
  dimensions: Vec3;
  /** World origin `[x, y, z]` of voxel (0,0,0) of the crop, in millimetres. */
  origin: Vec3;
  /** The voxel ROI that was extracted (post-clamp). */
  roi: ToothRoi;
}

type TypedArray = Int16Array | Uint16Array | Uint8Array | Float32Array;

function emptyLike<T extends TypedArray>(sample: T, length: number): T {
  if (sample instanceof Int16Array) return new Int16Array(length) as T;
  if (sample instanceof Uint16Array) return new Uint16Array(length) as T;
  if (sample instanceof Uint8Array) return new Uint8Array(length) as T;
  return new Float32Array(length) as T;
}

/**
 * Crop a voxel ROI out of a `[z, y, x]` volume, returning a new contiguous array
 * plus the shifted origin so the crop stays registered in world space.
 */
export function cropVolume<T extends TypedArray>(
  data: T,
  dimensions: Vec3,
  roi: ToothRoi,
  spacing: Vec3,
  origin: Vec3 = [0, 0, 0],
): CroppedVolume<T> {
  const clamped = clampRoi(roi, dimensions);
  const [width, height] = dimensions;
  const [x0, y0, z0] = clamped.min;
  const [x1, y1, z1] = clamped.max;
  const cw = x1 - x0;
  const ch = y1 - y0;
  const cd = z1 - z0;
  const out = emptyLike(data, cw * ch * cd);
  const sliceStride = width * height;

  let o = 0;
  for (let z = z0; z < z1; z += 1) {
    const zBase = z * sliceStride;
    for (let y = y0; y < y1; y += 1) {
      const rowBase = zBase + y * width;
      for (let x = x0; x < x1; x += 1) {
        out[o] = data[rowBase + x];
        o += 1;
      }
    }
  }

  const newOrigin: Vec3 = [
    origin[0] + x0 * spacing[0],
    origin[1] + y0 * spacing[1],
    origin[2] + z0 * spacing[2],
  ];
  return {
    data: out,
    dimensions: [cw, ch, cd],
    origin: newOrigin,
    roi: clamped,
  };
}

/** Crop straight from a physical-mm ROI (convenience over the two steps above). */
export function cropVolumePhysical<T extends TypedArray>(
  data: T,
  dimensions: Vec3,
  roi: PhysicalRoi,
  spacing: Vec3,
  origin: Vec3 = [0, 0, 0],
): CroppedVolume<T> {
  const voxelRoi = physicalRoiToVoxel(roi, dimensions, spacing, origin);
  return cropVolume(data, dimensions, voxelRoi, spacing, origin);
}

/**
 * Write a cropped array back into a full-size grid at the ROI offset (inverse of
 * {@link cropVolume}). Used to place a prediction computed on a crop into the
 * original volume's coordinate frame. Voxels outside the ROI keep `fill`.
 */
export function embedCrop<T extends TypedArray>(
  crop: T,
  cropDimensions: Vec3,
  fullDimensions: Vec3,
  roi: ToothRoi,
  fill = 0,
): T {
  const [fw, fh, fd] = fullDimensions;
  const full = emptyLike(crop, fw * fh * fd);
  if (fill !== 0) full.fill(fill as never);

  const clamped = clampRoi(roi, fullDimensions);
  const [cw, ch, cd] = cropDimensions;
  const [x0, y0, z0] = clamped.min;
  const fullSlice = fw * fh;
  const cropSlice = cw * ch;

  const zEnd = Math.min(cd, fd - z0);
  const yEnd = Math.min(ch, fh - y0);
  const xEnd = Math.min(cw, fw - x0);
  for (let z = 0; z < zEnd; z += 1) {
    for (let y = 0; y < yEnd; y += 1) {
      const cropRow = z * cropSlice + y * cw;
      const fullRow = (z0 + z) * fullSlice + (y0 + y) * fw + x0;
      for (let x = 0; x < xEnd; x += 1) {
        full[fullRow + x] = crop[cropRow + x];
      }
    }
  }
  return full;
}
