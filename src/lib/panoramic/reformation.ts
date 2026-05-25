import type { Vec3 } from '../../types';
import { clamp } from '../volume/math';
import type { ArchPolyline, PanoramicOptions, PanoramicResult } from './types';
import { dims } from './types';

const LUT_SIZE = 65536;
const LUT_OFFSET = 32768;

function buildGrayLut(window: number, level: number): Uint8Array {
  const table = new Uint8Array(LUT_SIZE);
  const low = level - window / 2;
  const w = Math.max(1, window);
  for (let raw = 0; raw < LUT_SIZE; raw += 1) {
    const value = raw - LUT_OFFSET;
    const normalized = (value - low) / w;
    table[raw] = Math.round(clamp(normalized, 0, 1) * 255);
  }
  return table;
}

/**
 * Curved planar reformation: "unroll" the volume along the arch into a flat
 * panoramic image. For every arch sample (output column) and every axial
 * slice in the z-band (output row), the volume is sampled across a
 * buccal-lingual band along the arch normal and combined by MIP or mean.
 *
 * The arch position and band offsets are independent of z, so the in-plane
 * sample coordinates and bilinear weights are precomputed once per column and
 * reused down every row — the inner loop is a handful of array reads.
 */
export function reformat(
  voxels: Int16Array,
  dimensions: Vec3,
  spacing: Vec3,
  arch: ArchPolyline,
  options: PanoramicOptions,
  onProgress?: (fraction: number) => void,
): PanoramicResult {
  const { width: vw, height: vh, depth: vd } = dims(dimensions);
  const [sx, sy, sz] = spacing;
  const sliceStride = vw * vh;

  const outWidth = arch.samples.length;
  const z0 = clamp(Math.round(Math.min(options.zMin, options.zMax)), 0, vd - 1);
  const z1 = clamp(Math.round(Math.max(options.zMin, options.zMax)), 0, vd - 1);
  const outHeight = z1 - z0 + 1;

  if (outWidth < 2 || outHeight < 1) {
    return {
      data: new Uint8ClampedArray(0),
      width: 0,
      height: 0,
      mmPerPixelX: arch.stepMm,
      mmPerPixelY: sz,
    };
  }

  // Band offsets in mm, symmetric about the arch.
  const step = Math.max(0.05, options.depthStepMm);
  const bandCount = Math.max(1, Math.floor((2 * options.depthMm) / step) + 1);
  const offsets: number[] = [];
  for (let b = 0; b < bandCount; b += 1) {
    offsets.push(-options.depthMm + b * step);
  }

  // Precompute, per (column, band) sample, the bilinear corner offsets within
  // a slice plus weights. Stored flat: 4 indices + 4 weights per entry.
  const perColumn = bandCount;
  const idxBuf = new Int32Array(outWidth * perColumn * 4);
  const wBuf = new Float32Array(outWidth * perColumn * 4);
  const valid = new Uint8Array(outWidth * perColumn);

  for (let i = 0; i < outWidth; i += 1) {
    const s = arch.samples[i];
    for (let b = 0; b < perColumn; b += 1) {
      const off = offsets[b];
      // Position in mm, then back to voxel coords for in-plane sampling.
      const mmX = s.x + s.nx * off;
      const mmY = s.y + s.ny * off;
      const vx = mmX / sx;
      const vy = mmY / sy;
      const slot = (i * perColumn + b) * 4;
      const flat = i * perColumn + b;
      if (vx < 0 || vy < 0 || vx > vw - 1 || vy > vh - 1) {
        valid[flat] = 0;
        continue;
      }
      const x0 = Math.floor(vx);
      const y0 = Math.floor(vy);
      const x1 = Math.min(x0 + 1, vw - 1);
      const y1 = Math.min(y0 + 1, vh - 1);
      const fx = vx - x0;
      const fy = vy - y0;
      idxBuf[slot] = y0 * vw + x0;
      idxBuf[slot + 1] = y0 * vw + x1;
      idxBuf[slot + 2] = y1 * vw + x0;
      idxBuf[slot + 3] = y1 * vw + x1;
      wBuf[slot] = (1 - fx) * (1 - fy);
      wBuf[slot + 1] = fx * (1 - fy);
      wBuf[slot + 2] = (1 - fx) * fy;
      wBuf[slot + 3] = fx * fy;
      valid[flat] = 1;
    }
  }

  const lut = buildGrayLut(options.window, options.level);
  const data = new Uint8ClampedArray(outWidth * outHeight * 4);
  const useMean = options.projection === 'mean';

  // Row r (top) maps to the highest z, matching the coronal display convention.
  for (let r = 0; r < outHeight; r += 1) {
    const z = z1 - r;
    const sliceBase = z * sliceStride;
    const rowOut = r * outWidth * 4;
    for (let i = 0; i < outWidth; i += 1) {
      let acc = useMean ? 0 : -32768;
      let denom = 0;
      for (let b = 0; b < perColumn; b += 1) {
        const flat = i * perColumn + b;
        if (!valid[flat]) continue;
        const slot = flat * 4;
        const sample =
          voxels[sliceBase + idxBuf[slot]] * wBuf[slot] +
          voxels[sliceBase + idxBuf[slot + 1]] * wBuf[slot + 1] +
          voxels[sliceBase + idxBuf[slot + 2]] * wBuf[slot + 2] +
          voxels[sliceBase + idxBuf[slot + 3]] * wBuf[slot + 3];
        if (useMean) {
          acc += sample;
          denom += 1;
        } else if (sample > acc) {
          acc = sample;
        }
      }
      const projected = useMean ? (denom > 0 ? acc / denom : -32768) : acc;
      const gray = lut[clamp(Math.round(projected) + LUT_OFFSET, 0, LUT_SIZE - 1)];
      const px = rowOut + i * 4;
      data[px] = gray;
      data[px + 1] = gray;
      data[px + 2] = gray;
      data[px + 3] = 255;
    }
    if (onProgress && (r & 15) === 0) onProgress(r / outHeight);
  }
  onProgress?.(1);

  return {
    data,
    width: outWidth,
    height: outHeight,
    mmPerPixelX: arch.stepMm,
    mmPerPixelY: sz,
  };
}
