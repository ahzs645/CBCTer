import { describe, expect, it } from 'vitest';
import { scaleOneVolumeSample } from './onevolume';

describe('scaleOneVolumeSample', () => {
  it('applies the header value-to-HU calibration (V = raw / 1000)', () => {
    // tfSystemV2HuSlope=190, tfSystemV2HuIntercept=-400 (Veraview X800 export)
    expect(scaleOneVolumeSample(0, 190, -400)).toBe(-400);
    expect(scaleOneVolumeSample(5920, 190, -400)).toBe(725);
    expect(scaleOneVolumeSample(30670, 190, -400)).toBe(5427);
  });

  it('is monotonic across the full raw range (no wrap-around)', () => {
    let previous = -Infinity;
    for (let raw = -32767; raw <= 32767; raw += 97) {
      const value = scaleOneVolumeSample(raw, 190, -400);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('clamps instead of wrapping when the scaled value leaves Int16', () => {
    expect(scaleOneVolumeSample(32000, 5000, 0)).toBe(32767);
    expect(scaleOneVolumeSample(-32000, 5000, 0)).toBe(-32767);
  });
});
