import type { Vec3 } from '../../types';
import { fdiArch, mirrorFdi } from '../case/toothSelection';
import {
  applyMatrix,
  crownSurfacePoints,
  registerRigid,
  surfaceDeviation,
} from '../ios/register';

/**
 * Before/after comparison of two segmented scans of the same mouth: how far
 * each tooth moved relative to the rest of the jaw. Pure and worker-safe.
 *
 * Everything is in mm in each scan's own frame (voxel index × spacing), so
 * the scans may differ in voxel size, field of view and patient position.
 * Matrices are 4×4 row-major and map the "after" scan onto the "before" one.
 */

/** One tooth's surface as a flat xyz point cloud (mm, its scan's frame). */
export interface ToothCloud {
  fdi: number | null;
  id: string;
  points: Float32Array;
  /** Crown tip (incisal edge / cusp), mm in the same frame, if known. */
  tip?: [number, number, number];
}

export interface CompareOptions {
  /**
   * Teeth (FDI numbers, "before" numbering) assumed not to have moved and
   * used to line the scans up. 'all' (default) starts from every tooth in
   * both scans and drops the ones that disagree with the rest.
   */
  reference?: 'all' | number[];
  /** Coarser voxel edge (mm) of the two scans; sets the noise floor (0.3). */
  voxelSizeMm?: number;
  /** +1 when increasing z runs toward the head (1); only for wording. */
  superiorSign?: 1 | -1;
}

export interface ToothMotion {
  /** Tooth number as in the "before" scan. */
  fdi: number;
  /** Tooth number as in the "after" scan (differs when mirrored). */
  afterFdi: number;
  beforeId: string;
  afterId: string;
  arch: 'upper' | 'lower' | null;
  /** Distance the tooth's centre moved relative to the jaw (mm). */
  translationMm: number;
  /**
   * The centre's movement in the local arch frame (mm): + mesial (toward the
   * midline along the arch), + buccal (toward cheek/lips), + scan z.
   */
  mesialMm: number;
  buccalMm: number;
  verticalMm: number;
  /** + toward the biting surface (extrusion), − into the gum; null if unknown jaw. */
  occlusalMm: number | null;
  /** Rotation relative to the jaw (degrees) and its unit axis (scan frame). */
  rotationDeg: number;
  rotationAxis: [number, number, number];
  /** 'turned' = about the long (vertical) axis, 'tipped' = about a horizontal one. */
  rotationKind: 'turned' | 'tipped';
  /** Crown tip displacement (mm) when a tip was given. */
  tipMm: number | null;
  /** RMS movement of the tooth's surface points (mm): translation plus rotation. */
  surfaceShiftMm: number;
  /** Largest of translation, surface shift and tip movement (mm); sort key. */
  movementMm: number;
  /** Point-to-plane RMS after the tooth's own fit (mm, pairs within 0.5 mm). */
  residualRmsMm: number;
  /** 95th-percentile surface distance after the tooth's own fit, both ways (mm). */
  shapeChangeMm: number;
  shapeChanged: boolean;
  /** Movement above the noise floors. */
  measurable: boolean;
  /** Used to line the scans up. */
  reference: boolean;
  /**
   * Plain-English direction, e.g. "mostly toward the cheek", "turned in
   * place" or "no measurable change".
   */
  direction: string;
}

export interface ScanComparison {
  /** Paired teeth, largest movement first. */
  teeth: ToothMotion[];
  onlyBefore: Array<{ id: string; fdi: number | null }>;
  onlyAfter: Array<{ id: string; fdi: number | null }>;
  /** Teeth ("before" numbers) that defined the jaw alignment. */
  referenceFdi: number[];
  /** True when the after scan's numbering was left/right swapped. */
  mirrored: boolean;
  /** 4×4 row-major, after → before. */
  globalMatrix: number[];
  /** Point-to-plane RMS (mm) of the reference teeth at the global pose. */
  globalRms: number;
  /** Movements below this (mm) are reported as no measurable movement. */
  noiseFloorMm: number;
  /** Rotations below this (degrees) are not reported. */
  angleFloorDeg: number;
  /** Shape changes below this (mm) are not reported. */
  shapeFloorMm: number;
  summary: string[];
}

