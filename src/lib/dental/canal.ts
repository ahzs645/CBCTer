import { VolumeAxis, type Vec3 } from '../../types';

/**
 * Mandibular (inferior alveolar) nerve canal tracing.
 *
 * The canal shows up in CBCT as a dark 2–3 mm tube with a brighter cortical
 * rim running through the mandible. Everything here works in voxel
 * coordinates of the scan frame and converts to millimetres with `spacing`.
 */

/** A traced canal: control points the user placed (or the tracer found). */
export interface CanalTrace {
  id: string;
  side: 'right' | 'left';
  /** Voxel coordinates in the scan frame. */
  points: Vec3[];
  radiusMm: number;
}

/** A cropped block of the scan, x-fastest, positioned at `start`. */
export interface CanalVolumeRead {
  scan: ArrayLike<number>;
  start: Vec3;
  shape: Vec3;
}

export interface SliceRatioPoint {
  xRatio: number;
  yRatio: number;
}

export type CanalSliceMark =
  | {
      kind: 'cross';
      center: SliceRatioPoint;
      radiusXRatio: number;
      radiusYRatio: number;
    }
  | { kind: 'path'; points: SliceRatioPoint[] };

export interface ToothCanalDistance {
  id: string;
  /** Tooth surface to canal wall; negative when they overlap. */
  distanceMm: number;
  toothPoint: Vec3;
  canalPoint: Vec3;
}

export interface CanalToothLabels {
  id: string;
  labels: Uint16Array;
  start: Vec3;
  shape: Vec3;
  value: number;
}

/** Radius at which the bony wall around the canal is sampled. */
const SHELL_MM = 2;
/** Floor of the per-mm path cost inside the darkest canal voxels. */
const PATH_EPS = 0.02;
/** Extra per-mm cost for voxels that are not wrapped in bone. */
const NO_BONE_COST = 3;

/** 26 unit directions (faces, edges and corners of a cube). */
const SHELL_DIRS: Vec3[] = (() => {
  const dirs: Vec3[] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy && !dz) continue;
        const n = Math.hypot(dx, dy, dz);
        dirs.push([dx / n, dy / n, dz / n]);
      }
    }
  }
  return dirs;
})();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toMm(p: Vec3, spacing: Vec3): Vec3 {
  return [p[0] * spacing[0], p[1] * spacing[1], p[2] * spacing[2]];
}

function distMm(a: Vec3, b: Vec3, spacing: Vec3): number {
  return Math.hypot(
    (a[0] - b[0]) * spacing[0],
    (a[1] - b[1]) * spacing[1],
    (a[2] - b[2]) * spacing[2],
  );
}

/* ------------------------------------------------------------------ */
/* Centreline                                                          */
/* ------------------------------------------------------------------ */

/**
 * Centripetal Catmull–Rom spline through `points` (voxel coords), resampled
 * every ~`stepMm` of arc length. Each control point is kept exactly.
 */
export function canalCenterline(
  points: Vec3[],
  spacing: Vec3,
  stepMm = 0.5,
): Vec3[] {
  const mm: Vec3[] = [];
  for (const p of points) {
    const q = toMm(p, spacing);
    const last = mm[mm.length - 1];
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1], q[2] - last[2]) > 1e-6) {
      mm.push(q);
    }
  }
  if (mm.length < 2) return mm.map((q) => fromMm(q, spacing));
  const step = Math.max(1e-3, stepMm);
  const n = mm.length;
  // Phantom end points mirror the neighbours so the spline reaches the ends.
  const ext: Vec3[] = [
    sub3(scale3(mm[0], 2), mm[1]),
    ...mm,
    sub3(scale3(mm[n - 1], 2), mm[n - 2]),
  ];
  const out: Vec3[] = [mm[0]];
  for (let i = 0; i < n - 1; i++) {
    const [p0, p1, p2, p3] = [ext[i], ext[i + 1], ext[i + 2], ext[i + 3]];
    const seg = (t: number) => catmullRom(p0, p1, p2, p3, t);
    // Dense arc-length table, then even samples within the segment.
    const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
    const dense = Math.max(16, Math.ceil((chord / step) * 8));
    const ts = new Float64Array(dense + 1);
    const arc = new Float64Array(dense + 1);
    let prev = p1;
    for (let k = 1; k <= dense; k++) {
      const t = k / dense;
      const q = seg(t);
      ts[k] = t;
      arc[k] = arc[k - 1] + Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]);
      prev = q;
    }
    const length = arc[dense];
    const count = Math.max(1, Math.round(length / step));
    let k = 1;
    for (let s = 1; s < count; s++) {
      const target = (length * s) / count;
      while (k < dense && arc[k] < target) k++;
      const f = (target - arc[k - 1]) / Math.max(1e-12, arc[k] - arc[k - 1]);
      out.push(seg(ts[k - 1] + f * (ts[k] - ts[k - 1])));
    }
    out.push(p2);
  }
  return out.map((q) => fromMm(q, spacing));
}

