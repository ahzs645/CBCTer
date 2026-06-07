/**
 * AutoMatrix — apply a 4x4 affine transform to landmark sets and to whole
 * volumes. Ported from SADT's AutoMatrix module, which batch-applies ITK
 * transform matrices to CBCT scans, IOS meshes, and landmark files.
 *
 * Two coordinate frames are involved:
 *  - **world / physical** millimetres, where a transform read from an ITK `.tfm`
 *    (see {@link parseItkTransform}) or solved by {@link absoluteOrientation}
 *    lives. The voxel→world map is `world = origin + diag(spacing) · voxel`.
 *  - **voxel** indices, where the volume data is sampled.
 *
 * Landmarks are usually already in world space, so {@link applyMatrixToLandmarks}
 * applies the matrix directly. Resampling a volume happens in voxel space, so
 * {@link worldToVoxelMatrix} converts a world transform into the equivalent
 * voxel transform before {@link resampleVolumeWithMatrix} inverse-maps it.
 *
 * Conventions match the rest of the codebase: `dims` is `[depth, height, width]`
 * (z, y, x), data is laid out `[z, y, x]`, points/spacing/origin are `[x, y, z]`.
 */
import type { Vec3 } from '../../types';
import type { Interpolation } from '../volume/resample';
import type { Landmark } from '../io/slicerMarkups';
import {
  applyMat4ToPoint,
  identityMat4,
  invertMat4,
  multiplyMat4,
  type Mat4,
} from './transformMatrix';

/** Apply an affine to every landmark, preserving labels/ids/descriptions. */
export function applyMatrixToLandmarks(
  landmarks: Landmark[],
  matrix: Mat4,
): Landmark[] {
  return landmarks.map((landmark) => ({
    ...landmark,
    position: applyMat4ToPoint(matrix, landmark.position),
  }));
}

/** Homogeneous voxel→world map `world = origin + diag(spacing) · voxel`. */
export function voxelToWorldMatrix(spacing: Vec3, origin: Vec3 = [0, 0, 0]): Mat4 {
  return [
    spacing[0], 0, 0, origin[0],
    0, spacing[1], 0, origin[1],
    0, 0, spacing[2], origin[2],
    0, 0, 0, 1,
  ];
}

/**
 * Convert a transform expressed in world (mm) space into the equivalent
 * transform in voxel space: `T_voxel = W⁻¹ · T_world · W`, where `W` is the
 * voxel→world map. Use this before {@link resampleVolumeWithMatrix} when the
 * matrix came from a `.tfm` / landmark solve (which are in millimetres).
 */
export function worldToVoxelMatrix(
  worldMatrix: Mat4,
  spacing: Vec3,
  origin: Vec3 = [0, 0, 0],
): Mat4 {
  const w = voxelToWorldMatrix(spacing, origin);
  const wInv = invertMat4(w);
  if (!wInv) return identityMat4();
  return multiplyMat4(multiplyMat4(wInv, worldMatrix), w);
}

const clampIndex = (value: number, max: number): number =>
  value < 0 ? 0 : value > max ? max : value;

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

export interface ResampleMatrixOptions {
  /** `'linear'` for intensity volumes (default), `'nearest'` for labelmaps. */
  interpolation?: Interpolation;
  /** Output grid `[depth, height, width]`; defaults to the input grid. */
  outputDims?: [number, number, number];
  /** Value for samples that map outside the input grid. Default `0`. */
  fill?: number;
}

export interface ResampledMatrixVolume {
  /** Resampled voxels in `[depth, height, width]` order. */
  data: Float32Array;
  /** `[depth, height, width]` of the output grid. */
  dims: [number, number, number];
}

/**
 * Resample a volume under a voxel-space affine. Each output voxel `o` is mapped
 * back through `matrix⁻¹` to a source location which is sampled from the input
 * (inverse warping, so the output is fully covered with no holes). Samples that
 * fall outside the input grid take `options.fill`.
 *
 * `matrix` maps **source → output** voxel coordinates (i.e. it is the transform
 * you want applied to the image content); the function inverts it internally.
 */
export function resampleVolumeWithMatrix(
  data: ArrayLike<number>,
  dims: [number, number, number],
  matrix: Mat4,
  options: ResampleMatrixOptions = {},
): ResampledMatrixVolume {
  const { interpolation = 'linear', fill = 0 } = options;
  const [sd, sh, sw] = dims;
  const [od, oh, ow] = options.outputDims ?? dims;
  const inverse = invertMat4(matrix);
  if (!inverse) {
    throw new Error('resampleVolumeWithMatrix: transform is not invertible.');
  }

  const out = new Float32Array(od * oh * ow);
  const sliceStride = sw * sh;
  let outIndex = 0;
  for (let oz = 0; oz < od; oz += 1) {
    for (let oy = 0; oy < oh; oy += 1) {
      for (let ox = 0; ox < ow; ox += 1) {
        // Output voxel (x, y, z) → source voxel via the inverse transform.
        const [sx, sy, sz] = applyMat4ToPoint(inverse, [ox, oy, oz]);
        if (
          sx < -0.5 || sx > sw - 0.5 ||
          sy < -0.5 || sy > sh - 0.5 ||
          sz < -0.5 || sz > sd - 0.5
        ) {
          out[outIndex] = fill;
        } else if (interpolation === 'nearest') {
          out[outIndex] =
            data[
              clampIndex(Math.round(sz), sd - 1) * sliceStride +
                clampIndex(Math.round(sy), sh - 1) * sw +
                clampIndex(Math.round(sx), sw - 1)
            ];
        } else {
          out[outIndex] = trilinear(data, sx, sy, sz, sw, sh, sd);
        }
        outIndex += 1;
      }
    }
  }

  return { data: out, dims: [od, oh, ow] };
}

/**
 * Convenience wrapper for labelmaps: nearest-neighbour resample preserving the
 * input integer-array constructor.
 */
export function resampleLabelmapWithMatrix<
  T extends Uint8Array | Uint16Array | Int16Array,
>(
  labelmap: T,
  dims: [number, number, number],
  matrix: Mat4,
  options: Omit<ResampleMatrixOptions, 'interpolation'> = {},
): { data: T; dims: [number, number, number] } {
  const { data: floatData, dims: outDims } = resampleVolumeWithMatrix(
    labelmap,
    dims,
    matrix,
    { ...options, interpolation: 'nearest' },
  );
  let out: Uint8Array | Uint16Array | Int16Array;
  if (labelmap instanceof Uint8Array) out = new Uint8Array(floatData.length);
  else if (labelmap instanceof Int16Array) out = new Int16Array(floatData.length);
  else out = new Uint16Array(floatData.length);
  for (let i = 0; i < floatData.length; i += 1) out[i] = floatData[i];
  return { data: out as unknown as T, dims: outDims };
}