/**
 * Boundary voxels of one tooth (mm, scan frame) from an x-fastest label
 * crop, evenly thinned to at most `maxPoints`.
 */
export function toothSurfacePoints(
  labels: Uint16Array,
  shape: Vec3,
  start: Vec3,
  spacing: Vec3,
  values: Set<number>,
  maxPoints = 4000,
): Float32Array {
  const all = crownSurfacePoints(labels, shape, start, spacing, values);
  const n = all.length / 3;
  if (n <= maxPoints) return all;
  const out = new Float32Array(maxPoints * 3);
  for (let i = 0; i < maxPoints; i++) {
    const s = Math.floor((i * n) / maxPoints) * 3;
    out[i * 3] = all[s];
    out[i * 3 + 1] = all[s + 1];
    out[i * 3 + 2] = all[s + 2];
  }
  return out;
}

/** Per-tooth fits that move more than this (mm, RMS) never count as stable. */
const MIN_DROP_MM = 0.1;
const ROBUST_ROUNDS = 3;

interface Pair {
  before: ToothCloud;
  after: ToothCloud;
  fdi: number;
}

/**
 * Compare tooth positions between two scans. See `ScanComparison`.
 *
 * 1. Teeth are paired by FDI number (or by mirrored numbers when that fits
 *    far better, e.g. one scan's segmentation swapped left and right).
 * 2. The after scan is aligned onto the before scan on the reference teeth;
 *    teeth whose own fit moves > 2× the median (and > 0.1 mm) are dropped and
 *    the fit repeated, up to 3 times, so moved teeth don't drag the jaw.
 * 3. Each tooth is then fitted on its own from the jaw pose; the difference
 *    between the two poses is its movement relative to the jaw.
 */
