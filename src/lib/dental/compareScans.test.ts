import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../types';
import { mirrorFdi } from '../case/toothSelection';
import {
  compareTeeth,
  toothSurfacePoints,
  type ToothCloud,
} from './compareScans';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FDI = [16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26];

interface Tooth {
  fdi: number;
  centre: Vec3;
  /** Unit xy tangent (patient right → left) and buccal normal. */
  tangent: [number, number];
  buccal: [number, number];
}

/** 12 upper teeth along y = 0.035 x² (opening toward +y, lips at −y). */
function arch(): Tooth[] {
  // Equal arc-length spacing of ~8 mm.
  const xs: number[] = [];
  const f = (x: number) => 0.035 * x * x;
  const step = (x: number, s: number) => {
    let t = x;
    for (let k = 0; k < 400; k++) t += s / 400 / Math.hypot(1, 0.07 * t);
    return t;
  };
  xs.push(step(0, 4));
  for (let i = 1; i < 6; i++) xs.push(step(xs[i - 1], 8));
  const right = xs.map((x) => -x).reverse();
  const all = [...right, ...xs];
  return all.map((x, i) => {
    const tangent = normalize([1, 0.07 * x]);
    // Arch opens toward +y, so the outside (buccal) is −y side of the normal.
    let buccal: [number, number] = [-tangent[1], tangent[0]];
    if (buccal[1] > 0) buccal = [-buccal[0], -buccal[1]];
    return { fdi: FDI[i], centre: [x + 40, f(x) + 30, 50], tangent, buccal };
  });
}

function normalize(v: [number, number]): [number, number] {
  const l = Math.hypot(v[0], v[1]);
  return [v[0] / l, v[1] / l];
}

/**
 * Surface points of an upper tooth: an elliptic crown below (−z) with a
 * buccal cusp bump, and a tapering elliptic root above.
 */
function toothPoints(
  t: Tooth,
  random: () => number,
  n = 3000,
  /** Grind the crown flat this far (mm) above its tip, like wear. */
  wearMm = 0,
): Float32Array {
  const molar = t.fdi % 10 >= 4;
  const md = molar ? 3.6 : 2.8,
    bl = molar ? 4.6 : 3.6;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let lx: number, ly: number, lz: number;
    if (random() < 0.6) {
      // Crown: half-ellipsoid z ∈ [−6, 0] plus a cylinder band.
      const u = random() * 2 * Math.PI,
        v = Math.acos(random()); // 0..π/2 (lower half)
      const bump = 1 + 0.25 * Math.exp(-((u - Math.PI / 2) ** 2) / 0.3);
      lx = md * Math.sin(v) * Math.cos(u);
      ly = bl * bump * Math.sin(v) * Math.sin(u);
      lz = Math.max(-5 + wearMm, -5 * Math.cos(v));
    } else {
      // Root: tapering ellipse from z = 0 up to z = 12.
      const u = random() * 2 * Math.PI,
        h = random() * 12;
      const s = 1 - 0.7 * (h / 12);
      lx = md * 0.7 * s * Math.cos(u);
      ly = bl * 0.6 * s * Math.sin(u);
      lz = h;
    }
    out[i * 3] = t.centre[0] + lx * t.tangent[0] + ly * t.buccal[0];
    out[i * 3 + 1] = t.centre[1] + lx * t.tangent[1] + ly * t.buccal[1];
    out[i * 3 + 2] = t.centre[2] + lz;
  }
  return out;
}

function rotation(axis: Vec3, angle: number): Float64Array {
  const l = Math.hypot(...axis);
  const [x, y, z] = axis.map((a) => a / l);
  const c = Math.cos(angle),
    s = Math.sin(angle),
    v = 1 - c;
  // prettier-ignore
  return Float64Array.of(
    c + x * x * v, x * y * v - z * s, x * z * v + y * s,
    y * x * v + z * s, c + y * y * v, y * z * v - x * s,
    z * x * v - y * s, z * y * v + x * s, c + z * z * v,
  );
}

