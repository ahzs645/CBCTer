import { describe, expect, it } from 'vitest';
import { VolumeAxis, type Vec3 } from '../../types';
import { axisPointToVoxel } from '../segmentation/paintBrush';
import {
  canalCenterline,
  canalSliceMarks,
  snapToCanal,
  toothCanalDistances,
  traceCanalPath,
  voxelToAxisPoint,
} from './canal';

const SPACING: Vec3 = [0.25, 0.25, 0.25];
const TUBE_RADIUS_MM = 1.25;

interface Phantom {
  scan: Int16Array;
  start: Vec3;
  shape: Vec3;
  /** Densely sampled true canal axis (voxel coords). */
  curve: Vec3[];
  curveAt: (t: number) => Vec3;
  boneLo: Vec3;
  boneHi: Vec3;
}

function smoothstep(u: number): number {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
}

/** Deterministic PRNG so the phantom noise is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mandible-like block: bone (1000) holding a dark tube (200) that runs
 * horizontally then rises toward the back, soft tissue (300) around the
 * bone and air (−500) outside, plus noise (σ ≈ 40).
 */
function makePhantom(shape: Vec3): Phantom {
  const [sx, sy, sz] = shape;
  const zLow = 0.35 * sz;
  const zHigh = 0.7 * sz;
  const curveAt = (t: number): Vec3 => {
    const rise = smoothstep((t - 0.55) / 0.45);
    return [sx * (0.12 + 0.76 * t), sy * (0.5 + 0.06 * rise), zLow + (zHigh - zLow) * rise];
  };
  const curve: Vec3[] = [];
  const samples = Math.ceil(sx * 12);
  for (let i = 0; i <= samples; i++) curve.push(curveAt(i / samples));

  const boneLo: Vec3 = [Math.round(sx * 0.05), Math.round(sy * 0.2), Math.round(sz * 0.15)];
  const boneHi: Vec3 = [Math.round(sx * 0.95), Math.round(sy * 0.8), Math.round(sz * 0.88)];
  const softPad = 10;

  // Distance to the tube axis, stamped from the dense curve samples.
  const dist = new Float32Array(sx * sy * sz).fill(Infinity);
  const reach = Math.ceil(TUBE_RADIUS_MM / SPACING[0]) + 2;
  for (const c of curve) {
    const cx = Math.round(c[0]);
    const cy = Math.round(c[1]);
    const cz = Math.round(c[2]);
    for (let z = cz - reach; z <= cz + reach; z++) {
      for (let y = cy - reach; y <= cy + reach; y++) {
        for (let x = cx - reach; x <= cx + reach; x++) {
          if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) continue;
          const d = Math.hypot(x - c[0], y - c[1], z - c[2]) * SPACING[0];
          const i = x + sx * (y + sy * z);
          if (d < dist[i]) dist[i] = d;
        }
      }
    }
  }

  const rand = mulberry32(7);
  const scan = new Int16Array(sx * sy * sz);
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        const i = x + sx * (y + sy * z);
        const inBone =
          x >= boneLo[0] && x <= boneHi[0] &&
          y >= boneLo[1] && y <= boneHi[1] &&
          z >= boneLo[2] && z <= boneHi[2];
        const inSoft =
          y >= boneLo[1] - softPad && y <= boneHi[1] + softPad &&
          z >= boneLo[2] - softPad && z <= boneHi[2] + softPad;
        let v = inBone ? 1000 : inSoft ? 300 : -500;
        if (dist[i] <= TUBE_RADIUS_MM) v = 200;
        const noise = (rand() + rand() + rand() + rand() - 2) * 70;
        scan[i] = Math.round(v + noise);
      }
    }
  }
  return { scan, start: [0, 0, 0], shape, curve, curveAt, boneLo, boneHi };
}

/** Distance (mm) from p to the nearest dense curve sample. */
function distToCurve(p: Vec3, curve: Vec3[]): number {
  let best = Infinity;
  for (const c of curve) {
    best = Math.min(best, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
  }
  return best * SPACING[0];
}

/** Points along a polyline every `step` voxels. */
function densify(points: Vec3[], step: number): Vec3[] {
  const out: Vec3[] = [points[0]];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / step));
    for (let k = 1; k <= n; k++) {
      out.push([
        a[0] + ((b[0] - a[0]) * k) / n,
        a[1] + ((b[1] - a[1]) * k) / n,
        a[2] + ((b[2] - a[2]) * k) / n,
      ]);
    }
  }
  return out;
}

const phantom = makePhantom([120, 80, 80]);