export function compareTeeth(
  before: ToothCloud[],
  after: ToothCloud[],
  options: CompareOptions = {},
): ScanComparison {
  const voxel = options.voxelSizeMm ?? 0.3;
  const superiorSign = options.superiorSign ?? 1;
  const usable = (t: ToothCloud) => t.points.length >= 9;
  const b = before.filter(usable),
    a = after.filter(usable);

  const direct = pairTeeth(b, a, (f) => f);
  const mirror = pairTeeth(b, a, (f) => mirrorFdi(f) ?? f);
  if (!direct.length && !mirror.length)
    throw new Error('No tooth has the same number in both scans.');

  // Mirrored numbering: line each pairing's teeth up on their own (same
  // teeth on both sides, so a different field of view can't skew the PCA
  // start) and keep the pairing whose paired teeth actually overlap.
  const trial = (pairs: Pair[]) => {
    if (!pairs.length) return { matrix: new Float64Array(0), score: Infinity };
    const matrix = registerRigid(
      concat(pairs.map((p) => p.after.points)),
      concat(pairs.map((p) => p.before.points)),
    ).matrix;
    const score = median(
      pairs.map(
        (p) =>
          surfaceDeviation(applyMatrix(p.after.points, matrix), p.before.points)
            .mean,
      ),
    );
    return { matrix, score };
  };
  const directTrial = trial(direct);
  const mirrorTrial =
    mirror.length >= 2 && mirror.some((p) => p.after.fdi !== p.before.fdi)
      ? trial(mirror)
      : { matrix: new Float64Array(0), score: Infinity };
  const mirrored = mirrorTrial.score < 0.5 * directTrial.score;
  const pairs = mirrored ? mirror : direct;
  const coarse = mirrored ? mirrorTrial.matrix : directTrial.matrix;
  if (!pairs.length)
    throw new Error('No tooth has the same number in both scans.');

  // Robust jaw alignment.
  const fixedList =
    options.reference !== undefined && options.reference !== 'all';
  const wanted = fixedList ? new Set(options.reference as number[]) : null;
  let reference = wanted ? pairs.filter((p) => wanted.has(p.fdi)) : pairs;
  if (!reference.length) reference = pairs;
  let global = { matrix: coarse, rms: 0 };
  let fits: ToothFit[] = [];
  for (let round = 0; ; round++) {
    global = registerRigid(
      concat(reference.map((p) => p.after.points)),
      concat(reference.map((p) => p.before.points)),
      { initial: global.matrix },
    );
    fits = pairs.map((p) => fitTooth(p, global.matrix));
    if (fixedList || round >= ROBUST_ROUNDS) break;
    const refShift = median(
      fits.filter((_, i) => reference.includes(pairs[i])).map((f) => f.shift),
    );
    const limit = Math.max(2 * refShift, MIN_DROP_MM);
    let next = pairs.filter((_, i) => fits[i].shift <= limit);
    const keep = Math.min(3, pairs.length);
    if (next.length < keep)
      next = pairs
        .map((p, i) => ({ p, s: fits[i].shift }))
        .sort((x, y) => x.s - y.s)
        .slice(0, keep)
        .map((x) => x.p);
    if (
      next.length === reference.length &&
      next.every((p) => reference.includes(p))
    )
      break;
    reference = next;
  }

  const isRef = (p: Pair) => reference.includes(p);
  const refFits = fits.filter((_, i) => isRef(pairs[i]));
  const noiseFloorMm = Math.max(
    0.1,
    0.5 * voxel,
    2.5 * median(refFits.map((f) => f.shift)),
  );
  const angleFloorDeg = Math.max(
    1,
    2.5 * median(refFits.map((f) => f.rotationDeg)),
  );
  const shapeFloorMm = Math.max(
    0.3,
    voxel,
    1.5 * median(refFits.map((f) => f.shapeChangeMm)),
  );

  const frames = archFrames(b);
  const teeth: ToothMotion[] = pairs.map((p, i) => {
    const f = fits[i];
    const frame = frames.get(p.before) ?? {
      mesial: [1, 0] as [number, number],
      buccal: [0, 1] as [number, number],
    };
    const [dx, dy, dz] = f.centreShift;
    const mesialMm = dx * frame.mesial[0] + dy * frame.mesial[1];
    const buccalMm = dx * frame.buccal[0] + dy * frame.buccal[1];
    const arch = fdiArch(p.fdi);
    const crownSign = arch === 'upper' ? -superiorSign : superiorSign;
    const translationMm = Math.hypot(dx, dy, dz);
    const movementMm = Math.max(translationMm, f.shift, f.tipMm ?? 0);
    const measurable =
      movementMm > noiseFloorMm || f.rotationDeg > angleFloorDeg;
    const rotationKind: ToothMotion['rotationKind'] =
      Math.abs(f.axis[2]) > 0.7 ? 'turned' : 'tipped';
    return {
      fdi: p.fdi,
      afterFdi: p.after.fdi ?? p.fdi,
      beforeId: p.before.id,
      afterId: p.after.id,
      arch,
      translationMm,
      mesialMm,
      buccalMm,
      verticalMm: dz,
      occlusalMm: arch ? dz * crownSign : null,
      rotationDeg: f.rotationDeg,
      rotationAxis: f.axis,
      rotationKind,
      tipMm: f.tipMm,
      surfaceShiftMm: f.shift,
      movementMm,
      residualRmsMm: f.rms,
      shapeChangeMm: f.shapeChangeMm,
      shapeChanged: f.shapeChangeMm > shapeFloorMm,
      measurable,
      reference: isRef(p),
      direction: !measurable
        ? 'no measurable change'
        : translationMm > noiseFloorMm
          ? directionWords(
              p.fdi,
              arch,
              { mesialMm, buccalMm, verticalMm: dz },
              crownSign,
              superiorSign,
              noiseFloorMm,
            )
          : rotationKind === 'turned'
            ? 'turned in place'
            : 'tipped in place',
    };
  });
  teeth.sort((x, y) => y.movementMm - x.movementMm);

  const pairedB = new Set(pairs.map((p) => p.before));
  const pairedA = new Set(pairs.map((p) => p.after));
  const comparison: ScanComparison = {
    teeth,
    onlyBefore: before
      .filter((t) => !pairedB.has(t))
      .map((t) => ({ id: t.id, fdi: t.fdi })),
    onlyAfter: after
      .filter((t) => !pairedA.has(t))
      .map((t) => ({ id: t.id, fdi: t.fdi })),
    referenceFdi: reference.map((p) => p.fdi).sort((x, y) => x - y),
    mirrored,
    globalMatrix: Array.from(global.matrix),
    globalRms: global.rms,
    noiseFloorMm,
    angleFloorDeg,
    shapeFloorMm,
    summary: [],
  };
  comparison.summary = summarize(comparison, fixedList);
  return comparison;
}

