import type { Vec3 } from '../../types';
import { fillHoles, morph } from './toothFocus';

export interface GrowToothInput {
  /** Display values (x-fastest) of a box around the click. */
  scan: ArrayLike<number>;
  /** Voxels already taken by other teeth (1 = taken), same box. */
  taken?: Uint8Array;
  shape: Vec3;
  spacing: Vec3;
  /** The click, in box voxel coordinates. */
  seed: Vec3;
  /**
   * Where the edge sits between the box's soft tissue (0) and the clicked
   * tooth (1). Lower takes more; higher stops sooner at bone.
   */
  level?: number;
  /** Bridges thinner than about twice this are cut (mm). */
  openMm?: number;
  /** How far (voxels) a slice's outline may reach past the previous one. */
  growPerSlice?: number;
  /** How much a slice's area may grow over the previous slice's. */
  areaGrowth?: number;
  /**
   * Which way the crown points along z, when known (from the tooth number).
   * Roots only narrow towards the apex, so rootward slices may not grow.
   */
  crownDirection?: 1 | -1;
}

export interface GrownTooth {
  /** 1 inside the tooth, box-sized. */
  mask: Uint8Array;
  voxels: number;
  volumeMm3: number;
  /** Box voxel bounds of the mask. */
  min: Vec3;
  max: Vec3;
  centroid: Vec3;
  threshold: number;
  /** The tooth reached the box sides: it probably ran into bone. */
  leaked: boolean;
}

function percentile(values: ArrayLike<number>, p: number, step = 7) {
  const sample: number[] = [];
  for (let i = 0; i < values.length; i += step) sample.push(values[i]);
  sample.sort((a, b) => a - b);
  return sample[Math.min(sample.length - 1, Math.floor(p * sample.length))];
}

/**
 * Outline one tooth from a click: threshold between soft tissue and the
 * clicked tooth's density, cut thin bridges to bone and neighbours with a
 * morphological opening, keep the piece under the click and fill the pulp.
 * An estimate for teeth the AI model missed; the result should be checked.
 */
