import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../types';
import { findDarkAreas, sampleOblique, toothAxes } from './toothFocus';

/**
 * A 20 mm "tooth" (ellipsoid, semi-axes 10 × 3.5 × 2.5 mm) tilted 20° in XZ,
 * crown pointing +z, dentine 1300, a 0.8 mm pulp canal (500) along most of
 * its length and a 2.6 mm dark spot (300) breaking the surface.
 */
function phantom() {
  const spacing: Vec3 = [0.25, 0.25, 0.25];
  const shape: Vec3 = [80, 60, 110];
  const n = shape[0] * shape[1] * shape[2];
  const scan = new Int16Array(n).fill(100);
  const labels = new Uint16Array(n);
  const c: Vec3 = [40, 30, 55];
  const tilt = (20 * Math.PI) / 180;
  const long: Vec3 = [Math.sin(tilt), 0, Math.cos(tilt)];
  const wide: Vec3 = [Math.cos(tilt), 0, -Math.sin(tilt)];
  const spot: Vec3 = [0, 0, 0];
  for (let z = 0; z < shape[2]; z++)
    for (let y = 0; y < shape[1]; y++)
      for (let x = 0; x < shape[0]; x++) {
        const p: Vec3 = [
          (x - c[0]) * spacing[0],
          (y - c[1]) * spacing[1],
          (z - c[2]) * spacing[2],
        ];
        const a = p[0] * long[0] + p[2] * long[2];
        const b = p[0] * wide[0] + p[2] * wide[2];
        const t = p[1];
        const i = (z * shape[1] + y) * shape[0] + x;
        if ((a / 10) ** 2 + (b / 3.5) ** 2 + (t / 2.5) ** 2 > 1) continue;
        labels[i] = 7;
        scan[i] = 1300;
        if (Math.hypot(b, t) < 0.4 && Math.abs(a) < 7) scan[i] = 500;
        // Spot on the wide face, a quarter of the way from the crown tip.
        const s = Math.hypot(a - 5, b - 2.6, t);
        if (s < 1.3) {
          scan[i] = 300;
          labels[i] = 0; // the model left the lesion out of the outline
        }
      }
  spot[0] = c[0] + (5 * long[0] + 2.6 * wide[0]) / spacing[0];
  spot[1] = c[1];
  spot[2] = c[2] + (5 * long[2] + 2.6 * wide[2]) / spacing[2];
  return { spacing, shape, scan, labels, long, spot };
}

describe('tooth focus', () => {
  const { spacing, shape, scan, labels, long, spot } = phantom();
  const axes = toothAxes(labels, shape, [7], spacing, 1)!;
  it('finds the long axis pointing from crown to root and the length', () => {
    // Crown points +z, so crown→root is −long.
    const cosine =
      axes.long[0] * -long[0] + axes.long[1] * -long[1] + axes.long[2] * -long[2];
    expect(cosine).toBeGreaterThan(0.99);
    expect(axes.lengthMm).toBeGreaterThan(19);
    expect(axes.lengthMm).toBeLessThan(21);
  });
  it('samples a slice along the tooth with the outline marked', () => {
    const image = sampleOblique({
      scan,
      labels,
      values: [7],
      shape,
      spacing,
      centre: axes.centre,
      right: axes.wide,
      up: axes.long.map((v) => -v) as Vec3,
      halfWidthMm: 6,
      halfHeightMm: 12,
    });
    expect(image.width).toBe(49);
    expect(image.height).toBe(97);
    const middle = Math.floor(image.height / 2) * image.width;
    // Across the middle row: outside, dentine, pulp in the centre, dentine.
    expect(image.values[middle + 2]).toBeCloseTo(100, 0);
    expect(image.values[middle + Math.floor(image.width / 2)]).toBeLessThan(800);
    expect(image.values[middle + Math.floor(image.width / 2) + 8]).toBeGreaterThan(1200);
    expect(image.inside.some(Boolean)).toBe(true);
  });
  it('tells the pulp canal apart from a focal dark spot at the surface', () => {
    // At this coarse 0.25 mm phantom only ~2.9 mm³ of the open spot lies
    // inside the tooth envelope, so lower the focal threshold accordingly.
    const areas = findDarkAreas({
      scan,
      labels,
      shape,
      spacing,
      values: [7],
      axes,
      focalMinMm3: 2,
    });
    const pulp = areas.find((a) => a.kind === 'pulp-like');
    const focal = areas.find((a) => a.kind === 'focal');
    expect(pulp).toBeDefined();
    expect(pulp!.lengthAlongToothMm).toBeGreaterThan(10);
    expect(focal).toBeDefined();
    expect(focal!.surfaceDistanceMm).toBeLessThan(0.6);
    expect(focal!.relativeDensity).toBeLessThan(0.6);
    const offset = Math.hypot(
      (focal!.centre[0] - spot[0]) * spacing[0],
      (focal!.centre[1] - spot[1]) * spacing[1],
      (focal!.centre[2] - spot[2]) * spacing[2],
    );
    expect(offset).toBeLessThan(1);
  });
});