// --- pairing & per-tooth fits ------------------------------------------------

function pairTeeth(
  before: ToothCloud[],
  after: ToothCloud[],
  map: (fdi: number) => number,
): Pair[] {
  const byFdi = new Map<number, ToothCloud>();
  for (const t of after) if (t.fdi && !byFdi.has(t.fdi)) byFdi.set(t.fdi, t);
  const used = new Set<number>();
  const pairs: Pair[] = [];
  for (const t of before) {
    if (!t.fdi || used.has(t.fdi)) continue;
    const match = byFdi.get(map(t.fdi));
    if (!match) continue;
    used.add(t.fdi);
    pairs.push({ before: t, after: match, fdi: t.fdi });
  }
  return pairs;
}

interface ToothFit {
  /** Tooth pose, after → before. */
  matrix: Float64Array;
  rms: number;
  /** RMS distance (mm) the tooth's points move between jaw and tooth pose. */
  shift: number;
  /** Centre movement relative to the jaw (mm, before frame). */
  centreShift: Vec3;
  rotationDeg: number;
  axis: [number, number, number];
  tipMm: number | null;
  shapeChangeMm: number;
}

function fitTooth(p: Pair, jaw: Float64Array): ToothFit {
  const fit = registerRigid(p.after.points, p.before.points, {
    initial: jaw,
    maxPoints: 4000,
  });
  // Motion in the before frame: before position → where the jaw pose puts it.
  const motion = multiply(jaw, invertRigid(fit.matrix));
  const pts = p.before.points;
  const n = pts.length / 3;
  const step = Math.max(1, Math.floor(n / 1000));
  const centre: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) centre[k] += pts[i * 3 + k] / n;
  let sum = 0,
    count = 0;
  for (let i = 0; i < n; i += step) {
    const q = transform(motion, [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]]);
    sum +=
      (q[0] - pts[i * 3]) ** 2 +
      (q[1] - pts[i * 3 + 1]) ** 2 +
      (q[2] - pts[i * 3 + 2]) ** 2;
    count++;
  }
  const moved = transform(motion, centre);
  const tipBefore = p.before.tip
    ? (p.before.tip as Vec3)
    : p.after.tip
      ? transform(fit.matrix, p.after.tip as Vec3)
      : null;
  let tipMm: number | null = null;
  if (tipBefore) {
    const q = transform(motion, tipBefore);
    tipMm = Math.hypot(
      q[0] - tipBefore[0],
      q[1] - tipBefore[1],
      q[2] - tipBefore[2],
    );
  }
  const aligned = applyMatrix(p.after.points, fit.matrix);
  const shapeChangeMm = Math.max(
    surfaceDeviation(aligned, pts).p95,
    surfaceDeviation(pts, aligned).p95,
  );
  const { angle, axis } = rotationOf(motion);
  return {
    matrix: fit.matrix,
    rms: fit.rms,
    shift: Math.sqrt(sum / Math.max(1, count)),
    centreShift: [
      moved[0] - centre[0],
      moved[1] - centre[1],
      moved[2] - centre[2],
    ],
    rotationDeg: (angle * 180) / Math.PI,
    axis,
    tipMm,
    shapeChangeMm,
  };
}

// --- arch frame ---------------------------------------------------------------

interface ArchFrame {
  /** Unit xy direction along the arch toward the midline. */
  mesial: [number, number];
  /** Unit xy direction away from the arch's inside (toward cheek/lips). */
  buccal: [number, number];
}

/**
 * Local arch directions for each numbered tooth from the before-scan tooth
 * centres in the axial (xy) plane: per jaw, a parabola v = a·u² + b·u + c is
 * fitted in the principal frame of the centres (whichever orientation fits
 * better); its tangent gives mesio-distal, its normal (away from the concave
 * side) buccal. The tangent's sign points toward the next tooth with a
 * smaller number in the quadrant, or across the midline for central teeth.
 */