/** p' = R (p − pivot) + pivot + t, in place. */
function move(p: Float32Array, r: Float64Array, pivot: Vec3, t: Vec3) {
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] - pivot[0],
      y = p[i + 1] - pivot[1],
      z = p[i + 2] - pivot[2];
    p[i] = r[0] * x + r[1] * y + r[2] * z + pivot[0] + t[0];
    p[i + 1] = r[3] * x + r[4] * y + r[5] * z + pivot[1] + t[1];
    p[i + 2] = r[6] * x + r[7] * y + r[8] * z + pivot[2] + t[2];
  }
}

function addNoise(p: Float32Array, random: () => number, sigma: number) {
  for (let i = 0; i < p.length; i++) {
    const g = Math.sqrt(-2 * Math.log(random() || 1e-12));
    p[i] += sigma * g * Math.cos(2 * Math.PI * random());
  }
}

const IDENTITY = Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1);

function scans(options: { mirrorAfter?: boolean; wornFdi?: number } = {}) {
  const teeth = arch();
  const rb = rng(1),
    ra = rng(2);
  const before: ToothCloud[] = teeth.map((t) => ({
    fdi: t.fdi,
    id: `b${t.fdi}`,
    points: toothPoints(t, rb),
  }));
  const after: ToothCloud[] = teeth.map((t) => {
    const points = toothPoints(t, ra, 3000, t.fdi === options.wornFdi ? 1 : 0);
    if (t.fdi === 13)
      move(points, IDENTITY, [0, 0, 0], [t.buccal[0], t.buccal[1], 0]);
    if (t.fdi === 22)
      move(
        points,
        rotation([0, 0, 1], (5 * Math.PI) / 180),
        t.centre,
        [0, 0, 0],
      );
    return { fdi: t.fdi, id: `a${t.fdi}`, points };
  });
  // Whole after scan: different patient position.
  const r = rotation([1, 2, 0.5], (70 * Math.PI) / 180);
  for (const t of after) {
    move(t.points, r, [40, 40, 50], [20, -15, 30]);
    addNoise(t.points, ra, 0.03);
    if (options.mirrorAfter) t.fdi = mirrorFdi(t.fdi);
  }
  return { before, after, teeth };
}

