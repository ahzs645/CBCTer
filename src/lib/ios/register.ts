import type { Vec3 } from '../../types';
import type { TriMesh } from './meshIo';

/**
 * Rigid registration of an intraoral scan (IOS) surface onto CBCT crowns.
 * Points are flat xyz arrays in mm; matrices are 4×4 row-major.
 */

/**
 * Centres (mm, scan frame) of boundary voxels of the selected labels in an
 * x-fastest crop. `keep` drops voxels (e.g. roots below a gumline) without
 * turning the cut into a surface, since an IOS never sees that cut face.
 */
export function crownSurfacePoints(
  labels: Uint16Array,
  shape: Vec3,
  start: Vec3,
  spacing: Vec3,
  values: Set<number>,
  keep?: (zIndexInCrop: number, value: number) => boolean,
): Float32Array {
  const [sx, sy, sz] = shape;
  const plane = sx * sy;
  const selected = new Uint8Array(65536);
  for (const v of values) if (v >= 0 && v < 65536) selected[v] = 1;
  const isSel = (i: number) => selected[labels[i]] === 1;
  const out: number[] = [];
  for (let z = 0; z < sz; z++)
    for (let y = 0; y < sy; y++)
      for (let x = 0; x < sx; x++) {
        const i = z * plane + y * sx + x;
        const value = labels[i];
        if (!selected[value] || (keep && !keep(z, value))) continue;
        const boundary =
          x === 0 ||
          x === sx - 1 ||
          y === 0 ||
          y === sy - 1 ||
          z === 0 ||
          z === sz - 1 ||
          !isSel(i - 1) ||
          !isSel(i + 1) ||
          !isSel(i - sx) ||
          !isSel(i + sx) ||
          !isSel(i - plane) ||
          !isSel(i + plane);
        if (boundary)
          out.push(
            (start[0] + x) * spacing[0],
            (start[1] + y) * spacing[1],
            (start[2] + z) * spacing[2],
          );
      }
  return Float32Array.from(out);
}

export interface RegisterOptions {
  /** Cap on points per cloud after deterministic subsampling (15000). */
  maxPoints?: number;
  /** Maximum iterations per fine pass (100). */
  iterations?: number;
  /** Fraction of closest pairs kept by trimmed ICP passes (0.7). */
  trim?: number;
  /**
   * Finish with gated point-to-plane passes (true). When false the fine
   * stage is plain trimmed point-to-point ICP.
   */
  refine?: boolean;
  /**
   * Start pose (4×4 row-major, moving→fixed), e.g. from `rigidFromPairs` on
   * picked landmarks or an earlier registration; skips the coarse search.
   */
  initial?: Float64Array;
}

export interface RegisterResult {
  /** 4×4 row-major, maps moving → fixed. */
  matrix: Float64Array;
  /**
   * RMS (mm) over the kept pairs at the final pose: distance to the fixed
   * surface (point-to-plane) when refined, else to the nearest fixed point.
   */
  rms: number;
  /** Share of moving points within 0.5 mm of a fixed point (the overlap). */
  inlierRatio: number;
  /** Fine-stage iterations run. */
  iterations: number;
}

/**
 * Rigidly register `moving` (e.g. IOS vertices) onto `fixed` (CBCT crowns).
 *
 * Coarse: centroids aligned and principal frames matched in all 24 axis
 * orders/signs; each start gets a few trimmed ICP iterations on a small
 * subset, the best four (by a truncated distance score, so gingiva and palate
 * cannot dominate) are refined through 4 → 2 → 1 → 0.5 mm gates and the best
 * kept.
 * Fine: gated ICP on all subsampled points until the RMS changes < 1e-4 mm.
 * Trimmed passes use point-to-point Horn steps; gated passes use
 * point-to-plane steps, which converge in a few iterations once aligned.
 */
