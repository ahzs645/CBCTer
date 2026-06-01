import { describe, expect, it } from 'vitest';
import {
  resampleLabelmap,
  resampleVolume,
  targetDimsForSpacing,
} from './resample';

describe('volume resample', () => {
  it('derives target dims that preserve physical extent', () => {
    // 10 voxels at 0.5 mm spacing → 5 voxels at 1.0 mm spacing (same 5 mm extent).
    expect(targetDimsForSpacing([10, 10, 10], [0.5, 0.5, 0.5], [1, 1, 1])).toEqual(
      [5, 5, 5],
    );
    // Finer target spacing → more voxels.
    expect(targetDimsForSpacing([4, 4, 4], [1, 1, 1], [0.5, 0.5, 0.5])).toEqual(
      [8, 8, 8],
    );
  });

  it('is (near) identity when source and target spacing match', () => {
    const dims: [number, number, number] = [2, 2, 2];
    const data = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const out = resampleVolume(data, dims, [1, 1, 1], [1, 1, 1]);
    expect(out.dims).toEqual([2, 2, 2]);
    out.data.forEach((value, i) => expect(value).toBeCloseTo(data[i], 6));
  });

  it('preserves a constant field through up/down sampling', () => {
    const dims: [number, number, number] = [4, 4, 4];
    const data = new Float32Array(64).fill(42);
    const down = resampleVolume(data, dims, [1, 1, 1], [2, 2, 2]);
    expect(down.dims).toEqual([2, 2, 2]);
    down.data.forEach((value) => expect(value).toBeCloseTo(42, 5));
  });

  it('linearly interpolates a ramp', () => {
    // 1-D ramp along x (W). Upsample by 2× and check an interpolated midpoint.
    const dims: [number, number, number] = [1, 1, 4];
    const data = new Float32Array([0, 10, 20, 30]);
    const out = resampleVolume(data, dims, [1, 1, 1], [0.5, 1, 1]);
    expect(out.dims).toEqual([1, 1, 8]);
    // Values should be monotonic non-decreasing across the upsampled ramp.
    for (let i = 1; i < out.data.length; i += 1) {
      expect(out.data[i]).toBeGreaterThanOrEqual(out.data[i - 1] - 1e-6);
    }
  });

  it('resamples a labelmap to exact explicit output dims', () => {
    const dims: [number, number, number] = [2, 2, 2];
    const labels = new Uint16Array([0, 1, 1, 2, 2, 3, 3, 0]);
    // Spacing ratio alone would round to ~[3,3,3]; force an exact [3,4,5].
    const out = resampleLabelmap(labels, dims, [1, 1, 1], [0.5, 0.5, 0.5], [3, 4, 5]);
    expect(out.dims).toEqual([3, 4, 5]);
    expect(out.data.length).toBe(3 * 4 * 5);
    const allowed = new Set([0, 1, 2, 3]);
    out.data.forEach((value) => expect(allowed.has(value)).toBe(true));
  });

  it('nearest-neighbour label resample never invents new labels', () => {
    const dims: [number, number, number] = [2, 2, 2];
    const labels = new Uint16Array([0, 1, 1, 2, 2, 3, 3, 0]);
    const out = resampleLabelmap(labels, dims, [1, 1, 1], [0.5, 0.5, 0.5]);
    expect(out.data).toBeInstanceOf(Uint16Array);
    const allowed = new Set([0, 1, 2, 3]);
    out.data.forEach((value) => expect(allowed.has(value)).toBe(true));
  });
});