export function growTooth(input: GrowToothInput): GrownTooth | null {
  const { scan, shape, spacing, seed } = input;
  const [w, h, d] = shape,
    plane = w * h,
    n = w * h * d;
  const at = (x: number, y: number, z: number) => z * plane + y * w + x;
  const inside = (x: number, y: number, z: number) =>
    x >= 0 && y >= 0 && z >= 0 && x < w && y < h && z < d;
  // Tooth density: the bright end of a ~2 mm ball around the click (the
  // click may land on the darker pulp, which the tooth surrounds).
  const near: number[] = [];
  const r = [0, 1, 2].map((k) => Math.max(2, Math.round(2 / spacing[k])));
  for (let dz = -r[2]; dz <= r[2]; dz++)
    for (let dy = -r[1]; dy <= r[1]; dy++)
      for (let dx = -r[0]; dx <= r[0]; dx++) {
        const x = seed[0] + dx,
          y = seed[1] + dy,
          z = seed[2] + dz;
        if (
          inside(x, y, z) &&
          (dx / r[0]) ** 2 + (dy / r[1]) ** 2 + (dz / r[2]) ** 2 <= 1
        )
          near.push(scan[at(x, y, z)]);
      }
  if (!near.length) return null;
  near.sort((a, b) => a - b);
  const toothLevel = near[Math.floor(near.length * 0.9)];
  const softLevel = percentile(scan, 0.2);
  if (!(toothLevel > softLevel)) return null;
  const threshold =
    softLevel + (input.level ?? 0.5) * (toothLevel - softLevel);

  let mask: Uint8Array = new Uint8Array(n);
  for (let i = 0; i < n; i++)
    mask[i] = scan[i] >= threshold && !input.taken?.[i] ? 1 : 0;
  // Opening: erode then dilate (within the threshold) by about openMm.
  const steps = Math.max(
    1,
    Math.round((input.openMm ?? 0.5) / Math.min(...spacing)),
  );
  const above = mask;
  let opened: Uint8Array = mask;
  for (let k = 0; k < steps; k++)
    opened = morph(opened, shape, false, k % 2 === 1);
  for (let k = 0; k < steps; k++) {
    opened = morph(opened, shape, true, k % 2 === 1);
    for (let i = 0; i < n; i++) opened[i] &= above[i];
  }
  mask = opened;

  // The piece under the click (or the nearest piece within ~1.5 mm).
  let start = -1;
  const reach = Math.ceil(1.5 / Math.min(...spacing));
  let best = Infinity;
  for (let dz = -reach; dz <= reach; dz++)
    for (let dy = -reach; dy <= reach; dy++)
      for (let dx = -reach; dx <= reach; dx++) {
        const x = seed[0] + dx,
          y = seed[1] + dy,
          z = seed[2] + dz;
        if (!inside(x, y, z) || !mask[at(x, y, z)]) continue;
        const dist =
          (dx * spacing[0]) ** 2 +
          (dy * spacing[1]) ** 2 +
          (dz * spacing[2]) ** 2;
        if (dist < best) {
          best = dist;
          start = at(x, y, z);
        }
      }
  if (start < 0) return null;
  const piece = new Uint8Array(n);
  const stack = [start];
  piece[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w,
      y = Math.floor(i / w) % h,
      z = Math.floor(i / plane);
    const visit = (j: number) => {
      if (mask[j] && !piece[j]) {
        piece[j] = 1;
        stack.push(j);
      }
    };
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (y > 0) visit(i - w);
    if (y < h - 1) visit(i + w);
    if (z > 0) visit(i - plane);
    if (z < d - 1) visit(i + plane);
  }
  const tracked = trackSlices(
    piece,
    shape,
    seed[2],
    input.growPerSlice ?? 1,
    input.areaGrowth ?? 1.08,
    input.crownDirection,
    Math.round(6 / spacing[2]),
  );
  // The pulp opens at the apex, so fill holes slice by slice as well.
  const filled = fillSliceHoles(fillHoles(tracked, shape), shape);
  if (input.taken)
    for (let i = 0; i < n; i++) if (input.taken[i]) filled[i] = 0;

  const min: Vec3 = [w, h, d],
    max: Vec3 = [-1, -1, -1];
  const sum = [0, 0, 0];
  let voxels = 0,
    sideVoxels = 0;
  for (let z = 0; z < d; z++)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!filled[at(x, y, z)]) continue;
        voxels++;
        sum[0] += x;
        sum[1] += y;
        sum[2] += z;
        if (x < min[0]) min[0] = x;
        if (y < min[1]) min[1] = y;
        if (z < min[2]) min[2] = z;
        if (x > max[0]) max[0] = x;
        if (y > max[1]) max[1] = y;
        if (z > max[2]) max[2] = z;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) sideVoxels++;
      }
  if (!voxels) return null;
  return {
    mask: filled,
    voxels,
    volumeMm3: voxels * spacing[0] * spacing[1] * spacing[2],
    min,
    max,
    centroid: [sum[0] / voxels, sum[1] / voxels, sum[2] / voxels],
    threshold,
    // A tooth fits in its box; touching the sides on more than a few
    // voxels means it ran on into bone or a neighbour.
    leaked: sideVoxels > 20,
  };
}

/** Fill holes in every axial slice (what the border can't reach in 2D). */
function fillSliceHoles(mask: Uint8Array, shape: Vec3): Uint8Array {
  const [w, h, d] = shape,
    plane = w * h;
  const out = mask.slice();
  const outside = new Uint8Array(plane);
  const stack: number[] = [];
  for (let z = 0; z < d; z++) {
    const base = z * plane;
    outside.fill(0);
    const push = (i: number) => {
      if (!mask[base + i] && !outside[i]) {
        outside[i] = 1;
        stack.push(i);
      }
    };
    for (let x = 0; x < w; x++) {
      push(x);
      push((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      push(y * w);
      push(y * w + w - 1);
    }
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w,
        y = Math.floor(i / w);
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (y > 0) push(i - w);
      if (y < h - 1) push(i + w);
    }
    for (let i = 0; i < plane; i++) if (!outside[i]) out[base + i] = 1;
  }
  return out;
}

/** In-plane dilation of one axial slice by `steps` voxels (4-neighbour). */
function dilate2d(slice: Uint8Array, w: number, h: number, steps: number) {
  let current = slice;
  for (let k = 0; k < steps; k++) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        next[i] =
          current[i] |
          (x > 0 ? current[i - 1] : 0) |
          (x < w - 1 ? current[i + 1] : 0) |
          (y > 0 ? current[i - w] : 0) |
          (y < h - 1 ? current[i + w] : 0);
      }
    current = next;
  }
  return current;
}