export function registerRigid(
  moving: Float32Array,
  fixed: Float32Array,
  options: RegisterOptions = {},
): RegisterResult {
  const maxPoints = options.maxPoints ?? 15000;
  const trim = Math.min(1, Math.max(0.05, options.trim ?? 0.7));
  if (moving.length < 9 || fixed.length < 9)
    throw new Error('Registration needs at least 3 points in each surface.');
  const m = subsample(moving, maxPoints, 1);
  const f = subsample(fixed, maxPoints, 2);
  const tree = new KdTree(f);

  const iterations = options.iterations ?? 100;
  const refine = options.refine !== false;
  // Subsamples are in random order, so prefixes are smaller random subsets.
  const sample = (k: number) => m.subarray(0, 3 * k);
  let fine: { pose: Pose; rms: number; iterations: number };
  if (options.initial) {
    const start = poseFromMatrix(options.initial);
    fine = refine
      ? { pose: start, rms: 0, iterations: 0 }
      : icp(m, tree, start, iterations, trim, 1e-4);
  } else {
    // Rank all PCA starts on a few points, then refine the best few. Scores
    // are truncated (robust) so gingiva and palate cannot dominate them.
    const coarseTree = new KdTree(f.subarray(0, 3 * 4000));
    const few = sample(600);
    const ranked = pcaCandidates(m, f)
      .map((start) => {
        const { pose } = icp(few, coarseTree, start, 8, trim, 1e-3);
        return { pose, score: truncatedScore(few, coarseTree, pose, 2) };
      })
      .sort((a, b) => a.score - b.score);
    const some = sample(2000);
    let best = { pose: ranked[0].pose, score: Infinity };
    for (const c of ranked.slice(0, COARSE_KEEP)) {
      // No trimmed pass here: with > 1 − trim gingiva it drags good starts off.
      let pose = c.pose;
      for (const gate of COARSE_GATES)
        pose = icp(some, tree, pose, 25, { maxDist: gate }, 1e-4).pose;
      const score = truncatedScore(some, tree, pose, MIN_GATE);
      if (score < best.score) best = { pose, score };
    }
    fine = refine
      ? { pose: best.pose, rms: 0, iterations: 0 }
      : icp(m, tree, best.pose, iterations, trim, 1e-4);
  }
  let total = fine.iterations;
  // Distance gates ignore gingiva/palate however much of the scan they are
  // (a fixed trim keeps some once they exceed 1 − trim). The coarse search
  // already ends at the smallest gate; a caller's start shrinks from 3 mm.
  for (let gate = options.initial ? INITIAL_GATE : MIN_GATE; refine; ) {
    fine = icp(m, tree, fine.pose, iterations, { maxDist: gate }, 1e-4);
    total += fine.iterations;
    const next = Math.max(MIN_GATE, Math.min(gate / 2, 3 * fine.rms));
    if (next >= gate) break;
    gate = next;
  }
  const n = m.length / 3;
  const limit = MIN_GATE ** 2;
  let inliers = 0;
  for (let i = 0; i < n; i++) {
    const [x, y, z] = apply(fine.pose, m, i);
    tree.nearest(x, y, z, limit);
    if (tree.bestIndex >= 0) inliers++;
  }
  return {
    matrix: poseToMatrix(fine.pose),
    rms: fine.rms,
    inlierRatio: inliers / n,
    iterations: total,
  };
}

/** Least-squares rigid transform mapping paired points moving[i] → fixed[i]. */
export function rigidFromPairs(
  moving: Float32Array,
  fixed: Float32Array,
): Float64Array {
  const n = Math.floor(moving.length / 3);
  if (n < 3 || fixed.length < moving.length)
    throw new Error('Rigid fit needs at least 3 point pairs.');
  const match = new Uint32Array(n);
  for (let i = 0; i < n; i++) match[i] = i;
  return poseToMatrix(
    horn(
      Float64Array.from(moving),
      Float64Array.from(fixed),
      match,
      new Uint8Array(n).fill(1),
    ),
  );
}

/** Transform xyz points by a 4×4 row-major matrix. */
export function applyMatrix(
  positions: Float32Array,
  m: Float64Array,
): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
    out[i] = m[0] * x + m[1] * y + m[2] * z + m[3];
    out[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    out[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  }
  return out;
}

/** Triangles whose three vertices all lie within `maxDistanceMm` of a target. */
export function cropMeshNear(
  mesh: TriMesh,
  targets: Float32Array,
  maxDistanceMm: number,
): TriMesh {
  const n = mesh.positions.length / 3;
  const near = new Uint8Array(n);
  if (targets.length >= 3) {
    const tree = new KdTree(targets);
    const limit = maxDistanceMm * maxDistanceMm;
    const p = mesh.positions;
    for (let v = 0; v < n; v++) {
      tree.nearest(p[v * 3], p[v * 3 + 1], p[v * 3 + 2], limit);
      near[v] = tree.bestIndex >= 0 ? 1 : 0;
    }
  }
  const remap = new Int32Array(n).fill(-1);
  const kept: number[] = [];
  let count = 0;
  const idx = mesh.indices;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t],
      b = idx[t + 1],
      c = idx[t + 2];
    if (!near[a] || !near[b] || !near[c]) continue;
    for (const v of [a, b, c]) {
      if (remap[v] < 0) remap[v] = count++;
      kept.push(remap[v]);
    }
  }
  const positions = new Float32Array(count * 3);
  for (let v = 0; v < n; v++)
    if (remap[v] >= 0)
      positions.set(mesh.positions.subarray(v * 3, v * 3 + 3), remap[v] * 3);
  return { positions, indices: Uint32Array.from(kept) };
}