function archFrames(teeth: ToothCloud[]): Map<ToothCloud, ArchFrame> {
  const out = new Map<ToothCloud, ArchFrame>();
  const centres = new Map<ToothCloud, Vec3>();
  for (const t of teeth) if (t.fdi) centres.set(t, centroid(t.points));
  for (const jaw of ['upper', 'lower'] as const) {
    const group = [...centres.keys()].filter((t) => fdiArch(t.fdi) === jaw);
    if (!group.length) continue;
    const xy = group.map((t) => centres.get(t)!);
    const curve = fitArch(xy);
    group.forEach((t, i) => {
      const c = xy[i];
      let tangent = curve.tangent(c);
      let buccal: [number, number] = [-tangent[1], tangent[0]];
      if (buccal[0] * curve.inside[0] + buccal[1] * curve.inside[1] > 0)
        buccal = [-buccal[0], -buccal[1]];
      const ref = mesialReference(t, group, centres) ?? curve.apex;
      if (ref) {
        const d = [ref[0] - c[0], ref[1] - c[1]];
        if (d[0] * tangent[0] + d[1] * tangent[1] < 0)
          tangent = [-tangent[0], -tangent[1]];
      }
      out.set(t, { mesial: tangent, buccal });
    });
  }
  return out;
}

function fitArch(points: Vec3[]): {
  tangent: (p: Vec3) => [number, number];
  /** Unit xy direction toward the arch's concave side. */
  inside: [number, number];
  apex: [number, number] | null;
} {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p[0], 0) / n,
    my = points.reduce((s, p) => s + p[1], 0) / n;
  if (n < 3) {
    const d =
      n === 2
        ? normalize2([points[1][0] - points[0][0], points[1][1] - points[0][1]])
        : ([1, 0] as [number, number]);
    return { tangent: () => d, inside: [-d[1], d[0]], apex: null };
  }
  let sxx = 0,
    sxy = 0,
    syy = 0;
  for (const p of points) {
    sxx += (p[0] - mx) ** 2;
    sxy += (p[0] - mx) * (p[1] - my);
    syy += (p[1] - my) ** 2;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const major: [number, number] = [Math.cos(theta), Math.sin(theta)];
  const minor: [number, number] = [-major[1], major[0]];
  const fits = [
    { eu: major, ev: minor },
    { eu: minor, ev: major },
  ].map(({ eu, ev }) => {
    const uv = points.map((p) => {
      const x = p[0] - mx,
        y = p[1] - my;
      return [x * eu[0] + y * eu[1], x * ev[0] + y * ev[1]];
    });
    const coef = fitQuadratic(uv);
    const residual = uv.reduce(
      (s, [u, v]) => s + (v - (coef[0] * u * u + coef[1] * u + coef[2])) ** 2,
      0,
    );
    return { eu, ev, coef, residual };
  });
  // The arch normally runs along its widest direction; switch only on a
  // clearly better fit.
  const best = fits[1].residual < 0.5 * fits[0].residual ? fits[1] : fits[0];
  const { eu, ev, coef } = best;
  const [qa, qb] = coef;
  const toUv = (p: Vec3) => (p[0] - mx) * eu[0] + (p[1] - my) * eu[1];
  const tangent = (p: Vec3): [number, number] => {
    const slope = 2 * qa * toUv(p) + qb;
    return normalize2([eu[0] + slope * ev[0], eu[1] + slope * ev[1]]);
  };
  const sign = qa >= 0 ? 1 : -1;
  let inside: [number, number] = [sign * ev[0], sign * ev[1]];
  if (Math.abs(qa) < 1e-6) {
    // Straight row of teeth: no concave side to go by.
    inside = [ev[0], ev[1]];
  }
  let apex: [number, number] | null = null;
  if (Math.abs(qa) > 1e-6) {
    const u0 = -qb / (2 * qa);
    const v0 = qa * u0 * u0 + qb * u0 + coef[2];
    apex = [mx + u0 * eu[0] + v0 * ev[0], my + u0 * eu[1] + v0 * ev[1]];
  }
  return { tangent, inside, apex };
}