/**
 * Follow the tooth slice by slice from the clicked slice, up and down: each
 * slice keeps only what lies within `grow` voxels of the previous slice's
 * outline, and may not grow its area by more than `areaGrowth` at once. A
 * tooth's cross-section changes slowly; bone fused to it would spread out
 * sideways, so this stops leaks that a 3D threshold lets through.
 */
function trackSlices(
  piece: Uint8Array,
  shape: Vec3,
  seedZ: number,
  grow: number,
  areaGrowth: number,
  crownDirection?: 1 | -1,
  widenSlices = 0,
): Uint8Array {
  const [w, h, d] = shape,
    plane = w * h;
  const out = new Uint8Array(piece.length);
  const sliceOf = (z: number) => piece.subarray(z * plane, (z + 1) * plane);
  const area = (slice: Uint8Array) => {
    let n = 0;
    for (let i = 0; i < slice.length; i++) n += slice[i];
    return n;
  };
  const start = sliceOf(seedZ);
  out.set(start, seedZ * plane);
  for (const step of [1, -1]) {
    const towardRoot =
      crownDirection !== undefined && step === -crownDirection;
    let previous: Uint8Array = start;
    let previousArea = area(start);
    // A click near the biting edge sits above the crown's widest point:
    // rootward, the outline may still widen until it starts to narrow (or
    // for at most ~6 mm), and only then must it never grow again.
    let widest = previousArea,
      shrinking = false;
    for (let z = seedZ + step; z >= 0 && z < d; z += step) {
      const rootward =
        towardRoot && (shrinking || Math.abs(z - seedZ) > widenSlices);
      const growth = rootward ? 1 : areaGrowth;
      const allowed = dilate2d(previous, w, h, grow);
      const raw = sliceOf(z);
      let next = new Uint8Array(plane);
      for (let i = 0; i < plane; i++) next[i] = raw[i] & allowed[i];
      let nextArea = area(next);
      if (!nextArea) break;
      // Spreading too fast: keep only a one-voxel band past the last slice.
      if (nextArea > previousArea * growth + (rootward ? 0 : 4)) {
        const band = dilate2d(previous, w, h, 1);
        next = new Uint8Array(plane);
        for (let i = 0; i < plane; i++) next[i] = raw[i] & previous[i] & band[i];
        nextArea = area(next);
        if (!nextArea) break;
      }
      out.set(next, z * plane);
      previous = next;
      previousArea = nextArea;
      if (towardRoot && !shrinking) {
        if (nextArea > widest) widest = nextArea;
        else if (nextArea < widest * 0.9) shrinking = true;
      }
    }
  }
  return out;
}

/** Run-length encode a 0/1 mask (alternating runs, starting with zeros). */
export function encodeMask(mask: Uint8Array): number[] {
  const runs: number[] = [];
  let current = 0,
    length = 0;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 1 : 0;
    if (v === current) length++;
    else {
      runs.push(length);
      current = v;
      length = 1;
    }
  }
  runs.push(length);
  return runs;
}

export function decodeMask(runs: number[], length: number): Uint8Array {
  const mask = new Uint8Array(length);
  let i = 0,
    value = 0;
  for (const run of runs) {
    if (value) mask.fill(1, i, Math.min(length, i + run));
    i += run;
    value ^= 1;
  }
  return mask;
}

/**
 * `growTooth` from a click anywhere on the crown. Clicks near the biting edge
 * outline less of the tooth than clicks near its neck, so when the crown's
 * direction is known this also tries 4 mm rootward of the click and keeps
 * the fuller outline that didn't run into bone.
 */
export function growToothFromClick(input: GrowToothInput): GrownTooth | null {
  const first = growTooth(input);
  if (!input.crownDirection) return first;
  const shift = Math.round(4 / input.spacing[2]) * -input.crownDirection;
  const z = input.seed[2] + shift;
  if (z < 0 || z >= input.shape[2]) return first;
  const second = growTooth({ ...input, seed: [input.seed[0], input.seed[1], z] });
  const candidates = [first, second].filter(
    (result): result is GrownTooth => result !== null,
  );
  candidates.sort(
    (a, b) => Number(a.leaked) - Number(b.leaked) || b.voxels - a.voxels,
  );
  return candidates[0] ?? null;
}