describe('canalCenterline', () => {
  it('passes through every control point with even spacing', () => {
    const controls = [0.05, 0.3, 0.55, 0.7, 0.85, 0.95].map((t) => phantom.curveAt(t));
    const line = canalCenterline(controls, SPACING, 0.5);
    for (const c of controls) {
      const nearest = Math.min(
        ...line.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])),
      );
      expect(nearest).toBeLessThan(1e-6);
    }
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      const step = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * SPACING[0];
      expect(step).toBeGreaterThan(0.35);
      expect(step).toBeLessThan(0.65);
    }
    // A spline through points on the true curve stays close to it.
    const worst = Math.max(...line.map((p) => distToCurve(p, phantom.curve)));
    expect(worst).toBeLessThan(0.5);
  });

  it('draws a straight evenly spaced line through two points', () => {
    const a: Vec3 = [10, 10, 10];
    const b: Vec3 = [50, 10, 10];
    const line = canalCenterline([a, b], SPACING, 0.5);
    expect(line.length).toBe(21);
    for (const p of line) {
      expect(p[1]).toBeCloseTo(10, 6);
      expect(p[2]).toBeCloseTo(10, 6);
    }
    expect(line[10][0]).toBeCloseTo(30, 6);
  });

  it('keeps fewer than two distinct points as they are', () => {
    expect(canalCenterline([[1, 2, 3]], SPACING)).toEqual([[1, 2, 3]]);
    expect(canalCenterline([[1, 2, 3], [1, 2, 3]], SPACING)).toHaveLength(1);
  });
});

describe('snapToCanal', () => {
  it('moves an off-centre click back onto the tube axis', () => {
    for (const t of [0.3, 0.8]) {
      const centre = phantom.curveAt(t);
      const ahead = phantom.curveAt(t + 0.01);
      const tan = [0, 1, 2].map((a) => ahead[a] - centre[a]);
      const tl = Math.hypot(...tan);
      // Offset 1.5 mm (6 voxels) perpendicular to the tube.
      const d = [0, 3, 5];
      const along = (d[0] * tan[0] + d[1] * tan[1] + d[2] * tan[2]) / tl;
      const perp = d.map((v, a) => v - (along * tan[a]) / tl);
      const pl = Math.hypot(...perp);
      const clicked = centre.map((v, a) => v + (6 * perp[a]) / pl) as Vec3;
      expect(distToCurve(clicked, phantom.curve)).toBeGreaterThan(1.4);
      const snapped = snapToCanal(phantom, clicked, SPACING);
      expect(distToCurve(snapped, phantom.curve)).toBeLessThan(0.5);
    }
  });

  it('leaves a click in plain bone alone', () => {
    const centre = phantom.curveAt(0.3);
    const clicked: Vec3 = [centre[0], centre[1], centre[2] + 22]; // 5.5 mm above
    expect(snapToCanal(phantom, clicked, SPACING)).toEqual(clicked);
  });
});

describe('traceCanalPath', () => {
  it('follows the curved tube between its two ends inside the bone', () => {
    const from = phantom.curveAt(0.02);
    const to = phantom.curveAt(0.98);
    const path = traceCanalPath(phantom, from, to, SPACING);
    expect(path[0]).toEqual(from);
    expect(path[path.length - 1]).toEqual(to);
    const dense = densify(path, 0.5);
    const errors = dense.map((p) => distToCurve(p, phantom.curve));
    const mean = errors.reduce((s, e) => s + e, 0) / errors.length;
    console.info(`traceCanalPath error: mean ${mean.toFixed(2)} mm, max ${Math.max(...errors).toFixed(2)} mm`);
    expect(mean).toBeLessThan(0.75);
    expect(Math.max(...errors)).toBeLessThan(TUBE_RADIUS_MM + 0.5);
    for (const p of dense) {
      for (let a = 0; a < 3; a++) {
        expect(p[a]).toBeGreaterThanOrEqual(phantom.boneLo[a]);
        expect(p[a]).toBeLessThanOrEqual(phantom.boneHi[a]);
      }
    }
  });

  it('traces a 250×150×120 crop quickly', () => {
    const big = makePhantom([250, 150, 120]);
    const from = big.curveAt(0.02);
    const to = big.curveAt(0.98);
    const t0 = performance.now();
    const path = traceCanalPath(big, from, to, SPACING);
    const elapsed = performance.now() - t0;
    const errors = densify(path, 0.5).map((p) => distToCurve(p, big.curve));
    const mean = errors.reduce((s, e) => s + e, 0) / errors.length;
    console.info(`traceCanalPath 250x150x120: ${elapsed.toFixed(0)} ms, mean error ${mean.toFixed(2)} mm`);
    expect(elapsed).toBeLessThan(3000);
    expect(mean).toBeLessThan(0.75);
  });
});

