import { describe, expect, it } from 'vitest';
import { clampRoi } from './roi';

describe('clampRoi', () => {
  it('keeps max within the volume bounds when min is dragged past the edge', () => {
    const { min, max } = clampRoi(
      { min: [100, 100, 100], max: [120, 120, 120] },
      [64, 64, 64],
    );
    // min is capped to dimension - 1, so max stays <= dimension (exclusive).
    expect(min).toEqual([63, 63, 63]);
    expect(max).toEqual([64, 64, 64]);
    expect(max[0]).toBeLessThanOrEqual(64);
    expect(max[1]).toBeLessThanOrEqual(64);
    expect(max[2]).toBeLessThanOrEqual(64);
  });

  it('rounds and clamps a normal ROI without altering valid bounds', () => {
    const { min, max } = clampRoi(
      { min: [10.4, 5.6, 0], max: [30.2, 40.9, 12] },
      [64, 64, 64],
    );
    expect(min).toEqual([10, 6, 0]);
    expect(max).toEqual([30, 41, 12]);
  });

  it('guarantees max is strictly greater than min', () => {
    const { min, max } = clampRoi(
      { min: [20, 20, 20], max: [20, 20, 20] },
      [64, 64, 64],
    );
    expect(max[0]).toBeGreaterThan(min[0]);
    expect(max[1]).toBeGreaterThan(min[1]);
    expect(max[2]).toBeGreaterThan(min[2]);
  });
});
