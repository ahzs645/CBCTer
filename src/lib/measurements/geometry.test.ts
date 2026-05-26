import { describe, expect, it } from 'vitest';
import {
  angleDegrees,
  densityStats,
  distance3d,
  ellipseArea,
  polygonArea,
  polygonPerimeter,
} from './geometry';

describe('measurement geometry', () => {
  it('computes calibrated distance and angle', () => {
    expect(distance3d([0, 0, 0], [3, 4, 0], [2, 1, 1])).toBeCloseTo(
      Math.hypot(6, 4),
    );
    expect(angleDegrees([1, 0, 0], [0, 0, 0], [0, 1, 0])).toBeCloseTo(90);
  });

  it('computes ROI area, perimeter, and density stats', () => {
    const square: Array<[number, number]> = [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ];
    expect(polygonArea(square)).toBeCloseTo(4);
    expect(polygonPerimeter(square)).toBeCloseTo(8);
    expect(ellipseArea(2, 3)).toBeCloseTo(6 * Math.PI);
    expect(densityStats([100, 200, Number.NaN, 300])).toEqual({
      min: 100,
      max: 300,
      mean: 200,
      count: 3,
    });
  });
});