/** Distance (mm) from each point of `a` to its nearest point of `b`. */
export function surfaceDeviation(
  a: Float32Array,
  b: Float32Array,
): { mean: number; p95: number; max: number } {
  const n = a.length / 3;
  if (n === 0 || b.length < 3) return { mean: 0, p95: 0, max: 0 };
  const tree = new KdTree(b);
  const d = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    tree.nearest(a[i * 3], a[i * 3 + 1], a[i * 3 + 2], Infinity);
    d[i] = Math.sqrt(tree.bestD2);
    sum += d[i];
  }
  d.sort();
  return {
    mean: sum / n,
    p95: d[Math.min(n - 1, Math.floor(0.95 * n))],
    max: d[n - 1],
  };
}

// --- internals --------------------------------------------------------------

/** Rotation (row-major 3×3) and translation. */
interface Pose {
  r: Float64Array;
  t: Float64Array;
}

function poseFromMatrix(m: Float64Array): Pose {
  return {
    r: Float64Array.of(m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]),
    t: Float64Array.of(m[3], m[7], m[11]),
  };
}

function poseToMatrix({ r, t }: Pose): Float64Array {
  // prettier-ignore
  return Float64Array.of(
    r[0], r[1], r[2], t[0],
    r[3], r[4], r[5], t[1],
    r[6], r[7], r[8], t[2],
    0, 0, 0, 1,
  );
}

function apply({ r, t }: Pose, p: Float64Array, i: number): Vec3 {
  const x = p[i * 3],
    y = p[i * 3 + 1],
    z = p[i * 3 + 2];
  return [
    r[0] * x + r[1] * y + r[2] * z + t[0],
    r[3] * x + r[4] * y + r[5] * z + t[1],
    r[6] * x + r[7] * y + r[8] * z + t[2],
  ];
}

/** Deterministic random subset (in shuffled order, so prefixes are subsets too). */
function subsample(
  points: Float32Array,
  max: number,
  seed: number,
): Float64Array {
  const n = Math.floor(points.length / 3);
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const random = mulberry32(seed);
  const k = Math.min(n, max);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(random() * (n - i));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  const out = new Float64Array(k * 3);
  for (let i = 0; i < k; i++) {
    const s = order[i] * 3;
    out[i * 3] = points[s];
    out[i * 3 + 1] = points[s + 1];
    out[i * 3 + 2] = points[s + 2];
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mean of min(d², gate²) from the posed points to the tree. */
function truncatedScore(
  m: Float64Array,
  tree: KdTree,
  pose: Pose,
  gate: number,
): number {
  const n = m.length / 3;
  const limit = gate * gate;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const [x, y, z] = apply(pose, m, i);
    tree.nearest(x, y, z, limit);
    sum += tree.bestD2;
  }
  return sum / n;
}

/** Starting poses: centroids aligned, principal frames matched up to the 24 rotations of a cube. */
function pcaCandidates(m: Float64Array, f: Float64Array): Pose[] {
  const a = principalFrame(m),
    b = principalFrame(f);
  const poses: Pose[] = [];
  // prettier-ignore
  const perms = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ];
  for (const perm of perms)
    for (let signs = 0; signs < 8; signs++) {
      // S maps moving-axis k to fixed-axis perm[k] with a sign.
      const r = new Float64Array(9);
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          let s = 0;
          for (let k = 0; k < 3; k++) {
            const sign = signs & (1 << k) ? -1 : 1;
            s += b.axes[i * 3 + perm[k]] * sign * a.axes[j * 3 + k];
          }
          r[i * 3 + j] = s;
        }
      if (det3(r) < 0) continue;
      const t = Float64Array.of(
        b.centroid[0] -
          (r[0] * a.centroid[0] + r[1] * a.centroid[1] + r[2] * a.centroid[2]),
        b.centroid[1] -
          (r[3] * a.centroid[0] + r[4] * a.centroid[1] + r[5] * a.centroid[2]),
        b.centroid[2] -
          (r[6] * a.centroid[0] + r[7] * a.centroid[1] + r[8] * a.centroid[2]),
      );
      poses.push({ r, t });
    }
  return poses;
}