function fromMm(q: Vec3, spacing: Vec3): Vec3 {
  return [q[0] / spacing[0], q[1] / spacing[1], q[2] / spacing[2]];
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Barry–Goldman evaluation of a centripetal (alpha = 0.5) segment p1→p2. */
function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
  const knot = (a: Vec3, b: Vec3) =>
    Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])));
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const mix = (a: Vec3, b: Vec3, ta: number, tb: number) =>
    lerp3(a, b, (t - ta) / (tb - ta));
  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

/* ------------------------------------------------------------------ */
/* Volume helpers                                                      */
/* ------------------------------------------------------------------ */

/** Copy crop voxels [lo, hi] (inclusive, crop coords) into a Float32Array. */
function extractBlock(read: CanalVolumeRead, lo: Vec3, hi: Vec3): Float32Array {
  const [sx, sy] = read.shape;
  const bx = hi[0] - lo[0] + 1;
  const by = hi[1] - lo[1] + 1;
  const bz = hi[2] - lo[2] + 1;
  const out = new Float32Array(bx * by * bz);
  let o = 0;
  for (let z = lo[2]; z <= hi[2]; z++) {
    for (let y = lo[1]; y <= hi[1]; y++) {
      let i = lo[0] + sx * (y + sy * z);
      for (let x = 0; x < bx; x++) out[o++] = read.scan[i++];
    }
  }
  return out;
}

/** Mean of `ds`³ blocks; partial blocks at the far edges average what exists. */
function downsampleBlock(
  read: CanalVolumeRead,
  lo: Vec3,
  hi: Vec3,
  ds: number,
): { values: Float32Array; shape: Vec3 } {
  const ext: Vec3 = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1];
  if (ds <= 1) return { values: extractBlock(read, lo, hi), shape: ext };
  const shape: Vec3 = [
    Math.ceil(ext[0] / ds),
    Math.ceil(ext[1] / ds),
    Math.ceil(ext[2] / ds),
  ];
  const sum = new Float32Array(shape[0] * shape[1] * shape[2]);
  const cnt = new Uint16Array(sum.length);
  const [sx, sy] = read.shape;
  for (let z = 0; z < ext[2]; z++) {
    const gz = (z / ds) | 0;
    for (let y = 0; y < ext[1]; y++) {
      const gRow = shape[0] * (((y / ds) | 0) + shape[1] * gz);
      let i = lo[0] + sx * (lo[1] + y + sy * (lo[2] + z));
      for (let x = 0; x < ext[0]; x++) {
        const g = gRow + ((x / ds) | 0);
        sum[g] += read.scan[i++];
        cnt[g]++;
      }
    }
  }
  for (let g = 0; g < sum.length; g++) sum[g] /= cnt[g] || 1;
  return { values: sum, shape };
}

/** Separable box mean with windows shrunk at the block edges. */
function boxMean3(src: Float32Array, shape: Vec3, half: Vec3): Float32Array {
  let cur = src;
  for (let axis = 0; axis < 3; axis++) {
    const h = half[axis];
    if (h <= 0) continue;
    const n = shape[axis];
    const stride = axis === 0 ? 1 : axis === 1 ? shape[0] : shape[0] * shape[1];
    const out = new Float32Array(cur.length);
    const prefix = new Float64Array(n + 1);
    const lines = cur.length / n;
    for (let line = 0; line < lines; line++) {
      // Base index of this line: walk the two other axes.
      let base: number;
      if (axis === 0) base = line * n;
      else if (axis === 1) base = (line % shape[0]) + Math.floor(line / shape[0]) * shape[0] * shape[1];
      else base = line;
      for (let k = 0; k < n; k++) prefix[k + 1] = prefix[k] + cur[base + k * stride];
      for (let k = 0; k < n; k++) {
        const a = Math.max(0, k - h);
        const b = Math.min(n - 1, k + h);
        out[base + k * stride] = (prefix[b + 1] - prefix[a]) / (b - a + 1);
      }
    }
    cur = out;
  }
  return cur;
}

/** Percentile of a strided sample of `values` (0..1). */
function samplePercentiles(values: Float32Array, qs: number[]): number[] {
  const stride = Math.max(1, Math.floor(values.length / 20000));
  const sample: number[] = [];
  for (let i = 0; i < values.length; i += stride) sample.push(values[i]);
  sample.sort((a, b) => a - b);
  return qs.map((q) => sample[clamp(Math.round(q * (sample.length - 1)), 0, sample.length - 1)]);
}

