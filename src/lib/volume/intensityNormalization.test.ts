import { describe, expect, it } from 'vitest';
import {
  ctNormalize,
  percentileNormalize,
  zScoreNormalize,
  type CtNormalizationParams,
} from './intensityNormalization';

describe('intensity normalization', () => {
  it('ctNormalize clips to the window then standardises', () => {
    const params: CtNormalizationParams = {
      lowerBound: -100,
      upperBound: 100,
      mean: 0,
      std: 50,
    };
    const out = ctNormalize([-500, 0, 50, 5000], params);
    // -500 clipped to -100 → -2; 0 → 0; 50 → 1; 5000 clipped to 100 → 2.
    expect(out[0]).toBeCloseTo(-2);
    expect(out[1]).toBeCloseTo(0);
    expect(out[2]).toBeCloseTo(1);
    expect(out[3]).toBeCloseTo(2);
  });

  it('zScoreNormalize yields ~zero mean and ~unit std', () => {
    const data = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = zScoreNormalize(data);
    let sum = 0;
    for (const v of out) sum += v;
    expect(sum / out.length).toBeCloseTo(0, 6);
    let variance = 0;
    for (const v of out) variance += v * v;
    expect(Math.sqrt(variance / out.length)).toBeCloseTo(1, 6);
  });

  it('percentileNormalize clips outliers and rescales to [0, 1]', () => {
    const data = new Float32Array(1000);
    for (let i = 0; i < 1000; i += 1) data[i] = i; // 0..999
    data[0] = -100000; // low outlier
    data[999] = 100000; // high outlier
    const { data: out, lowerValue, upperValue } = percentileNormalize(data, {
      lowerPercentile: 1,
      upperPercentile: 99,
    });
    expect(lowerValue).toBeGreaterThan(-100000);
    expect(upperValue).toBeLessThan(100000);
    out.forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });
  });
});