/** Centroid and principal axes (columns of `axes`, largest variance first). */
function principalFrame(p: Float64Array): {
  centroid: Vec3;
  axes: Float64Array;
} {
  const n = p.length / 3;
  const c: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) c[k] += p[i * 3 + k] / n;
  const cov = new Float64Array(9);
  for (let i = 0; i < n; i++) {
    const d = [p[i * 3] - c[0], p[i * 3 + 1] - c[1], p[i * 3 + 2] - c[2]];
    for (let r = 0; r < 3; r++)
      for (let s = 0; s < 3; s++) cov[r * 3 + s] += d[r] * d[s];
  }
  const { values, vectors } = jacobiEigen(cov, 3);
  const order = [0, 1, 2].sort((x, y) => values[y] - values[x]);
  const axes = new Float64Array(9);
  for (let col = 0; col < 3; col++)
    for (let row = 0; row < 3; row++)
      axes[row * 3 + col] = vectors[row * 3 + order[col]];
  return { centroid: c, axes };
}

function det3(r: Float64Array): number {
  return (
    r[0] * (r[4] * r[8] - r[5] * r[7]) -
    r[1] * (r[3] * r[8] - r[5] * r[6]) +
    r[2] * (r[3] * r[7] - r[4] * r[6])
  );
}

/** Eigen-decomposition of a symmetric n×n matrix; eigenvectors are columns. */
function jacobiEigen(
  input: Float64Array,
  n: number,
): { values: Float64Array; vectors: Float64Array } {
  const a = Float64Array.from(input);
  const v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) off += a[p * n + q] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq);
        const t =
          Math.sign(theta || 1) /
          (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1),
          s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p],
            akq = a[k * n + q];
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k],
            aqk = a[q * n + k];
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p],
            vkq = v[k * n + q];
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
  }
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) values[i] = a[i * n + i];
  return { values, vectors: v };
}

/**
 * ICP from `start`. With a `keep` fraction: trimmed point-to-point steps
 * (Horn). With `keep.maxDist`: point-to-plane steps over pairs closer than
 * that gate, which converge in far fewer iterations once roughly aligned.
 * Stops when the RMS of kept pairs changes by < `tol`.
 */
function icp(
  m: Float64Array,
  tree: KdTree,
  start: Pose,
  maxIterations: number,
  keep: number | { maxDist: number },
  tol: number,
): { pose: Pose; rms: number; iterations: number } {
  const n = m.length / 3;
  const match = new Uint32Array(n);
  const d2 = new Float64Array(n);
  const scratch = new Float64Array(n);
  const fraction = (f: number) => Math.max(3, Math.min(n, Math.ceil(f * n)));
  // Gated passes only need neighbours inside the gate; bounding the search
  // keeps far gingiva/palate points cheap.
  const gated = typeof keep !== 'number';
  const bound = gated ? keep.maxDist ** 2 : Infinity;
  // Gated passes report point-to-plane RMS: the distance to the surface
  // rather than to its nearest sample.
  const normals = gated ? tree.normals() : null;
  const residual = gated ? new Float64Array(n) : d2;
  const f = tree.points;
  let pose = start;
  let prev = Infinity,
    rms = Infinity,
    iterations = 0;
  for (let iter = 0; iter <= maxIterations; iter++) {
    for (let i = 0; i < n; i++) {
      const [x, y, z] = apply(pose, m, i);
      if (iter) tree.nearestFrom(x, y, z, match[i], bound);
      else tree.nearest(x, y, z, bound);
      if (tree.bestIndex >= 0) {
        const j = tree.bestIndex;
        match[i] = j;
        d2[i] = tree.bestD2;
        if (normals)
          residual[i] =
            ((x - f[j * 3]) * normals[j * 3] +
              (y - f[j * 3 + 1]) * normals[j * 3 + 1] +
              (z - f[j * 3 + 2]) * normals[j * 3 + 2]) **
            2;
      } else d2[i] = Infinity;
    }
    let keepCount: number;
    if (!gated) keepCount = fraction(keep);
    else {
      const limit = keep.maxDist * keep.maxDist;
      keepCount = 0;
      for (let i = 0; i < n; i++) if (d2[i] < limit) keepCount++;
      if (keepCount < 3) {
        rms = Infinity;
        break;
      }
    }
    scratch.set(d2);
    const threshold = select(scratch, keepCount - 1);
    // Pairs at the threshold may tie; take exactly keepCount of them.
    let taken = 0,
      sum = 0;
    const inlier = new Uint8Array(n);
    for (let i = 0; i < n && taken < keepCount; i++)
      if (d2[i] < threshold) {
        inlier[i] = 1;
        sum += residual[i];
        taken++;
      }
    for (let i = 0; i < n && taken < keepCount; i++)
      if (d2[i] === threshold) {
        inlier[i] = 1;
        sum += residual[i];
        taken++;
      }
    rms = Math.sqrt(sum / taken);
    if (Math.abs(prev - rms) < tol || iter === maxIterations) break;
    prev = rms;
    pose = gated
      ? planeStep(m, tree, match, inlier, pose)
      : horn(m, f, match, inlier);
    iterations = iter + 1;
  }
  return { pose, rms, iterations };
}