/** Percentiles of a strided sample of the whole crop. */
function cropPercentiles(read: CanalVolumeRead, qs: number[]): number[] {
  const n = read.shape[0] * read.shape[1] * read.shape[2];
  const stride = Math.max(1, Math.floor(n / 20000));
  const sample = new Float32Array(Math.ceil(n / stride));
  for (let i = 0, k = 0; i < n; i += stride) sample[k++] = read.scan[i];
  return samplePercentiles(sample, qs);
}

/** Voxel offsets (per axis) of the 26 shell samples at `radiusMm`. */
function shellOffsets(radiusMm: number, voxelMm: Vec3): Vec3[] {
  return SHELL_DIRS.map((d) => [
    Math.round((d[0] * radiusMm) / voxelMm[0]),
    Math.round((d[1] * radiusMm) / voxelMm[1]),
    Math.round((d[2] * radiusMm) / voxelMm[2]),
  ]);
}

/**
 * Shell samples around (x, y, z) in a block, sorted ascending into `buf`.
 * Returns how many fell inside the block.
 */
function sortedShell(
  values: Float32Array,
  shape: Vec3,
  x: number,
  y: number,
  z: number,
  offsets: Vec3[],
  buf: Float64Array,
): number {
  let n = 0;
  for (const o of offsets) {
    const sx = x + o[0];
    const sy = y + o[1];
    const sz = z + o[2];
    if (sx < 0 || sy < 0 || sz < 0 || sx >= shape[0] || sy >= shape[1] || sz >= shape[2]) continue;
    const v = values[sx + shape[0] * (sy + shape[1] * sz)];
    // Insertion sort: at most 26 entries.
    let k = n++;
    while (k > 0 && buf[k - 1] > v) {
      buf[k] = buf[k - 1];
      k--;
    }
    buf[k] = v;
  }
  return n;
}

/** Box half-width (voxels) giving a ~1–1.5 mm smoothing box. */
function boxHalf(voxelMm: Vec3): Vec3 {
  return voxelMm.map((s) => Math.max(1, Math.floor(0.6 / s))) as Vec3;
}

/* ------------------------------------------------------------------ */
/* Snap                                                                */
/* ------------------------------------------------------------------ */

/**
 * Move a clicked point onto the axis of the nearby dark tube. Searches a
 * sphere of `radiusMm` for the darkest box mean relative to its bony shell
 * (with a mild distance penalty), checks the tube contrast, then centres the
 * point with a darkness-weighted mean shift. Returns `point` unchanged when
 * nothing tube-like is found.
 */