describe('canalSliceMarks', () => {
  const dims = phantom.shape;
  const line = canalCenterline(phantom.curve.filter((_, i) => i % 40 === 0), SPACING, 0.5);

  it('marks the canal cross-section where it pierces a sagittal slice', () => {
    const centre = phantom.curveAt(0.3);
    const index = Math.round(centre[0]);
    const marks = canalSliceMarks(line, TUBE_RADIUS_MM, VolumeAxis.Sagittal, index, dims, SPACING);
    const crosses = marks.filter((m) => m.kind === 'cross');
    expect(crosses).toHaveLength(1);
    const cross = crosses[0];
    if (cross.kind !== 'cross') throw new Error('expected a cross mark');
    expect(cross.center.xRatio).toBeCloseTo(centre[1] / (dims[1] - 1), 2);
    expect(cross.center.yRatio).toBeCloseTo(1 - centre[2] / (dims[2] - 1), 2);
    expect(cross.radiusXRatio).toBeCloseTo(TUBE_RADIUS_MM / SPACING[1] / (dims[1] - 1), 3);
    expect(cross.radiusYRatio).toBeCloseTo(TUBE_RADIUS_MM / SPACING[2] / (dims[2] - 1), 3);
    const voxel = axisPointToVoxel(
      VolumeAxis.Sagittal,
      cross.center,
      { x: index, y: 0, z: 0 },
      dims,
    );
    expect(voxel).toEqual([index, Math.round(centre[1]), Math.round(centre[2])]);
    // The short stretch within ±radius of the plane is drawn as a path.
    expect(marks.some((m) => m.kind === 'path' && m.points.length >= 2)).toBe(true);
  });

  it('draws the horizontal run as a path on the axial slice through it', () => {
    const z = Math.round(phantom.curveAt(0.2)[2]);
    const marks = canalSliceMarks(line, TUBE_RADIUS_MM, VolumeAxis.Axial, z, dims, SPACING);
    const paths = marks.filter((m) => m.kind === 'path');
    expect(paths.length).toBeGreaterThan(0);
    const xs = paths.flatMap((m) => (m.kind === 'path' ? m.points.map((p) => p.xRatio) : []));
    expect(Math.min(...xs)).toBeLessThan(0.15);
    expect(Math.max(...xs)).toBeGreaterThan(0.5);
    expect(canalSliceMarks(line, TUBE_RADIUS_MM, VolumeAxis.Axial, 2, dims, SPACING)).toEqual([]);
  });

  it('inverts axisPointToVoxel on every axis', () => {
    const rand = mulberry32(3);
    for (const axis of [VolumeAxis.Axial, VolumeAxis.Coronal, VolumeAxis.Sagittal]) {
      for (let i = 0; i < 50; i++) {
        const voxel: Vec3 = [
          Math.floor(rand() * dims[0]),
          Math.floor(rand() * dims[1]),
          Math.floor(rand() * dims[2]),
        ];
        const point = voxelToAxisPoint(axis, voxel, dims);
        const cursor = { x: voxel[0], y: voxel[1], z: voxel[2] };
        expect(axisPointToVoxel(axis, point, cursor, dims)).toEqual(voxel);
      }
    }
  });
});

describe('toothCanalDistances', () => {
  /** Box tooth labelled 1 inside its own crop. */
  function boxTooth(id: string, lo: Vec3, hi: Vec3) {
    const shape: Vec3 = [hi[0] - lo[0] + 3, hi[1] - lo[1] + 3, hi[2] - lo[2] + 3];
    const start: Vec3 = [lo[0] - 1, lo[1] - 1, lo[2] - 1];
    const labels = new Uint16Array(shape[0] * shape[1] * shape[2]);
    for (let z = 1; z < shape[2] - 1; z++) {
      for (let y = 1; y < shape[1] - 1; y++) {
        for (let x = 1; x < shape[0] - 1; x++) labels[x + shape[0] * (y + shape[1] * z)] = 1;
      }
    }
    return { id, labels, start, shape, value: 1 };
  }

  it('matches the analytic gap between a box tooth and the canal', () => {
    const axisZ = phantom.curveAt(0.3)[2]; // horizontal run: z = 28, y = 40
    const above = boxTooth('46', [40, 36, Math.round(axisZ) + 12], [60, 44, Math.round(axisZ) + 30]);
    const through = boxTooth('47', [40, 30, Math.round(axisZ) - 2], [44, 50, Math.round(axisZ) + 10]);
    const [a, b] = toothCanalDistances(phantom.curve, TUBE_RADIUS_MM, SPACING, [above, through]);
    expect(a.id).toBe('46');
    expect(a.distanceMm).toBeCloseTo(12 * 0.25 - TUBE_RADIUS_MM, 1);
    expect(Math.abs(a.distanceMm - 1.75)).toBeLessThan(0.3);
    expect(a.toothPoint[2]).toBe(Math.round(axisZ) + 12);
    expect(Math.abs(a.canalPoint[2] - axisZ)).toBeLessThan(0.01);
    expect(b.distanceMm).toBeLessThan(-TUBE_RADIUS_MM);
  });

  it('skips empty teeth', () => {
    const empty = { id: 'x', labels: new Uint16Array(8), start: [0, 0, 0] as Vec3, shape: [2, 2, 2] as Vec3, value: 1 };
    expect(toothCanalDistances(phantom.curve, 1, SPACING, [empty])).toEqual([]);
  });
});