/** First gate (mm) when refining a caller's start pose, e.g. from landmarks. */
const INITIAL_GATE = 3;

/** Coarse starts refined to convergence before picking one. */
const COARSE_KEEP = 4;

/** Smallest distance gate (mm): CBCT and IOS crowns differ by ~0.1–0.25 mm. */
const MIN_GATE = 0.5;
/** Distance gates (mm) the coarse starts are refined through. */
const COARSE_GATES = [4, 2, 1, MIN_GATE];

/** k-th smallest value (0-based); reorders `a`. */
function select(a: Float64Array, k: number): number {
  let lo = 0,
    hi = a.length - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo,
      j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k];
}

/** Best rigid pose mapping m[i] → f[match[i]] for inliers (Horn 1987 quaternions). */
function horn(
  m: Float64Array,
  f: Float64Array,
  match: Uint32Array,
  inlier: Uint8Array,
): Pose {
  const n = m.length / 3;
  let count = 0;
  const cm = [0, 0, 0],
    cf = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (!inlier[i]) continue;
    const j = match[i] * 3;
    for (let k = 0; k < 3; k++) {
      cm[k] += m[i * 3 + k];
      cf[k] += f[j + k];
    }
    count++;
  }
  for (let k = 0; k < 3; k++) {
    cm[k] /= count;
    cf[k] /= count;
  }
  const s = new Float64Array(9);
  for (let i = 0; i < n; i++) {
    if (!inlier[i]) continue;
    const j = match[i] * 3;
    const px = m[i * 3] - cm[0],
      py = m[i * 3 + 1] - cm[1],
      pz = m[i * 3 + 2] - cm[2];
    const qx = f[j] - cf[0],
      qy = f[j + 1] - cf[1],
      qz = f[j + 2] - cf[2];
    s[0] += px * qx;
    s[1] += px * qy;
    s[2] += px * qz;
    s[3] += py * qx;
    s[4] += py * qy;
    s[5] += py * qz;
    s[6] += pz * qx;
    s[7] += pz * qy;
    s[8] += pz * qz;
  }
  const [sxx, sxy, sxz, syx, syy, syz, szx, szy, szz] = s;
  // prettier-ignore
  const nMat = Float64Array.of(
    sxx + syy + szz, syz - szy, szx - sxz, sxy - syx,
    syz - szy, sxx - syy - szz, sxy + syx, szx + sxz,
    szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy,
    sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz,
  );
  const { values, vectors } = jacobiEigen(nMat, 4);
  let best = 0;
  for (let i = 1; i < 4; i++) if (values[i] > values[best]) best = i;
  let w = vectors[best],
    x = vectors[4 + best],
    y = vectors[8 + best],
    z = vectors[12 + best];
  const len = Math.hypot(w, x, y, z) || 1;
  w /= len;
  x /= len;
  y /= len;
  z /= len;
  // prettier-ignore
  const r = Float64Array.of(
    w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z,
  );
  const t = Float64Array.of(
    cf[0] - (r[0] * cm[0] + r[1] * cm[1] + r[2] * cm[2]),
    cf[1] - (r[3] * cm[0] + r[4] * cm[1] + r[5] * cm[2]),
    cf[2] - (r[6] * cm[0] + r[7] * cm[1] + r[8] * cm[2]),
  );
  return { r, t };
}