/** Least-squares v = a u² + b u + c; returns [a, b, c]. */
function fitQuadratic(uv: number[][]): [number, number, number] {
  const m = new Float64Array(9),
    r = new Float64Array(3);
  for (const [u, v] of uv) {
    const row = [u * u, u, 1];
    for (let i = 0; i < 3; i++) {
      r[i] += row[i] * v;
      for (let j = 0; j < 3; j++) m[i * 3 + j] += row[i] * row[j];
    }
  }
  // Tiny ridge so 3 collinear or coincident centres stay solvable.
  for (let i = 0; i < 3; i++) m[i * 3 + i] += 1e-9;
  const det = det3(m);
  if (Math.abs(det) < 1e-12) return [0, 0, uv[0]?.[1] ?? 0];
  const solve = (k: number) => {
    const c = Float64Array.from(m);
    for (let i = 0; i < 3; i++) c[i * 3 + k] = r[i];
    return det3(c) / det;
  };
  return [solve(0), solve(1), solve(2)];
}

/** Centre of the mesial neighbour (or the first tooth across the midline). */
function mesialReference(
  tooth: ToothCloud,
  group: ToothCloud[],
  centres: Map<ToothCloud, Vec3>,
): [number, number] | null {
  const q = Math.floor(tooth.fdi! / 10),
    n = tooth.fdi! % 10;
  const same = group.filter(
    (t) => Math.floor(t.fdi! / 10) === q && t.fdi! % 10 < n,
  );
  if (same.length) {
    const t = same.reduce((x, y) => (y.fdi! > x.fdi! ? y : x));
    const c = centres.get(t)!;
    return [c[0], c[1]];
  }
  const partner = mirrorFdi(tooth.fdi)!;
  const other = group.filter(
    (t) => Math.floor(t.fdi! / 10) === Math.floor(partner / 10),
  );
  if (other.length) {
    const t = other.reduce((x, y) => (y.fdi! < x.fdi! ? y : x));
    const c = centres.get(t)!;
    return [c[0], c[1]];
  }
  // Mesial-most tooth of a lone quadrant: point away from its distal neighbour.
  const distal = group.filter(
    (t) => Math.floor(t.fdi! / 10) === q && t.fdi! % 10 > n,
  );
  if (distal.length) {
    const t = distal.reduce((x, y) => (y.fdi! < x.fdi! ? y : x));
    const c = centres.get(t)!,
      me = centres.get(tooth)!;
    return [2 * me[0] - c[0], 2 * me[1] - c[1]];
  }
  return null;
}

// --- wording ----------------------------------------------------------------

function directionWords(
  fdi: number,
  arch: 'upper' | 'lower' | null,
  c: { mesialMm: number; buccalMm: number; verticalMm: number },
  crownSign: number,
  superiorSign: number,
  floor: number,
): string {
  const anterior = fdi % 10 >= 1 && fdi % 10 <= 3;
  const parts: Array<{ size: number; words: string }> = [
    {
      size: Math.abs(c.buccalMm),
      words:
        c.buccalMm >= 0
          ? anterior
            ? 'toward the lips'
            : 'toward the cheek'
          : arch === 'upper'
            ? 'toward the palate'
            : 'toward the tongue',
    },
    {
      size: Math.abs(c.mesialMm),
      words:
        c.mesialMm >= 0
          ? anterior
            ? 'toward the midline'
            : 'forward'
          : anterior
            ? 'away from the midline'
            : 'backward',
    },
    {
      size: Math.abs(c.verticalMm),
      words: arch
        ? c.verticalMm * crownSign >= 0
          ? 'toward the bite'
          : 'into the gum'
        : c.verticalMm * superiorSign >= 0
          ? 'up'
          : 'down',
    },
  ].sort((x, y) => y.size - x.size);
  if (parts[0].size <= floor) return 'no measurable shift';
  const second = parts[1];
  if (second.size > floor && second.size > 0.5 * parts[0].size)
    return `${parts[0].words} and ${second.words}`;
  return `mostly ${parts[0].words}`;
}

const mm = (v: number) => `${v.toFixed(1)} mm`;
const deg = (v: number) => `${Math.round(v)}°`;