export function snapToCanal(
  read: CanalVolumeRead,
  point: Vec3,
  spacing: Vec3,
  radiusMm = 2,
): Vec3 {
  const half = boxHalf(spacing);
  const local: Vec3 = [
    point[0] - read.start[0],
    point[1] - read.start[1],
    point[2] - read.start[2],
  ];
  const reachMm = radiusMm + SHELL_MM;
  const lo = [0, 0, 0] as Vec3;
  const hi = [0, 0, 0] as Vec3;
  for (let a = 0; a < 3; a++) {
    lo[a] = Math.max(0, Math.floor(local[a] - reachMm / spacing[a]) - half[a]);
    hi[a] = Math.min(read.shape[a] - 1, Math.ceil(local[a] + reachMm / spacing[a]) + half[a]);
    if (lo[a] > hi[a]) return point;
  }
  const shape: Vec3 = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1];
  const raw = extractBlock(read, lo, hi);
  const mean = boxMean3(raw, shape, half);
  // Contrast scale from the whole crop, so plain bone noise is not a tube.
  const [p5, p95] = cropPercentiles(read, [0.05, 0.95]);
  const range = Math.max(1e-6, p95 - p5);
  const offsets = shellOffsets(SHELL_MM, spacing);
  const buf = new Float64Array(26);
  const c: Vec3 = [local[0] - lo[0], local[1] - lo[1], local[2] - lo[2]];

  let best = -1;
  let bestScore = Infinity;
  let bestTop = 0;
  const r: Vec3 = [radiusMm / spacing[0], radiusMm / spacing[1], radiusMm / spacing[2]];
  for (let z = Math.max(0, Math.ceil(c[2] - r[2])); z <= Math.min(shape[2] - 1, c[2] + r[2]); z++) {
    for (let y = Math.max(0, Math.ceil(c[1] - r[1])); y <= Math.min(shape[1] - 1, c[1] + r[1]); y++) {
      for (let x = Math.max(0, Math.ceil(c[0] - r[0])); x <= Math.min(shape[0] - 1, c[0] + r[0]); x++) {
        const d = Math.hypot(
          (x - c[0]) * spacing[0],
          (y - c[1]) * spacing[1],
          (z - c[2]) * spacing[2],
        );
        if (d > radiusMm) continue;
        const n = sortedShell(mean, shape, x, y, z, offsets, buf);
        if (n < 8) continue;
        // Upper half of the shell: the bony wall even where the tube runs on.
        let top = 0;
        const from = Math.floor(n / 2);
        for (let k = from; k < n; k++) top += buf[k];
        top /= n - from;
        const m = mean[x + shape[0] * (y + shape[1] * z)];
        const score = m - top + 0.2 * range * (d / radiusMm) ** 2;
        if (score < bestScore) {
          bestScore = score;
          best = x + shape[0] * (y + shape[1] * z);
          bestTop = top;
        }
      }
    }
  }
  if (best < 0) return point;
  const bestMean = mean[best];
  if (bestTop - bestMean < 0.08 * range) return point;

  // Mean shift on darkness so the point settles on the tube axis.
  const thr = (bestMean + bestTop) / 2;
  const bx = best % shape[0];
  const by = Math.floor(best / shape[0]) % shape[1];
  const bz = Math.floor(best / (shape[0] * shape[1]));
  let cur: Vec3 = [bx, by, bz];
  const sigma = 0.75;
  const win: Vec3 = [
    Math.ceil((2 * sigma) / spacing[0]),
    Math.ceil((2 * sigma) / spacing[1]),
    Math.ceil((2 * sigma) / spacing[2]),
  ];
  for (let iter = 0; iter < 20; iter++) {
    let sw = 0;
    const acc: Vec3 = [0, 0, 0];
    const cx = Math.round(cur[0]);
    const cy = Math.round(cur[1]);
    const cz = Math.round(cur[2]);
    for (let z = Math.max(0, cz - win[2]); z <= Math.min(shape[2] - 1, cz + win[2]); z++) {
      for (let y = Math.max(0, cy - win[1]); y <= Math.min(shape[1] - 1, cy + win[1]); y++) {
        for (let x = Math.max(0, cx - win[0]); x <= Math.min(shape[0] - 1, cx + win[0]); x++) {
          const v = raw[x + shape[0] * (y + shape[1] * z)];
          if (v >= thr) continue;
          const d2 =
            ((x - cur[0]) * spacing[0]) ** 2 +
            ((y - cur[1]) * spacing[1]) ** 2 +
            ((z - cur[2]) * spacing[2]) ** 2;
          const w = (thr - v) * Math.exp(-d2 / (2 * sigma * sigma));
          sw += w;
          acc[0] += w * x;
          acc[1] += w * y;
          acc[2] += w * z;
        }
      }
    }
    if (sw <= 0) break;
    const next: Vec3 = [acc[0] / sw, acc[1] / sw, acc[2] / sw];
    const moved = distMm(next, cur, spacing);
    cur = next;
    if (moved < 0.01) break;
  }
  const result: Vec3 = [cur[0] + lo[0] + read.start[0], cur[1] + lo[1] + read.start[1], cur[2] + lo[2] + read.start[2]];
  if (distMm(result, point, spacing) > radiusMm) {
    return [bx + lo[0] + read.start[0], by + lo[1] + read.start[1], bz + lo[2] + read.start[2]];
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Path tracing                                                        */
/* ------------------------------------------------------------------ */

/** Binary min-heap of (priority, node) pairs with lazy deletion. */
class NodeHeap {
  private keys = new Float64Array(1024);
  private nodes = new Int32Array(1024);
  size = 0;

  push(key: number, node: number): void {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2);
      keys.set(this.keys);
      this.keys = keys;
      const nodes = new Int32Array(this.size * 2);
      nodes.set(this.nodes);
      this.nodes = nodes;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.keys[i] = this.keys[p];
      this.nodes[i] = this.nodes[p];
      i = p;
    }
    this.keys[i] = key;
    this.nodes[i] = node;
  }

  /** Removes the minimum and returns its node. */
  pop(): number {
    const top = this.nodes[0];
    const last = --this.size;
    const key = this.keys[last];
    const node = this.nodes[last];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= last) break;
      if (c + 1 < last && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= key) break;
      this.keys[i] = this.keys[c];
      this.nodes[i] = this.nodes[c];
      i = c;
    }
    this.keys[i] = key;
    this.nodes[i] = node;
    return top;
  }

  peekKey(): number {
    return this.keys[0];
  }
}

/**
 * Semi-automatic tracing between two clicks on the canal: a minimum-cost
 * (A*) path through dark voxels that are wrapped in bone, searched inside the
 * bounding box of the clicks padded by `corridorMm`. Returns a simplified
 * polyline in voxel coords, starting at `from` and ending at `to`.
 */