/**
 * One linearised point-to-plane step: minimise Σ ((R p + t − q) · n)² over
 * kept pairs for a small rotation about their centroid, then compose.
 */
function planeStep(
  m: Float64Array,
  tree: KdTree,
  match: Uint32Array,
  inlier: Uint8Array,
  pose: Pose,
): Pose {
  const n = m.length / 3;
  const f = tree.points,
    normals = tree.normals();
  const moved = new Float64Array(n * 3);
  const c = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (!inlier[i]) continue;
    const p = apply(pose, m, i);
    moved.set(p, i * 3);
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
    count++;
  }
  if (count < 6) return pose;
  for (let k = 0; k < 3; k++) c[k] /= count;
  const ata = new Float64Array(36),
    atb = new Float64Array(6),
    row = new Float64Array(6);
  for (let i = 0; i < n; i++) {
    if (!inlier[i]) continue;
    const j = match[i] * 3;
    const px = moved[i * 3] - c[0],
      py = moved[i * 3 + 1] - c[1],
      pz = moved[i * 3 + 2] - c[2];
    const nx = normals[j],
      ny = normals[j + 1],
      nz = normals[j + 2];
    row[0] = py * nz - pz * ny;
    row[1] = pz * nx - px * nz;
    row[2] = px * ny - py * nx;
    row[3] = nx;
    row[4] = ny;
    row[5] = nz;
    const b =
      (f[j] - moved[i * 3]) * nx +
      (f[j + 1] - moved[i * 3 + 1]) * ny +
      (f[j + 2] - moved[i * 3 + 2]) * nz;
    for (let r = 0; r < 6; r++) {
      atb[r] += row[r] * b;
      for (let s = r; s < 6; s++) ata[r * 6 + s] += row[r] * row[s];
    }
  }
  for (let r = 0; r < 6; r++)
    for (let s = 0; s < r; s++) ata[r * 6 + s] = ata[s * 6 + r];
  const x = solve6(ata, atb);
  if (!x) return pose;
  // Exact rotation for the small-angle vector (Rodrigues).
  const angle = Math.hypot(x[0], x[1], x[2]);
  const inc = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  if (angle > 1e-12) {
    const ux = x[0] / angle,
      uy = x[1] / angle,
      uz = x[2] / angle;
    const cos = Math.cos(angle),
      sin = Math.sin(angle),
      v = 1 - cos;
    // prettier-ignore
    inc.set([
      cos + ux * ux * v, ux * uy * v - uz * sin, ux * uz * v + uy * sin,
      uy * ux * v + uz * sin, cos + uy * uy * v, uy * uz * v - ux * sin,
      uz * ux * v - uy * sin, uz * uy * v + ux * sin, cos + uz * uz * v,
    ]);
  }
  // x' = inc (x − c) + c + τ composed after the current pose.
  const r = new Float64Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] =
        inc[i * 3] * pose.r[j] +
        inc[i * 3 + 1] * pose.r[3 + j] +
        inc[i * 3 + 2] * pose.r[6 + j];
  const t = new Float64Array(3);
  for (let i = 0; i < 3; i++)
    t[i] =
      inc[i * 3] * (pose.t[0] - c[0]) +
      inc[i * 3 + 1] * (pose.t[1] - c[1]) +
      inc[i * 3 + 2] * (pose.t[2] - c[2]) +
      c[i] +
      x[3 + i];
  return { r, t };
}

/** Solve a 6×6 system by Gaussian elimination with partial pivoting. */
function solve6(a: Float64Array, b: Float64Array): Float64Array | null {
  const m = Float64Array.from(a),
    x = Float64Array.from(b);
  for (let col = 0; col < 6; col++) {
    let pivot = col;
    for (let r = col + 1; r < 6; r++)
      if (Math.abs(m[r * 6 + col]) > Math.abs(m[pivot * 6 + col])) pivot = r;
    if (Math.abs(m[pivot * 6 + col]) < 1e-12) return null;
    if (pivot !== col) {
      for (let k = 0; k < 6; k++) {
        const tmp = m[col * 6 + k];
        m[col * 6 + k] = m[pivot * 6 + k];
        m[pivot * 6 + k] = tmp;
      }
      const tmp = x[col];
      x[col] = x[pivot];
      x[pivot] = tmp;
    }
    for (let r = col + 1; r < 6; r++) {
      const factor = m[r * 6 + col] / m[col * 6 + col];
      for (let k = col; k < 6; k++) m[r * 6 + k] -= factor * m[col * 6 + k];
      x[r] -= factor * x[col];
    }
  }
  for (let r = 5; r >= 0; r--) {
    let sum = x[r];
    for (let k = r + 1; k < 6; k++) sum -= m[r * 6 + k] * x[k];
    x[r] = sum / m[r * 6 + r];
  }
  return x;
}

