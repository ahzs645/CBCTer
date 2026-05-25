import type { Vec3 } from '../../types';
import { clamp } from '../volume/math';
import type { ArchCurve } from './types';
import { dims } from './types';

const SEED_CONTROL_POINTS = 7;

export interface AxialMip {
  /** Max intensity over the z-band, row-major [height][width]. */
  data: Int16Array;
  width: number;
  height: number;
  min: number;
  max: number;
}

/** Maximum-intensity projection across an inclusive axial slice band. */
export function buildAxialMip(
  voxels: Int16Array,
  dimensions: Vec3,
  zMin: number,
  zMax: number,
): AxialMip {
  const { width, height, depth } = dims(dimensions);
  const z0 = clamp(Math.round(Math.min(zMin, zMax)), 0, depth - 1);
  const z1 = clamp(Math.round(Math.max(zMin, zMax)), 0, depth - 1);
  const sliceStride = width * height;
  const data = new Int16Array(width * height);
  data.fill(-32768);
  let min = 32767;
  let max = -32768;

  for (let z = z0; z <= z1; z += 1) {
    const base = z * sliceStride;
    for (let i = 0; i < sliceStride; i += 1) {
      const v = voxels[base + i];
      if (v > data[i]) data[i] = v;
    }
  }
  for (let i = 0; i < sliceStride; i += 1) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { data, width, height, min, max };
}

/** Solve a 3x3 linear system by Gaussian elimination; null if singular. */
function solve3(
  m: number[][],
  b: number[],
): [number, number, number] | null {
  const a = m.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < 3; r += 1) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < 3; r += 1) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c < 4; c += 1) a[r][c] -= f * a[col][c];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

/**
 * Auto-seed the arch curve from a bone/tooth MIP. Bright pixels above an
 * intensity threshold are fit with an intensity-weighted quadratic y = f(x);
 * the curve is then sampled at evenly spaced x to produce editable control
 * points. Falls back to a centred default parabola when too little bone is
 * visible, so the result is never empty.
 */
export function autoFitArch(
  voxels: Int16Array,
  dimensions: Vec3,
  zMin: number,
  zMax: number,
): ArchCurve {
  const mip = buildAxialMip(voxels, dimensions, zMin, zMax);
  const { width, height } = mip;
  const threshold = mip.min + 0.55 * (mip.max - mip.min);

  // Intensity-weighted normal-equation accumulators for y = a x^2 + b x + c.
  let s0 = 0;
  let sx = 0;
  let sx2 = 0;
  let sx3 = 0;
  let sx4 = 0;
  let sy = 0;
  let sxy = 0;
  let sx2y = 0;
  let xLo = width;
  let xHi = 0;
  let count = 0;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const v = mip.data[row + x];
      if (v < threshold) continue;
      const w = v - threshold;
      const x2 = x * x;
      s0 += w;
      sx += w * x;
      sx2 += w * x2;
      sx3 += w * x2 * x;
      sx4 += w * x2 * x2;
      sy += w * y;
      sxy += w * x * y;
      sx2y += w * x2 * y;
      if (x < xLo) xLo = x;
      if (x > xHi) xHi = x;
      count += 1;
    }
  }

  const coeffs =
    count >= 32
      ? solve3(
          [
            [sx4, sx3, sx2],
            [sx3, sx2, sx],
            [sx2, sx, s0],
          ],
          [sx2y, sxy, sy],
        )
      : null;

  const controlPoints: ArchCurve['controlPoints'] = [];
  if (coeffs) {
    const [a, b, c] = coeffs;
    const span = Math.max(1, xHi - xLo);
    for (let i = 0; i < SEED_CONTROL_POINTS; i += 1) {
      const x = xLo + (span * i) / (SEED_CONTROL_POINTS - 1);
      const y = clamp(a * x * x + b * x + c, 0, height - 1);
      controlPoints.push({ x, y });
    }
  } else {
    // Fallback: a gentle parabola across the central two-thirds of the slice.
    const x0 = width * 0.2;
    const x1 = width * 0.8;
    const apex = height * 0.45;
    const depthY = height * 0.18;
    for (let i = 0; i < SEED_CONTROL_POINTS; i += 1) {
      const t = i / (SEED_CONTROL_POINTS - 1);
      const x = x0 + (x1 - x0) * t;
      const norm = (t - 0.5) * 2;
      const y = apex + depthY * (1 - norm * norm);
      controlPoints.push({ x, y });
    }
  }

  return { controlPoints };
}