describe('compareTeeth', () => {
  it('finds the moved teeth after a large repositioning', () => {
    const { before, after, teeth } = scans();
    const c = compareTeeth(before, after, { voxelSizeMm: 0.3 });
    const byFdi = new Map(c.teeth.map((t) => [t.fdi, t]));
    expect(c.mirrored).toBe(false);
    expect(c.teeth).toHaveLength(12);

    const t13 = byFdi.get(13)!;
    expect(Math.abs(t13.translationMm - 1)).toBeLessThan(0.15);
    expect(Math.abs(t13.buccalMm - 1)).toBeLessThan(0.15);
    expect(Math.abs(t13.mesialMm)).toBeLessThan(0.15);
    expect(Math.abs(t13.verticalMm)).toBeLessThan(0.15);
    expect(t13.rotationDeg).toBeLessThan(1);
    expect(t13.measurable).toBe(true);
    expect(t13.direction).toContain('toward the lips');

    const t22 = byFdi.get(22)!;
    expect(Math.abs(t22.rotationDeg - 5)).toBeLessThan(1);
    expect(t22.rotationKind).toBe('turned');
    expect(t22.translationMm).toBeLessThan(0.15);
    expect(t22.measurable).toBe(true);

    for (const t of c.teeth)
      if (t.fdi !== 13 && t.fdi !== 22) {
        expect(t.measurable, `tooth ${t.fdi}`).toBe(false);
        expect(t.translationMm).toBeLessThan(c.noiseFloorMm);
        expect(t.shapeChanged).toBe(false);
      }
    expect(c.referenceFdi).not.toContain(13);
    expect(c.referenceFdi).not.toContain(22);
    expect(c.referenceFdi.length).toBe(10);
    expect(c.teeth.slice(0, 2).map((t) => t.fdi)).toEqual([13, 22]);
    expect(c.summary.join(' ')).toMatch(/Tooth 13 moved 1\.0 mm/);
    expect(c.summary.join(' ')).toMatch(/Tooth 22 turned 5°/);

    // The global matrix undoes the repositioning (after → before).
    const a = teeth[0];
    const r = rotation([1, 2, 0.5], (70 * Math.PI) / 180);
    const p: Vec3 = [
      r[0] * (a.centre[0] - 40) + r[1] * (a.centre[1] - 40) + r[2] * 0 + 60,
      r[3] * (a.centre[0] - 40) + r[4] * (a.centre[1] - 40) + r[5] * 0 + 25,
      r[6] * (a.centre[0] - 40) + r[7] * (a.centre[1] - 40) + r[8] * 0 + 80,
    ];
    const m = c.globalMatrix;
    const back = [0, 1, 2].map(
      (i) =>
        m[i * 4] * p[0] +
        m[i * 4 + 1] * p[1] +
        m[i * 4 + 2] * p[2] +
        m[i * 4 + 3],
    );
    expect(Math.hypot(...back.map((v, i) => v - a.centre[i]))).toBeLessThan(
      0.1,
    );
  });

  it('detects left/right swapped numbering', () => {
    const { before, after } = scans({ mirrorAfter: true });
    const c = compareTeeth(before, after, { voxelSizeMm: 0.3 });
    expect(c.mirrored).toBe(true);
    expect(c.summary[0]).toMatch(/swapped/);
    const t13 = c.teeth.find((t) => t.fdi === 13)!;
    expect(t13.afterFdi).toBe(23);
    expect(Math.abs(t13.translationMm - 1)).toBeLessThan(0.15);
    expect(
      c.teeth
        .filter((t) => t.measurable)
        .map((t) => t.fdi)
        .sort(),
    ).toEqual([13, 22]);
  });

  it('uses a given reference list, lists unpaired teeth and flags wear', () => {
    const { before, after } = scans({ wornFdi: 24 });
    const c = compareTeeth(before.slice(0, 11), after.slice(1), {
      reference: [14, 15, 24, 25, 11],
    });
    expect(c.referenceFdi).toEqual([11, 14, 15, 24, 25]);
    expect(c.onlyBefore.map((t) => t.fdi)).toEqual([16]);
    expect(c.onlyAfter.map((t) => t.fdi)).toEqual([26]);
    const t13 = c.teeth.find((t) => t.fdi === 13)!;
    expect(Math.abs(t13.buccalMm - 1)).toBeLessThan(0.15);
    const worn = c.teeth.filter((t) => t.shapeChanged).map((t) => t.fdi);
    expect(worn).toEqual([24]);
    expect(c.summary.join(' ')).toMatch(/Tooth 24 changed shape/);
  });
});

describe('toothSurfacePoints', () => {
  it('returns the boundary of a labelled box in mm and thins evenly', () => {
    const shape: Vec3 = [8, 8, 8];
    const labels = new Uint16Array(512);
    for (let z = 2; z < 6; z++)
      for (let y = 2; y < 6; y++)
        for (let x = 2; x < 6; x++) labels[z * 64 + y * 8 + x] = 7;
    labels[0] = 3; // another tooth, ignored
    const spacing: Vec3 = [0.5, 0.5, 0.25];
    const start: Vec3 = [10, 20, 30];
    const all = toothSurfacePoints(labels, shape, start, spacing, new Set([7]));
    // 4³ box minus its 2³ interior.
    expect(all.length / 3).toBe(64 - 8);
    for (let i = 0; i < all.length; i += 3) {
      expect(all[i]).toBeGreaterThanOrEqual(12 * 0.5);
      expect(all[i]).toBeLessThanOrEqual(15 * 0.5);
      expect(all[i + 1]).toBeGreaterThanOrEqual(22 * 0.5);
      expect(all[i + 2]).toBeGreaterThanOrEqual(32 * 0.25);
      expect(all[i + 2]).toBeLessThanOrEqual(35 * 0.25);
    }
    const few = toothSurfacePoints(
      labels,
      shape,
      start,
      spacing,
      new Set([7]),
      10,
    );
    expect(few.length).toBe(30);
    // Spread over the whole box, not only its first slice.
    expect(few[few.length - 1]).toBeGreaterThan(few[2]);
  });
});