const LEAF = 8;
const NORMAL_NEIGHBOURS = 10;

/** Static 3-D k-d tree over xyz points for nearest-neighbour queries. */
class KdTree {
  /** Points in tree order (xyz). */
  readonly points: Float64Array;
  private readonly axis: Uint8Array;
  private qx = 0;
  private qy = 0;
  private qz = 0;
  /** Result of the last `nearest`: tree-order index (-1 if none in range) and squared distance. */
  bestIndex = -1;
  bestD2 = Infinity;

  constructor(source: Float32Array | Float64Array) {
    const n = Math.floor(source.length / 3);
    const ids = new Uint32Array(n);
    for (let i = 0; i < n; i++) ids[i] = i;
    this.axis = new Uint8Array(n);
    const stack: number[] = [0, n];
    while (stack.length) {
      const hi = stack.pop()!,
        lo = stack.pop()!;
      if (hi - lo <= LEAF) continue;
      let min0 = Infinity,
        min1 = Infinity,
        min2 = Infinity;
      let max0 = -Infinity,
        max1 = -Infinity,
        max2 = -Infinity;
      for (let i = lo; i < hi; i++) {
        const s = ids[i] * 3;
        const x = source[s],
          y = source[s + 1],
          z = source[s + 2];
        if (x < min0) min0 = x;
        if (x > max0) max0 = x;
        if (y < min1) min1 = y;
        if (y > max1) max1 = y;
        if (z < min2) min2 = z;
        if (z > max2) max2 = z;
      }
      const ex = max0 - min0,
        ey = max1 - min1,
        ez = max2 - min2;
      const a = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
      const mid = (lo + hi) >> 1;
      selectIds(ids, source, a, lo, hi - 1, mid);
      this.axis[mid] = a;
      stack.push(lo, mid, mid + 1, hi);
    }
    this.points = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const s = ids[i] * 3;
      this.points[i * 3] = source[s];
      this.points[i * 3 + 1] = source[s + 1];
      this.points[i * 3 + 2] = source[s + 2];
    }
  }

  /** As `nearest`, pruned by a previous match (ICP warm start). */
  nearestFrom(
    x: number,
    y: number,
    z: number,
    hint: number,
    maxD2: number,
  ): void {
    const p = this.points;
    this.qx = x;
    this.qy = y;
    this.qz = z;
    const d2 =
      (p[hint * 3] - x) ** 2 +
      (p[hint * 3 + 1] - y) ** 2 +
      (p[hint * 3 + 2] - z) ** 2;
    this.bestIndex = d2 < maxD2 ? hint : -1;
    this.bestD2 = Math.min(d2, maxD2);
    this.search(0, p.length / 3);
  }

  private normalCache?: Float64Array;

  /** Unit surface normals (tree order) from PCA of each point's neighbours. */
  normals(): Float64Array {
    if (this.normalCache) return this.normalCache;
    const p = this.points;
    const n = p.length / 3;
    const k = Math.min(NORMAL_NEIGHBOURS, n);
    const out = new Float64Array(n * 3);
    const idx = new Int32Array(k),
      d2 = new Float64Array(k);
    const cov = new Float64Array(9);
    for (let i = 0; i < n; i++) {
      this.kNearest(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], idx, d2);
      let cx = 0,
        cy = 0,
        cz = 0;
      for (let a = 0; a < k; a++) {
        cx += p[idx[a] * 3];
        cy += p[idx[a] * 3 + 1];
        cz += p[idx[a] * 3 + 2];
      }
      cx /= k;
      cy /= k;
      cz /= k;
      cov.fill(0);
      for (let a = 0; a < k; a++) {
        const dx = p[idx[a] * 3] - cx,
          dy = p[idx[a] * 3 + 1] - cy,
          dz = p[idx[a] * 3 + 2] - cz;
        cov[0] += dx * dx;
        cov[1] += dx * dy;
        cov[2] += dx * dz;
        cov[4] += dy * dy;
        cov[5] += dy * dz;
        cov[8] += dz * dz;
      }
      cov[3] = cov[1];
      cov[6] = cov[2];
      cov[7] = cov[5];
      const { values, vectors } = jacobiEigen(cov, 3);
      const s =
        values[0] <= values[1] && values[0] <= values[2]
          ? 0
          : values[1] <= values[2]
            ? 1
            : 2;
      out[i * 3] = vectors[s];
      out[i * 3 + 1] = vectors[3 + s];
      out[i * 3 + 2] = vectors[6 + s];
    }
    this.normalCache = out;
    return out;
  }

  /** The `idx.length` nearest points (tree order), closest first. */
  kNearest(
    x: number,
    y: number,
    z: number,
    idx: Int32Array,
    d2: Float64Array,
  ): void {
    this.qx = x;
    this.qy = y;
    this.qz = z;
    idx.fill(-1);
    d2.fill(Infinity);
    this.searchK(0, this.points.length / 3, idx, d2);
  }

  private searchK(
    lo: number,
    hi: number,
    idx: Int32Array,
    d2: Float64Array,
  ): void {
    const p = this.points;
    const k = idx.length;
    const consider = (i: number) => {
      const dx = p[i * 3] - this.qx,
        dy = p[i * 3 + 1] - this.qy,
        dz = p[i * 3 + 2] - this.qz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d >= d2[k - 1]) return;
      let j = k - 1;
      while (j > 0 && d2[j - 1] > d) {
        d2[j] = d2[j - 1];
        idx[j] = idx[j - 1];
        j--;
      }
      d2[j] = d;
      idx[j] = i;
    };
    if (hi - lo <= LEAF) {
      for (let i = lo; i < hi; i++) consider(i);
      return;
    }
    const mid = (lo + hi) >> 1;
    consider(mid);
    const a = this.axis[mid];
    const diff =
      (a === 0 ? this.qx : a === 1 ? this.qy : this.qz) - p[mid * 3 + a];
    if (diff < 0) {
      this.searchK(lo, mid, idx, d2);
      if (diff * diff < d2[k - 1]) this.searchK(mid + 1, hi, idx, d2);
    } else {
      this.searchK(mid + 1, hi, idx, d2);
      if (diff * diff < d2[k - 1]) this.searchK(lo, mid, idx, d2);
    }
  }

  /** Nearest point closer than sqrt(maxD2); sets `bestIndex` and `bestD2`. */
  nearest(x: number, y: number, z: number, maxD2: number): void {
    this.qx = x;
    this.qy = y;
    this.qz = z;
    this.bestIndex = -1;
    this.bestD2 = maxD2;
    this.search(0, this.points.length / 3);
  }

  private search(lo: number, hi: number): void {
    const p = this.points;
    if (hi - lo <= LEAF) {
      for (let i = lo; i < hi; i++) {
        const dx = p[i * 3] - this.qx,
          dy = p[i * 3 + 1] - this.qy,
          dz = p[i * 3 + 2] - this.qz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < this.bestD2) {
          this.bestD2 = d2;
          this.bestIndex = i;
        }
      }
      return;
    }
    const mid = (lo + hi) >> 1;
    const a = this.axis[mid];
    const dx = p[mid * 3] - this.qx,
      dy = p[mid * 3 + 1] - this.qy,
      dz = p[mid * 3 + 2] - this.qz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < this.bestD2) {
      this.bestD2 = d2;
      this.bestIndex = mid;
    }
    const diff = a === 0 ? -dx : a === 1 ? -dy : -dz; // query − split
    if (diff < 0) {
      this.search(lo, mid);
      if (diff * diff < this.bestD2) this.search(mid + 1, hi);
    } else {
      this.search(mid + 1, hi);
      if (diff * diff < this.bestD2) this.search(lo, mid);
    }
  }
}

/** Partition ids[lo..hi] so ids[k] holds the median along `axis`. */
function selectIds(
  ids: Uint32Array,
  src: Float32Array | Float64Array,
  axis: number,
  lo: number,
  hi: number,
  k: number,
): void {
  while (lo < hi) {
    const pivot = src[ids[(lo + hi) >> 1] * 3 + axis];
    let i = lo,
      j = hi;
    while (i <= j) {
      while (src[ids[i] * 3 + axis] < pivot) i++;
      while (src[ids[j] * 3 + axis] > pivot) j--;
      if (i <= j) {
        const tmp = ids[i];
        ids[i] = ids[j];
        ids[j] = tmp;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
}
