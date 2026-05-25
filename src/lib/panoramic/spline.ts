import type { Vec3 } from '../../types';
import type { ArchCurve, ArchPolyline, ArchSample } from './types';

const SAMPLES_PER_SEGMENT = 32;

interface Vec2 {
  x: number;
  y: number;
}

function catmullRom(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  t: number,
  axis: 'x' | 'y',
): number {
  const a0 = p0[axis];
  const a1 = p1[axis];
  const a2 = p2[axis];
  const a3 = p3[axis];
  const t2 = t * t;
  const t3 = t2 * t;
  // Uniform Catmull-Rom basis.
  return (
    0.5 *
    (2 * a1 +
      (-a0 + a2) * t +
      (2 * a0 - 5 * a1 + 4 * a2 - a3) * t2 +
      (-a0 + 3 * a1 - 3 * a2 + a3) * t3)
  );
}

/**
 * Resample an arch curve into evenly spaced points (in mm) with per-point
 * unit normals. Control points arrive in voxel coordinates; we convert to
 * physical space using the in-plane spacing so the depth band and arch length
 * are measured in true millimetres.
 *
 * This is the shared mechanism behind every arch mode — auto-fit and manual
 * point placement both hand off the same `ArchCurve` here.
 */
export function resampleArch(
  curve: ArchCurve,
  spacing: Vec3,
  archStepMm: number,
): ArchPolyline {
  const [sx, sy] = spacing;
  const cps = curve.controlPoints;
  if (cps.length < 2) {
    return { samples: [], stepMm: archStepMm, lengthMm: 0 };
  }

  // Control points in mm.
  const pts: Vec2[] = cps.map((p) => ({ x: p.x * sx, y: p.y * sy }));

  // Dense Catmull-Rom polyline with clamped (duplicated) endpoints.
  const dense: Vec2[] = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? pts[i + 1];
    const last = i === pts.length - 2;
    const steps = last ? SAMPLES_PER_SEGMENT : SAMPLES_PER_SEGMENT - 1;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / SAMPLES_PER_SEGMENT;
      dense.push({
        x: catmullRom(p0, p1, p2, p3, t, 'x'),
        y: catmullRom(p0, p1, p2, p3, t, 'y'),
      });
    }
  }

  // Cumulative arc length along the dense polyline.
  const cum: number[] = [0];
  for (let i = 1; i < dense.length; i += 1) {
    const dx = dense[i].x - dense[i - 1].x;
    const dy = dense[i].y - dense[i - 1].y;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  const lengthMm = cum[cum.length - 1];
  if (lengthMm <= 0) {
    return { samples: [], stepMm: archStepMm, lengthMm: 0 };
  }

  const step = Math.max(0.01, archStepMm);
  const count = Math.max(2, Math.floor(lengthMm / step) + 1);
  const samples: ArchSample[] = [];
  let cursor = 0;

  for (let k = 0; k < count; k += 1) {
    const target = Math.min(lengthMm, k * step);
    while (cursor < cum.length - 2 && cum[cursor + 1] < target) cursor += 1;
    const segLen = cum[cursor + 1] - cum[cursor] || 1;
    const local = (target - cum[cursor]) / segLen;
    const a = dense[cursor];
    const b = dense[cursor + 1];
    const x = a.x + (b.x - a.x) * local;
    const y = a.y + (b.y - a.y) * local;

    // Tangent from the enclosing dense segment; normal is its perpendicular.
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const tlen = Math.hypot(tx, ty) || 1;
    tx /= tlen;
    ty /= tlen;
    samples.push({ x, y, nx: -ty, ny: tx });
  }

  return { samples, stepMm: step, lengthMm };
}
