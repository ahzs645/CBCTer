/**
 * Voxel-grid resampling between physical spacings — the one preprocessing
 * primitive CBCTer lacked. Every nnU-Net port (DentalSegmentator, AMASSS)
 * expects its input resampled to the model's training spacing, and the result
 * resampled back to the source grid. Intensity volumes use trilinear sampling;
 * label volumes use nearest-neighbour so label values are never blended.
 *
 * Conventions match the rest of the codebase: `dims` is `[depth, height, width]`
 * (z, y, x) and `spacing` is `[x, y, z]` in millimetres.
 */
import type { Vec3 } from '../../types';

export type Interpolation = 'linear' | 'nearest';

export interface ResampledVolume {
  /** Resampled voxels in `[depth, height, width]` order. */
  data: Float32Array;
  /** `[depth, height, width]` of the resampled grid. */
  dims: [number, number, number];
  /** Spacing of the resampled grid `[x, y, z]` (equals the requested target). */
  spacing: Vec3;
}

const clampIndex = (value: number, max: number): number =>
  value < 0 ? 0 : value > max ? max : value;

/** Output grid size that preserves physical extent when changing spacing. */
export function targetDimsForSpacing(
  dims: [number, number, number],
  srcSpacing: Vec3,
  dstSpacing: Vec3,
): [number, number, number] {
  const [d, h, w] = dims;
  return [
    Math.max(1, Math.round((d * srcSpacing[2]) / dstSpacing[2])),
    Math.max(1, Math.round((h * srcSpacing[1]) / dstSpacing[1])),
    Math.max(1, Math.round((w * srcSpacing[0]) / dstSpacing[0])),
  ];
}

/**
 * Resample a scalar volume from `srcSpacing` to `dstSpacing`. Output grid size
 * is derived to keep the physical field of view constant. Uses align-corners-off
 * voxel-center mapping (`src = (out + 0.5)·ratio − 0.5`).
 */
export function resampleVolume(
  data: ArrayLike<number>,
  dims: [number, number, number],
  srcSpacing: Vec3,
  dstSpacing: Vec3,
  interpolation: Interpolation = 'linear',
  /** Force an exact output grid (e.g. resampling a labelmap back onto the
   * source grid); otherwise derived from the spacing ratio. */
  outputDims?: [number, number, number],
): ResampledVolume {
  const [sd, sh, sw] = dims;
  const [od, oh, ow] =
    outputDims ?? targetDimsForSpacing(dims, srcSpacing, dstSpacing);

  // Map output→source by the actual grid sizes so the sampling spans the same
  // field of view exactly (correct even when outputDims is given explicitly).
  const ratioX = sw / ow;
  const ratioY = sh / oh;
  const ratioZ = sd / od;

  const out = new Float32Array(od * oh * ow);
  const sliceStride = sw * sh;

  let outIndex = 0;
  for (let oz = 0; oz < od; oz += 1) {
    const srcZ = (oz + 0.5) * ratioZ - 0.5;
    for (let oy = 0; oy < oh; oy += 1) {
      const srcY = (oy + 0.5) * ratioY - 0.5;
      for (let ox = 0; ox < ow; ox += 1) {
        const srcX = (ox + 0.5) * ratioX - 0.5;
        out[outIndex] =
          interpolation === 'nearest'
            ? data[
                clampIndex(Math.round(srcZ), sd - 1) * sliceStride +
                  clampIndex(Math.round(srcY), sh - 1) * sw +
                  clampIndex(Math.round(srcX), sw - 1)
              ]
            : trilinear(data, srcX, srcY, srcZ, sw, sh, sd);
        outIndex += 1;
      }
    }
  }

  return { data: out, dims: [od, oh, ow], spacing: [...dstSpacing] };
}

function trilinear(
  data: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;

  const x0c = clampIndex(x0, w - 1);
  const x1c = clampIndex(x0 + 1, w - 1);
  const y0c = clampIndex(y0, h - 1);
  const y1c = clampIndex(y0 + 1, h - 1);
  const z0c = clampIndex(z0, d - 1);
  const z1c = clampIndex(z0 + 1, d - 1);

  const slice = w * h;
  const c000 = data[z0c * slice + y0c * w + x0c];
  const c100 = data[z0c * slice + y0c * w + x1c];
  const c010 = data[z0c * slice + y1c * w + x0c];
  const c110 = data[z0c * slice + y1c * w + x1c];
  const c001 = data[z1c * slice + y0c * w + x0c];
  const c101 = data[z1c * slice + y0c * w + x1c];
  const c011 = data[z1c * slice + y1c * w + x0c];
  const c111 = data[z1c * slice + y1c * w + x1c];

  const c00 = c000 * (1 - fx) + c100 * fx;
  const c10 = c010 * (1 - fx) + c110 * fx;
  const c01 = c001 * (1 - fx) + c101 * fx;
  const c11 = c011 * (1 - fx) + c111 * fx;
  const c0 = c00 * (1 - fy) + c10 * fy;
  const c1 = c01 * (1 - fy) + c11 * fy;
  return c0 * (1 - fz) + c1 * fz;
}

/**
 * Nearest-neighbour resample of a label volume, preserving exact label values.
 * Returns the same integer-array constructor as the input.
 */
export function resampleLabelmap<T extends Uint8Array | Uint16Array | Int16Array>(
  labelmap: T,
  dims: [number, number, number],
  srcSpacing: Vec3,
  dstSpacing: Vec3,
  outputDims?: [number, number, number],
): { data: T; dims: [number, number, number]; spacing: Vec3 } {
  const { data: floatData, dims: outDims, spacing } = resampleVolume(
    labelmap,
    dims,
    srcSpacing,
    dstSpacing,
    'nearest',
    outputDims,
  );
  let out: Uint8Array | Uint16Array | Int16Array;
  if (labelmap instanceof Uint8Array) out = new Uint8Array(floatData.length);
  else if (labelmap instanceof Int16Array) out = new Int16Array(floatData.length);
  else out = new Uint16Array(floatData.length);
  for (let i = 0; i < floatData.length; i += 1) out[i] = floatData[i];
  return { data: out as unknown as T, dims: outDims, spacing };
}