export function traceCanalPath(
  read: CanalVolumeRead,
  from: Vec3,
  to: Vec3,
  spacing: Vec3,
  options: { corridorMm?: number; downsample?: number } = {},
): Vec3[] {
  const corridorMm = options.corridorMm ?? 8;
  const lo = [0, 0, 0] as Vec3;
  const hi = [0, 0, 0] as Vec3;
  for (let a = 0; a < 3; a++) {
    const pad = corridorMm / spacing[a];
    const f = from[a] - read.start[a];
    const t = to[a] - read.start[a];
    lo[a] = clamp(Math.floor(Math.min(f, t) - pad), 0, read.shape[a] - 1);
    hi[a] = clamp(Math.ceil(Math.max(f, t) + pad), 0, read.shape[a] - 1);
  }
  const count = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
  let ds = Math.max(1, Math.round(options.downsample ?? 0));
  if (!options.downsample) {
    ds = 1;
    while (ds < 4 && count / ds ** 3 > 1.2e6) ds++;
  }
  const { values, shape } = downsampleBlock(read, lo, hi, ds);
  const gs: Vec3 = [spacing[0] * ds, spacing[1] * ds, spacing[2] * ds];
  const mean = boxMean3(values, shape, boxHalf(gs));
  const [nx, ny, nz] = shape;
  const plane = nx * ny;

  const toNode = (p: Vec3): number => {
    const g = [0, 1, 2].map((a) =>
      clamp(Math.round((p[a] - read.start[a] - lo[a] - (ds - 1) / 2) / ds), 0, shape[a] - 1),
    );
    return g[0] + nx * (g[1] + ny * g[2]);
  };
  const source = toNode(from);
  const target = toNode(to);

  // Intensity references from the clicks: dark lumen and bright bony wall.
  const offsets = shellOffsets(SHELL_MM, gs);
  const buf = new Float64Array(26);
  const endpointRefs = (node: number): [number, number] => {
    const x0 = node % nx;
    const y0 = Math.floor(node / nx) % ny;
    const z0 = Math.floor(node / plane);
    let dark = Infinity;
    let bright = -Infinity;
    const r = [0, 1, 2].map((a) => Math.ceil(1 / gs[a]));
    for (let z = Math.max(0, z0 - r[2]); z <= Math.min(nz - 1, z0 + r[2]); z++) {
      for (let y = Math.max(0, y0 - r[1]); y <= Math.min(ny - 1, y0 + r[1]); y++) {
        for (let x = Math.max(0, x0 - r[0]); x <= Math.min(nx - 1, x0 + r[0]); x++) {
          dark = Math.min(dark, mean[x + nx * (y + ny * z)]);
        }
      }
    }
    const n = sortedShell(mean, shape, x0, y0, z0, offsets, buf);
    for (let k = 0; k < n; k++) bright = Math.max(bright, buf[k]);
    return [dark, bright];
  };
  const [darkA, brightA] = endpointRefs(source);
  const [darkB, brightB] = endpointRefs(target);
  let dark = (darkA + darkB) / 2;
  let bright = Math.min(brightA, brightB);
  const [p10, p90] = samplePercentiles(mean, [0.1, 0.9]);
  if (!(bright - dark > 0.1 * (p90 - p10))) {
    dark = p10;
    bright = p90;
  }
  const range = Math.max(1e-6, bright - dark);
  const boneThr = dark + 0.5 * range;

  // Per-node cost (per mm), computed lazily for the nodes the search visits.
  const cost = new Float32Array(mean.length).fill(-1);
  const nodeCost = (node: number): number => {
    let c = cost[node];
    if (c >= 0) return c;
    const x = node % nx;
    const y = Math.floor(node / nx) % ny;
    const z = Math.floor(node / plane);
    const norm = clamp((mean[node] - dark) / range, 0, 1);
    c = PATH_EPS + norm * norm;
    // The canal is wrapped in bone: most of its shell must be bright.
    const n = sortedShell(mean, shape, x, y, z, offsets, buf);
    if (n > 0) {
      const q = buf[Math.floor(0.25 * (n - 1))];
      if (q < boneThr) c += NO_BONE_COST * Math.min(1, (boneThr - q) / (0.5 * range));
    }
    cost[node] = c;
    return c;
  };

  const nbDx = new Int32Array(26);
  const nbDy = new Int32Array(26);
  const nbDz = new Int32Array(26);
  const nbStep = new Int32Array(26);
  const nbLen = new Float64Array(26);
  let nbCount = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy && !dz) continue;
        nbDx[nbCount] = dx;
        nbDy[nbCount] = dy;
        nbDz[nbCount] = dz;
        nbStep[nbCount] = dx + nx * (dy + ny * dz);
        nbLen[nbCount++] = Math.hypot(dx * gs[0], dy * gs[1], dz * gs[2]);
      }
    }
  }
  const tx = target % nx;
  const ty = Math.floor(target / nx) % ny;
  const tz = Math.floor(target / plane);

  const dist = new Float64Array(mean.length).fill(Infinity);
  const parent = new Int32Array(mean.length).fill(-1);
  const done = new Uint8Array(mean.length);
  const heap = new NodeHeap();
  dist[source] = 0;
  heap.push(0, source);
  while (heap.size > 0) {
    const node = heap.pop();
    if (done[node]) continue;
    done[node] = 1;
    if (node === target) break;
    const x = node % nx;
    const y = Math.floor(node / nx) % ny;
    const z = Math.floor(node / plane);
    const border = x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1;
    const c0 = nodeCost(node);
    const d0 = dist[node];
    for (let k = 0; k < 26; k++) {
      if (border) {
        const X = x + nbDx[k];
        const Y = y + nbDy[k];
        const Z = z + nbDz[k];
        if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
      }
      const m = node + nbStep[k];
      if (done[m]) continue;
      const d = d0 + 0.5 * (c0 + nodeCost(m)) * nbLen[k];
      if (d < dist[m]) {
        dist[m] = d;
        parent[m] = node;
        // A* with an admissible straight-line bound at the cheapest cost.
        const hx = (x + nbDx[k] - tx) * gs[0];
        const hy = (y + nbDy[k] - ty) * gs[1];
        const hz = (z + nbDz[k] - tz) * gs[2];
        heap.push(d + PATH_EPS * Math.sqrt(hx * hx + hy * hy + hz * hz), m);
      }
    }
  }

  const path: Vec3[] = [];
  if (parent[target] < 0 && target !== source) return [from, to];
  for (let node = target; node >= 0; node = parent[node]) {
    const x = node % nx;
    const y = Math.floor(node / nx) % ny;
    const z = Math.floor(node / plane);
    path.push([
      read.start[0] + lo[0] + x * ds + (ds - 1) / 2,
      read.start[1] + lo[1] + y * ds + (ds - 1) / 2,
      read.start[2] + lo[2] + z * ds + (ds - 1) / 2,
    ]);
    if (node === source) break;
  }
  path.reverse();
  path[0] = [...from];
  if (path.length < 2) path.push([...to]);
  else path[path.length - 1] = [...to];
  return simplifyPolyline(path, spacing, 0.5);
}