function listFdi(values: number[]): string {
  return values.length <= 1
    ? values.join('')
    : `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

function summarize(c: ScanComparison, fixedList: boolean): string[] {
  const out: string[] = [];
  if (c.mirrored)
    out.push(
      'The tooth numbers in the later scan are swapped left to right; teeth were matched by position and are named as in the earlier scan.',
    );
  out.push(
    `The scans were lined up on ${c.referenceFdi.length === 1 ? 'tooth' : 'teeth'} ${listFdi(c.referenceFdi)}${fixedList ? ' (as chosen)' : ''}.`,
  );
  for (const t of c.teeth) {
    if (!t.measurable) continue;
    const turned = t.rotationDeg > c.angleFloorDeg;
    const rotation = turned
      ? t.rotationKind === 'turned'
        ? `turned ${deg(t.rotationDeg)} around its long axis`
        : `tipped ${deg(t.rotationDeg)}`
      : '';
    let sentence: string;
    if (t.translationMm > c.noiseFloorMm)
      sentence = `Tooth ${t.fdi} moved ${mm(t.translationMm)} (${t.direction})${rotation ? ` and ${rotation}` : ''}`;
    else if (rotation) sentence = `Tooth ${t.fdi} ${rotation}`;
    else sentence = `Tooth ${t.fdi} shifted ${mm(t.movementMm)}`;
    if (t.tipMm !== null && t.tipMm > c.noiseFloorMm)
      sentence += `; its crown tip moved ${mm(t.tipMm)}`;
    out.push(`${sentence}.`);
  }
  const still = c.teeth
    .filter((t) => !t.measurable)
    .map((t) => t.fdi)
    .sort((x, y) => x - y);
  if (still.length)
    out.push(
      `${still.length === 1 ? 'Tooth' : 'Teeth'} ${listFdi(still)}: no measurable movement (under ${mm(c.noiseFloorMm)}).`,
    );
  for (const t of c.teeth)
    if (t.shapeChanged)
      out.push(
        `Tooth ${t.fdi} changed shape by up to ${mm(t.shapeChangeMm)} (wear, a chip, a filling or a crown can do this; so can a segmentation difference).`,
      );
  const named = (list: Array<{ fdi: number | null }>) =>
    list.filter((t) => t.fdi).map((t) => t.fdi as number);
  const onlyBefore = named(c.onlyBefore),
    onlyAfter = named(c.onlyAfter);
  if (onlyBefore.length)
    out.push(
      `Only in the earlier scan: ${onlyBefore.length === 1 ? 'tooth' : 'teeth'} ${listFdi(onlyBefore)}.`,
    );
  if (onlyAfter.length)
    out.push(
      `Only in the later scan: ${onlyAfter.length === 1 ? 'tooth' : 'teeth'} ${listFdi(onlyAfter)}.`,
    );
  return out;
}

// --- small math ---------------------------------------------------------------

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function centroid(p: Float32Array): Vec3 {
  const n = p.length / 3;
  const c: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) c[k] += p[i * 3 + k] / n;
  return c;
}

function normalize2(v: [number, number]): [number, number] {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

function det3(r: ArrayLike<number>): number {
  return (
    r[0] * (r[4] * r[8] - r[5] * r[7]) -
    r[1] * (r[3] * r[8] - r[5] * r[6]) +
    r[2] * (r[3] * r[7] - r[4] * r[6])
  );
}

function transform(m: ArrayLike<number>, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j];
      out[i * 4 + j] = s;
    }
  return out;
}

function invertRigid(m: ArrayLike<number>): Float64Array {
  const out = new Float64Array(16);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) out[i * 4 + j] = m[j * 4 + i];
  for (let i = 0; i < 3; i++)
    out[i * 4 + 3] = -(
      out[i * 4] * m[3] +
      out[i * 4 + 1] * m[7] +
      out[i * 4 + 2] * m[11]
    );
  out[15] = 1;
  return out;
}

/** Angle (radians) and unit axis of a matrix's rotation part. */
function rotationOf(m: ArrayLike<number>): {
  angle: number;
  axis: [number, number, number];
} {
  const cos = Math.max(-1, Math.min(1, (m[0] + m[5] + m[10] - 1) / 2));
  const angle = Math.acos(cos);
  const x = m[9] - m[6],
    y = m[2] - m[8],
    z = m[4] - m[1];
  const len = Math.hypot(x, y, z);
  if (len < 1e-12) return { angle, axis: [0, 0, 1] };
  return { angle, axis: [x / len, y / len, z / len] };
}