/** Douglas–Peucker simplification with a tolerance in millimetres. */
export function simplifyPolyline(points: Vec3[], spacing: Vec3, toleranceMm: number): Vec3[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let worstD = toleranceMm;
    for (let i = a + 1; i < b; i++) {
      const d = pointSegmentMm(points[i], points[a], points[b], spacing).dist;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Distance (mm) from p to segment ab, all in voxel coords, and the closest t. */
function pointSegmentMm(
  p: Vec3,
  a: Vec3,
  b: Vec3,
  spacing: Vec3,
): { dist: number; t: number } {
  const ab = [(b[0] - a[0]) * spacing[0], (b[1] - a[1]) * spacing[1], (b[2] - a[2]) * spacing[2]];
  const ap = [(p[0] - a[0]) * spacing[0], (p[1] - a[1]) * spacing[1], (p[2] - a[2]) * spacing[2]];
  const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = len2 > 0 ? clamp((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2, 0, 1) : 0;
  return {
    dist: Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]),
    t,
  };
}

/* ------------------------------------------------------------------ */
/* Slice marks                                                         */
/* ------------------------------------------------------------------ */

/** Volume axis normal to the slice, and the slice's (horizontal, vertical) axes. */
function sliceAxes(axis: VolumeAxis): { normal: number; u: number; v: number } {
  if (axis === VolumeAxis.Axial) return { normal: 2, u: 0, v: 1 };
  if (axis === VolumeAxis.Coronal) return { normal: 1, u: 0, v: 2 };
  return { normal: 0, u: 1, v: 2 };
}

/**
 * Viewer ratio coordinates of a voxel on a slice: the exact inverse of
 * `axisPointToVoxel` (coronal and sagittal show superior at the top).
 */
export function voxelToAxisPoint(axis: VolumeAxis, voxel: Vec3, dims: Vec3): SliceRatioPoint {
  const { u, v } = sliceAxes(axis);
  const xRatio = voxel[u] / Math.max(1, dims[u] - 1);
  const yRatio = voxel[v] / Math.max(1, dims[v] - 1);
  return { xRatio, yRatio: axis === VolumeAxis.Axial ? yRatio : 1 - yRatio };
}

/**
 * How to draw the canal on one slice: an ellipse wherever the centreline
 * crosses the slice plane (its bounding extent for an oblique crossing), and
 * the stretches of centreline within ±`radiusMm` of the plane as polylines.
 */
export function canalSliceMarks(
  centerline: Vec3[],
  radiusMm: number,
  axis: VolumeAxis,
  index: number,
  dims: Vec3,
  spacing: Vec3,
): CanalSliceMark[] {
  const { normal, u, v } = sliceAxes(axis);
  const marks: CanalSliceMark[] = [];
  const crossings: Vec3[] = [];
  const rxBase = radiusMm / spacing[u] / Math.max(1, dims[u] - 1);
  const ryBase = radiusMm / spacing[v] / Math.max(1, dims[v] - 1);

  for (let i = 0; i + 1 < centerline.length; i++) {
    const a = centerline[i];
    const b = centerline[i + 1];
    if (a[normal] < index === b[normal] < index) continue;
    const span = b[normal] - a[normal];
    const t = span === 0 ? 0 : (index - a[normal]) / span;
    const p = lerp3(a, b, t);
    if (crossings.some((q) => distMm(p, q, spacing) < 0.5 * radiusMm)) continue;
    crossings.push(p);
    // Tilted tube: the cut ellipse stretches along the in-plane tangent.
    const tan = [
      (b[0] - a[0]) * spacing[0],
      (b[1] - a[1]) * spacing[1],
      (b[2] - a[2]) * spacing[2],
    ];
    const tn = Math.max(Math.abs(tan[normal]), 1e-9);
    const stretch = (c: number) => Math.min(4, Math.sqrt(1 + (tan[c] / tn) ** 2));
    marks.push({
      kind: 'cross',
      center: voxelToAxisPoint(axis, p, dims),
      radiusXRatio: rxBase * stretch(u),
      radiusYRatio: ryBase * stretch(v),
    });
  }

  // Centreline stretches inside the slab |n - index| * spacing <= radius.
  const slab = radiusMm / spacing[normal];
  let run: Vec3[] | null = null;
  const flush = () => {
    if (run && run.length >= 2) {
      marks.push({ kind: 'path', points: run.map((p) => voxelToAxisPoint(axis, p, dims)) });
    }
    run = null;
  };
  for (let i = 0; i + 1 < centerline.length; i++) {
    const a = centerline[i];
    const b = centerline[i + 1];
    const da = a[normal] - index;
    const db = b[normal] - index;
    let t0 = 0;
    let t1 = 1;
    const dd = db - da;
    if (dd === 0) {
      if (Math.abs(da) > slab) {
        flush();
        continue;
      }
    } else {
      let ta = (-slab - da) / dd;
      let tb = (slab - da) / dd;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(0, ta);
      t1 = Math.min(1, tb);
      if (t0 > t1) {
        flush();
        continue;
      }
    }
    if (!run || t0 > 0) {
      flush();
      run = [lerp3(a, b, t0)];
    }
    run.push(lerp3(a, b, t1));
    if (t1 < 1) flush();
  }
  flush();
  return marks;
}

/* ------------------------------------------------------------------ */
/* Tooth distances                                                     */
/* ------------------------------------------------------------------ */

/**
 * Closest approach of each tooth to the canal: surface voxel to centreline
 * distance minus the canal radius (negative when the canal runs into the
 * tooth). Teeth without voxels are left out.
 */
export function toothCanalDistances(
  centerline: Vec3[],
  radiusMm: number,
  spacing: Vec3,
  teeth: CanalToothLabels[],
): ToothCanalDistance[] {
  if (!centerline.length) return [];
  const segs: Array<{ a: Vec3; b: Vec3; min: Vec3; max: Vec3 }> = [];
  for (let i = 0; i < Math.max(1, centerline.length - 1); i++) {
    const a = toMm(centerline[i], spacing);
    const b = toMm(centerline[Math.min(i + 1, centerline.length - 1)], spacing);
    segs.push({
      a,
      b,
      min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
      max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
    });
  }
  const results: ToothCanalDistance[] = [];
  for (const tooth of teeth) {
    const surface = toothSurface(tooth, spacing);
    if (!surface.count) continue;
    const pts = surface.mm;
    // Visit segments nearest the tooth's box first; stop once even the box
    // bound cannot beat the best distance found.
    const order = segs
      .map((s, i) => ({ i, bound: boxBoxDist(s.min, s.max, surface.min, surface.max) }))
      .sort((p, q) => p.bound - q.bound);
    let best = Infinity;
    let bestP = 0;
    let bestQ: Vec3 = [0, 0, 0];
    for (const { i, bound } of order) {
      if (bound >= best) break;
      const s = segs[i];
      const ab = sub3(s.b, s.a);
      const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
      for (let k = 0; k < surface.count; k++) {
        const px = pts[3 * k];
        const py = pts[3 * k + 1];
        const pz = pts[3 * k + 2];
        // Cheap point-to-box bound before the exact segment distance.
        const bx = Math.max(s.min[0] - px, 0, px - s.max[0]);
        const by = Math.max(s.min[1] - py, 0, py - s.max[1]);
        const bz = Math.max(s.min[2] - pz, 0, pz - s.max[2]);
        if (bx * bx + by * by + bz * bz >= best * best) continue;
        const apx = px - s.a[0];
        const apy = py - s.a[1];
        const apz = pz - s.a[2];
        const t = len2 > 0 ? clamp((apx * ab[0] + apy * ab[1] + apz * ab[2]) / len2, 0, 1) : 0;
        const d = Math.hypot(apx - t * ab[0], apy - t * ab[1], apz - t * ab[2]);
        if (d < best) {
          best = d;
          bestP = k;
          bestQ = [s.a[0] + t * ab[0], s.a[1] + t * ab[1], s.a[2] + t * ab[2]];
        }
      }
    }
    let distanceMm = best - radiusMm;
    let toothPoint = fromMm([pts[3 * bestP], pts[3 * bestP + 1], pts[3 * bestP + 2]], spacing);
    let canalPoint = fromMm(bestQ, spacing);

    // Centreline running through the tooth: report how deep it goes.
    let deepest = -1;
    for (const c of densify(centerline, spacing, 0.25)) {
      if (!insideTooth(tooth, c)) continue;
      const cm = toMm(c, spacing);
      let depth = Infinity;
      let nearest = 0;
      for (let k = 0; k < surface.count; k++) {
        const d = Math.hypot(pts[3 * k] - cm[0], pts[3 * k + 1] - cm[1], pts[3 * k + 2] - cm[2]);
        if (d < depth) {
          depth = d;
          nearest = k;
        }
      }
      if (depth > deepest) {
        deepest = depth;
        distanceMm = -(radiusMm + depth);
        toothPoint = fromMm([pts[3 * nearest], pts[3 * nearest + 1], pts[3 * nearest + 2]], spacing);
        canalPoint = c;
      }
    }
    results.push({ id: tooth.id, distanceMm, toothPoint, canalPoint });
  }
  return results;
}

function boxBoxDist(aMin: Vec3, aMax: Vec3, bMin: Vec3, bMax: Vec3): number {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const gap = Math.max(aMin[i] - bMax[i], bMin[i] - aMax[i], 0);
    s += gap * gap;
  }
  return Math.sqrt(s);
}

/** Tooth voxels with a 6-neighbour outside the tooth, as packed mm coords. */
function toothSurface(
  tooth: CanalToothLabels,
  spacing: Vec3,
): { mm: Float64Array; count: number; min: Vec3; max: Vec3 } {
  const [sx, sy, sz] = tooth.shape;
  const { labels, value, start } = tooth;
  const coords: number[] = [];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const at = (x: number, y: number, z: number) =>
    x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && labels[x + sx * (y + sy * z)] === value;
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        if (labels[x + sx * (y + sy * z)] !== value) continue;
        if (
          at(x - 1, y, z) && at(x + 1, y, z) &&
          at(x, y - 1, z) && at(x, y + 1, z) &&
          at(x, y, z - 1) && at(x, y, z + 1)
        ) {
          continue;
        }
        const p: Vec3 = [
          (x + start[0]) * spacing[0],
          (y + start[1]) * spacing[1],
          (z + start[2]) * spacing[2],
        ];
        coords.push(p[0], p[1], p[2]);
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], p[i]);
          max[i] = Math.max(max[i], p[i]);
        }
      }
    }
  }
  return { mm: Float64Array.from(coords), count: coords.length / 3, min, max };
}

function insideTooth(tooth: CanalToothLabels, p: Vec3): boolean {
  const x = Math.round(p[0] - tooth.start[0]);
  const y = Math.round(p[1] - tooth.start[1]);
  const z = Math.round(p[2] - tooth.start[2]);
  const [sx, sy, sz] = tooth.shape;
  if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return false;
  return tooth.labels[x + sx * (y + sy * z)] === tooth.value;
}

/** Polyline points no more than `stepMm` apart. */
function densify(points: Vec3[], spacing: Vec3, stepMm: number): Vec3[] {
  const out: Vec3[] = points.length ? [points[0]] : [];
  for (let i = 0; i + 1 < points.length; i++) {
    const n = Math.max(1, Math.ceil(distMm(points[i], points[i + 1], spacing) / stepMm));
    for (let k = 1; k <= n; k++) out.push(lerp3(points[i], points[i + 1], k / n));
  }
  return out;
}
