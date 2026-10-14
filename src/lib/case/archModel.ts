import type { Vec3 } from '../../types';
import { maskToSurface, orientMesh } from '../surface/maskSurface';
import { indexedToStl, type IndexedMesh } from '../surface/simplifyClosed';
import { fdiArch, type CropLabels, toothValues } from './toothSelection';
import type { ToothInstance } from './types';

/** Where one tooth's crown starts, in the crop's axial index. */
export interface CrownCut {
  /** Crop-local axial index of the gingival margin. */
  gumline: number;
  /** +1 when the crown points toward higher axial indices. */
  crownDirection: 1 | -1;
}

export interface ArchModelOptions {
  /** Label crops (x-fastest) covering `shape`, one per tooth group. */
  labels: CropLabels[];
  shape: Vec3;
  /** Scan voxel index of the crop's first voxel. */
  start: Vec3;
  /** Voxel size in mm (x, y, z). */
  spacing: Vec3;
  /** Teeth of ONE arch to put on the model. */
  teeth: ToothInstance[];
  /** Gumline per tooth id. */
  crowns: Map<string, CrownCut>;
  /** Base height from the most rootward gumline to the flat bottom. */
  baseHeightMm?: number;
  /** How far the base reaches around the crowns. */
  rimMm?: number;
  /** The base top sits this far crownward of each tooth's gumline. */
  gumCollarMm?: number;
  /** Radius of the 2D closing that fills gaps between neighbouring teeth. */
  closeMm?: number;
}

export interface ArchModelMask {
  /** Binary mask, x-fastest, in the (possibly enlarged) crop below. */
  mask: Uint8Array;
  shape: Vec3;
  /** Scan voxel index of the mask's first voxel; may be negative. */
  start: Vec3;
  crownDirection: 1 | -1;
  /** Mask-local axial index of the flat bottom of the base. */
  bottom: number;
  /** Strips added to join parts of the footprint split by a wide gap. */
  bridges: number;
  /** Voxels of tiny loose fragments (< 0.5 mm³) left off the model. */
  droppedVoxels: number;
}

type Layer = { words: Uint16Array; lut: Int16Array };

/** Per label layer, a value → (tooth index + 1) table. */
function toothLayers(
  labels: CropLabels[],
  teeth: ToothInstance[],
  strict: boolean,
): Layer[] {
  const layers: Layer[] = [];
  teeth.forEach((t, i) => {
    const source = labels.find((l) => l.groupId === t.groupId);
    if (!source) {
      if (strict) throw new Error(`No labels loaded for tooth ${t.id}.`);
      return;
    }
    let layer = layers.find((l) => l.words === source.words);
    if (!layer) {
      layer = { words: source.words, lut: new Int16Array(65536) };
      layers.push(layer);
    }
    for (const value of toothValues(t)) if (value > 0) layer.lut[value] = i + 1;
  });
  return layers;
}

function toothAt(layers: Layer[], i: number): number {
  for (let l = 0; l < layers.length; l++) {
    const t = layers[l].lut[layers[l].words[i]];
    if (t) return t;
  }
  return 0;
}

const FAR = 1e20;

/**
 * Exact 2D Euclidean distance transform with physical pixel size: squared
 * distance (mm²) to the nearest seed and that seed's index.
 */
function distance2d(
  seeds: Uint8Array,
  w: number,
  h: number,
  sx: number,
  sy: number,
): { d2: Float64Array; near: Int32Array } {
  const g = new Float64Array(w * h),
    fx = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let last = -1;
    for (let x = 0; x < w; x++) {
      if (seeds[row + x]) last = x;
      fx[row + x] = last;
    }
    let next = -1;
    for (let x = w - 1; x >= 0; x--) {
      if (seeds[row + x]) next = x;
      const left = fx[row + x];
      if (next >= 0 && (left < 0 || next - x < x - left)) fx[row + x] = next;
      g[row + x] = fx[row + x] >= 0 ? (sx * (x - fx[row + x])) ** 2 : FAR;
    }
  }
  const d2 = new Float64Array(w * h),
    near = new Int32Array(w * h).fill(-1);
  const v = new Int32Array(h),
    z = new Float64Array(h + 1);
  const sy2 = sy * sy;
  for (let x = 0; x < w; x++) {
    let k = -1;
    for (let q = 0; q < h; q++) {
      const fq = g[q * w + x];
      if (fq >= FAR) continue;
      if (k < 0) {
        k = 0;
        v[0] = q;
        z[0] = -Infinity;
        z[1] = Infinity;
        continue;
      }
      let s: number;
      for (;;) {
        const r = v[k];
        s =
          (fq + sy2 * q * q - (g[r * w + x] + sy2 * r * r)) /
          (2 * sy2 * (q - r));
        if (s <= z[k]) k--;
        else break;
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    if (k < 0) {
      for (let p = 0; p < h; p++) d2[p * w + x] = FAR;
      continue;
    }
    let j = 0;
    for (let p = 0; p < h; p++) {
      while (z[j + 1] < p) j++;
      const r = v[j];
      d2[p * w + x] = sy2 * (p - r) ** 2 + g[r * w + x];
      near[p * w + x] = r * w + fx[r * w + x];
    }
  }
  return { d2, near };
}

/** 4-connected components of a 2D mask; 0 is background. */
function components2d(mask: Uint8Array, w: number, h: number) {
  const id = new Int32Array(w * h),
    sizes = [0],
    stack = new Int32Array(w * h);
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || id[s]) continue;
    const label = sizes.length;
    let top = 0,
      size = 0;
    stack[top++] = s;
    id[s] = label;
    while (top) {
      const i = stack[--top],
        x = i % w;
      size++;
      const next = [
        x > 0 ? i - 1 : -1,
        x < w - 1 ? i + 1 : -1,
        i >= w ? i - w : -1,
        i < w * (h - 1) ? i + w : -1,
      ];
      for (const n of next)
        if (n >= 0 && mask[n] && !id[n]) {
          id[n] = label;
          stack[top++] = n;
        }
    }
    sizes.push(size);
  }
  return { id, sizes };
}

/** 6-connected components of a 3D mask; 0 is background. */
export function components3d(mask: Uint8Array, shape: Vec3) {
  const [w, h, d] = shape,
    plane = w * h;
  const id = new Int32Array(mask.length),
    sizes = [0],
    stack = new Int32Array(mask.length);
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || id[s]) continue;
    const label = sizes.length;
    let top = 0,
      size = 0;
    stack[top++] = s;
    id[s] = label;
    while (top) {
      const i = stack[--top];
      size++;
      const x = i % w,
        y = Math.floor(i / w) % h,
        z = Math.floor(i / plane);
      const visit = (n: number) => {
        if (mask[n] && !id[n]) {
          id[n] = label;
          stack[top++] = n;
        }
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y < h - 1) visit(i + w);
      if (z > 0) visit(i - plane);
      if (z < d - 1) visit(i + plane);
    }
    sizes.push(size);
  }
  return { id, sizes };
}

/** Paint a strip of physical radius `radius` from pixel a to pixel b. */
function paintStrip(
  mask: Uint8Array,
  w: number,
  h: number,
  a: number,
  b: number,
  radius: number,
  sx: number,
  sy: number,
) {
  const ax = (a % w) * sx,
    ay = Math.floor(a / w) * sy,
    bx = (b % w) * sx,
    by = Math.floor(b / w) * sy;
  const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - radius) / sx)),
    x1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + radius) / sx)),
    y0 = Math.max(0, Math.floor((Math.min(ay, by) - radius) / sy)),
    y1 = Math.min(h - 1, Math.ceil((Math.max(ay, by) + radius) / sy));
  const dx = bx - ax,
    dy = by - ay,
    length2 = dx * dx + dy * dy;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x * sx - ax,
        py = y * sy - ay;
      const t = length2
        ? Math.max(0, Math.min(1, (px * dx + py * dy) / length2))
        : 0;
      if ((px - t * dx) ** 2 + (py - t * dy) ** 2 <= radius * radius)
        mask[y * w + x] = 1;
    }
}

/**
 * A printable dental model of one arch: the crowns above their gumlines on a
 * horseshoe base that follows the arch, with a flat bottom. The base top sits
 * a collar above each gumline so the crowns are anchored, and the result is
 * one 6-connected solid (wide gaps are bridged, loose crumbs dropped).
 */
export function buildArchModelMask(options: ArchModelOptions): ArchModelMask {
  const { labels, shape, start, spacing, teeth } = options;
  if (!teeth.length)
    throw new Error('Choose at least one tooth for the model.');
  const cuts = teeth.map((t) => {
    const cut = options.crowns.get(t.id);
    if (!cut) throw new Error(`No gumline for tooth ${t.fdi ?? t.value}.`);
    return cut;
  });
  const dir = cuts[0].crownDirection;
  const arches = new Set(teeth.map((t) => fdiArch(t.fdi)).filter(Boolean));
  if (cuts.some((c) => c.crownDirection !== dir) || arches.size > 1)
    throw new Error(
      'An arch model takes teeth from one arch; upper and lower teeth were mixed.',
    );
  const [w, h, d] = shape,
    plane = w * h;
  const [sx, sy, sz] = spacing;
  const rim = Math.max(0, options.rimMm ?? 1.5),
    close = Math.max(0, options.closeMm ?? 2),
    baseVox = Math.max(1, Math.round((options.baseHeightMm ?? 8) / sz)),
    collarVox = Math.max(0, Math.round((options.gumCollarMm ?? 1) / sz));

  // Crown voxels of every chosen tooth.
  const layers = toothLayers(labels, teeth, true);
  const crownIndex: number[] = [],
    crownTooth: number[] = [];
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  const present = new Set<number>();
  for (let z = 0; z < d; z++)
    for (let i = 0; i < plane; i++) {
      const t = toothAt(layers, z * plane + i);
      if (!t || (z - cuts[t - 1].gumline) * dir < 0) continue;
      crownIndex.push(z * plane + i);
      crownTooth.push(t - 1);
      present.add(t - 1);
      const x = i % w,
        y = Math.floor(i / w);
      lo[0] = Math.min(lo[0], x);
      lo[1] = Math.min(lo[1], y);
      lo[2] = Math.min(lo[2], z);
      hi[0] = Math.max(hi[0], x);
      hi[1] = Math.max(hi[1], y);
      hi[2] = Math.max(hi[2], z);
    }
  if (!crownIndex.length)
    throw new Error(
      'The chosen teeth have no crown voxels above their gumlines.',
    );

  // Levels in "height" units (z × dir: larger is more crownward).
  const gums = [...present].map((t) => cuts[t].gumline * dir);
  const bottomH = Math.min(...gums) - baseVox;
  const topsZ = [...present].map((t) => cuts[t].gumline + dir * collarVox);
  const zLo = Math.min(lo[2], bottomH * dir, ...topsZ),
    zHi = Math.max(hi[2], bottomH * dir, ...topsZ);
  const mx = Math.ceil((rim + close) / sx) + 2,
    my = Math.ceil((rim + close) / sy) + 2;
  const offset: Vec3 = [lo[0] - mx, lo[1] - my, zLo];
  const W = hi[0] - lo[0] + 1 + 2 * mx,
    H = hi[1] - lo[1] + 1 + 2 * my,
    D = zHi - zLo + 1,
    P = W * H;
  const outShape: Vec3 = [W, H, D];
  const outStart = [0, 1, 2].map((a) => start[a] + offset[a]) as Vec3;
  const mask = new Uint8Array(P * D);
  const shiftH = offset[2] * dir; // out-local height = height - shiftH
  const bottom = (bottomH - shiftH) * dir;

  // Crowns, their 2D footprint, and per column the most rootward collar top.
  const seed = new Uint8Array(P),
    topH = new Int32Array(P).fill(2 ** 30);
  for (let k = 0; k < crownIndex.length; k++) {
    const i = crownIndex[k],
      x = (i % w) - offset[0],
      y = (Math.floor(i / w) % h) - offset[1],
      z = Math.floor(i / plane) - offset[2];
    const col = y * W + x;
    mask[z * P + col] = 1;
    seed[col] = 1;
    const top = cuts[crownTooth[k]].gumline * dir + collarVox - shiftH;
    if (top < topH[col]) topH[col] = top;
  }

  // Footprint: crowns dilated by rim + close, then eroded by close.
  const nearest = distance2d(seed, W, H, sx, sy);
  const grown = new Uint8Array(P);
  for (let c = 0; c < P; c++)
    grown[c] = nearest.d2[c] <= (rim + close) ** 2 + 1e-9 ? 1 : 0;
  const outside = new Uint8Array(P);
  for (let c = 0; c < P; c++) outside[c] = grown[c] ? 0 : 1;
  const edge = distance2d(outside, W, H, sx, sy);
  const footprint = new Uint8Array(P);
  for (let c = 0; c < P; c++)
    footprint[c] =
      seed[c] || (grown[c] && edge.d2[c] > close * close + 1e-9) ? 1 : 0;

  // Join footprint parts left apart by a wide gap (e.g. a missing tooth).
  let bridges = 0;
  for (;;) {
    const parts = components2d(footprint, W, H);
    if (parts.sizes.length <= 2) break;
    if (bridges > teeth.length + 4)
      throw new Error('Could not join the arch model into one piece.');
    let main = 1;
    for (let l = 2; l < parts.sizes.length; l++)
      if (parts.sizes[l] > parts.sizes[main]) main = l;
    const mainSeeds = new Uint8Array(P);
    for (let c = 0; c < P; c++) mainSeeds[c] = parts.id[c] === main ? 1 : 0;
    const toMain = distance2d(mainSeeds, W, H, sx, sy);
    let from = -1;
    for (let c = 0; c < P; c++)
      if (
        parts.id[c] &&
        parts.id[c] !== main &&
        (from < 0 || toMain.d2[c] < toMain.d2[from])
      )
        from = c;
    paintStrip(
      footprint,
      W,
      H,
      from,
      toMain.near[from],
      Math.max(rim, 1.5),
      sx,
      sy,
    );
    bridges++;
  }

  // Base: every footprint column from the flat bottom up to its collar top,
  // which off the crowns is the collar of the nearest crown column.
  const bottomOutH = bottomH - shiftH;
  for (let c = 0; c < P; c++) {
    if (!footprint[c]) continue;
    if (!seed[c]) topH[c] = topH[nearest.near[c]];
    for (let hh = bottomOutH; hh <= topH[c]; hh++) mask[hh * dir * P + c] = 1;
  }

  // One solid: drop crumbs, prop up anything else that floats.
  let droppedVoxels = 0;
  const voxelMm3 = sx * sy * sz;
  for (let pass = 0; ; pass++) {
    const parts = components3d(mask, outShape);
    if (parts.sizes.length <= 2) break;
    if (pass > 1)
      throw new Error('Could not join the arch model into one piece.');
    let main = 1;
    for (let l = 2; l < parts.sizes.length; l++)
      if (parts.sizes[l] > parts.sizes[main]) main = l;
    const lowest = new Map<number, number>();
    for (let i = 0; i < mask.length; i++) {
      const l = parts.id[i];
      if (!l || l === main) continue;
      if (parts.sizes[l] * voxelMm3 < 0.5) {
        mask[i] = 0;
        droppedVoxels++;
        continue;
      }
      const c = i % P,
        hh = Math.floor(i / P) * dir;
      lowest.set(c, Math.min(lowest.get(c) ?? Infinity, hh));
    }
    for (const [c, hh] of lowest) {
      if (!footprint[c]) continue;
      for (let k = topH[c] + 1; k < hh; k++) mask[k * dir * P + c] = 1;
    }
  }
  return {
    mask,
    shape: outShape,
    start: outStart,
    crownDirection: dir,
    bottom,
    bridges,
    droppedVoxels,
  };
}

/**
 * Rewind a closed binary STL so every triangle faces outward: neighbours
 * across each shared edge agree, and each shell encloses positive volume.
 * Normals are recomputed from the new winding.
 */
export function orientStl(stl: Uint8Array): Uint8Array {
  const out = stl.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const count = view.getUint32(80, true);
  const corner = (t: number, v: number) => 84 + t * 50 + 12 + v * 12;
  const ids = new Int32Array(count * 3);
  const weld = new Map<string, number>();
  for (let t = 0; t < count; t++)
    for (let v = 0; v < 3; v++) {
      const o = corner(t, v);
      const key = `${view.getFloat32(o, true)},${view.getFloat32(o + 4, true)},${view.getFloat32(o + 8, true)}`;
      let id = weld.get(key);
      if (id === undefined) weld.set(key, (id = weld.size));
      ids[t * 3 + v] = id;
    }
  const vertices = weld.size;
  weld.clear();
  const next = (e: number) => e - (e % 3) + (((e % 3) + 1) % 3);
  const twin = new Int32Array(count * 3).fill(-1);
  const open = new Map<number, number>();
  for (let e = 0; e < count * 3; e++) {
    const a = ids[e],
      b = ids[next(e)];
    const key = Math.min(a, b) * vertices + Math.max(a, b);
    const other = open.get(key);
    if (other === undefined) open.set(key, e);
    else {
      twin[e] = other;
      twin[other] = e;
      open.delete(key);
    }
  }
  const flip = new Uint8Array(count),
    seen = new Uint8Array(count),
    queue = new Int32Array(count);
  const p = (t: number, v: number, a: number) =>
    view.getFloat32(corner(t, v) + a * 4, true);
  let tail = 0;
  for (let s = 0; s < count; s++) {
    if (seen[s]) continue;
    const first = tail;
    queue[tail++] = s;
    seen[s] = 1;
    let volume = 0;
    for (let head = first; head < tail; head++) {
      const f = queue[head];
      const [a, b, c] = [0, 1, 2].map((v) => [0, 1, 2].map((k) => p(f, v, k)));
      const signed =
        a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0]);
      volume += flip[f] ? -signed : signed;
      for (let k = 0; k < 3; k++) {
        const e = f * 3 + k,
          o = twin[e];
        if (o < 0) continue;
        const g = Math.floor(o / 3);
        if (seen[g]) continue;
        // Agreeing neighbours run a shared edge in opposite directions.
        flip[g] = flip[f] ^ (ids[e] === ids[o] ? 1 : 0);
        seen[g] = 1;
        queue[tail++] = g;
      }
    }
    if (volume < 0)
      for (let head = first; head < tail; head++) flip[queue[head]] ^= 1;
  }
  for (let t = 0; t < count; t++) {
    const v1 = corner(t, 1),
      v2 = corner(t, 2);
    if (flip[t]) {
      const tmp = out.slice(v1, v1 + 12);
      out.copyWithin(v1, v2, v2 + 12);
      out.set(tmp, v2);
    }
    const [a, b, c] = [0, 1, 2].map((v) => [0, 1, 2].map((k) => p(t, v, k)));
    const u = [0, 1, 2].map((k) => b[k] - a[k]),
      w = [0, 1, 2].map((k) => c[k] - a[k]);
    const n = [
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0],
    ];
    const length = Math.hypot(n[0], n[1], n[2]) || 1;
    for (let k = 0; k < 3; k++)
      view.setFloat32(84 + t * 50 + k * 4, n[k] / length, true);
  }
  return out;
}

/**
 * Closed, outward-facing STL surface (mm, scan frame) of the arch model. Not
 * decimated: the mesher's decimation drops triangles, which would open holes.
 */
export async function archModelStl(
  options: ArchModelOptions & { smoothIterations?: number },
): Promise<Uint8Array> {
  return indexedToStl(archModelMesh(options));
}

/** The arch model as an oriented indexed mesh (see `archModelStl`). */
export function archModelMesh(
  options: ArchModelOptions & { smoothIterations?: number },
): IndexedMesh {
  const model = buildArchModelMask(options);
  // Typed-array mesher: a whole arch would need gigabytes with the old one.
  const mesh = maskToSurface(
    model.mask,
    model.shape,
    options.spacing,
    model.start,
    options.smoothIterations ?? 6,
  );
  orientMesh(mesh);
  return mesh;
}

export interface BiteContact {
  /** Tooth ids. */
  upper: string;
  lower: string;
  /** Area of voxel faces where the two teeth touch. */
  contactAreaMm2: number;
  /** Smallest gap between the two voxel surfaces (0 when touching). */
  minGapMm: number;
  /** Axial (biting-plane) area where the gap is at most `gapMm`. */
  closeAreaMm2: number;
}

/**
 * Upper/lower tooth pairs that touch or nearly touch: a sign the scan was
 * taken with teeth closed, so biting edges may be fused or clipped there.
 * Only pairs closer than `searchMm` are reported, largest contact first.
 */
export function biteContacts(options: {
  labels: CropLabels[];
  shape: Vec3;
  spacing: Vec3;
  teeth: ToothInstance[];
  /** Gap counted as "close" for `closeAreaMm2`. */
  gapMm?: number;
  /** Pairs farther apart than this are not reported. */
  searchMm?: number;
  /** +1 when superior is toward higher axial indices. */
  superiorSign?: 1 | -1;
}): BiteContact[] {
  const { labels, shape, spacing } = options;
  const teeth = options.teeth.filter((t) => t.review !== 'rejected');
  const gapMm = options.gapMm ?? 0.3,
    searchMm = options.searchMm ?? 1,
    superior = options.superiorSign ?? 1;
  const zs = teeth.map((t) => t.centroid[2]).sort((a, b) => a - b);
  const median = zs[zs.length >> 1] ?? 0;
  const upper = teeth.map(
    (t) =>
      (fdiArch(t.fdi) ??
        ((t.centroid[2] - median) * superior >= 0 ? 'upper' : 'lower')) ===
      'upper',
  );
  const layers = toothLayers(labels, teeth, false);
  const [w, h, d] = shape,
    plane = w * h,
    n = teeth.length;
  const [sx, sy, sz] = spacing;
  const faceArea = [sy * sz, sx * sz, sx * sy];
  const faces = new Float64Array(n * n);
  const lo = teeth.map(() => [Infinity, Infinity, Infinity]),
    hi = teeth.map(() => [-Infinity, -Infinity, -Infinity]);
  const surface: number[][] = teeth.map(() => []);
  const steps = [1, w, plane];
  for (let z = 0; z < d; z++)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = z * plane + y * w + x;
        const t = toothAt(layers, i) - 1;
        if (t < 0) continue;
        const p = [x, y, z];
        for (let a = 0; a < 3; a++) {
          lo[t][a] = Math.min(lo[t][a], p[a]);
          hi[t][a] = Math.max(hi[t][a], p[a]);
        }
        if (!upper[t]) continue;
        let onSurface = false;
        for (let a = 0; a < 3; a++)
          for (const s of [-1, 1]) {
            const q = p[a] + s;
            if (q < 0 || q >= shape[a]) {
              onSurface = true;
              continue;
            }
            const u = toothAt(layers, i + s * steps[a]) - 1;
            if (u !== t) onSurface = true;
            if (u >= 0 && !upper[u]) faces[t * n + u] += faceArea[a];
          }
        if (onSurface) surface[t].push(i);
      }

  // Neighbour offsets within the search radius, nearest first.
  const reach = spacing.map((s) => Math.ceil(searchMm / s) + 1);
  const offsets: Array<{ dx: number; dy: number; dz: number; gap: number }> =
    [];
  for (let dz = -reach[2]; dz <= reach[2]; dz++)
    for (let dy = -reach[1]; dy <= reach[1]; dy++)
      for (let dx = -reach[0]; dx <= reach[0]; dx++) {
        const gap = Math.hypot(
          Math.max(0, Math.abs(dx) - 1) * sx,
          Math.max(0, Math.abs(dy) - 1) * sy,
          Math.max(0, Math.abs(dz) - 1) * sz,
        );
        if (gap < searchMm) offsets.push({ dx, dy, dz, gap });
      }
  offsets.sort((a, b) => a.gap - b.gap);

  const out: BiteContact[] = [];
  for (let u = 0; u < n; u++) {
    if (!upper[u] || !surface[u].length) continue;
    for (let l = 0; l < n; l++) {
      if (upper[l] || lo[l][0] === Infinity) continue;
      if (
        [0, 1, 2].some(
          (a) =>
            lo[u][a] > hi[l][a] + reach[a] || hi[u][a] < lo[l][a] - reach[a],
        )
      )
        continue;
      let best = Infinity;
      const close = new Set<number>();
      for (const i of surface[u]) {
        const x = i % w,
          y = Math.floor(i / w) % h,
          z = Math.floor(i / plane);
        if (
          x < lo[l][0] - reach[0] ||
          x > hi[l][0] + reach[0] ||
          y < lo[l][1] - reach[1] ||
          y > hi[l][1] + reach[1] ||
          z < lo[l][2] - reach[2] ||
          z > hi[l][2] + reach[2]
        )
          continue;
        const limit = Math.max(Math.min(best, searchMm), gapMm + 1e-9);
        for (const o of offsets) {
          if (o.gap >= limit) break;
          const xx = x + o.dx,
            yy = y + o.dy,
            zz = z + o.dz;
          if (xx < 0 || yy < 0 || zz < 0 || xx >= w || yy >= h || zz >= d)
            continue;
          if (toothAt(layers, zz * plane + yy * w + xx) - 1 !== l) continue;
          best = Math.min(best, o.gap);
          if (o.gap <= gapMm + 1e-9) close.add(y * w + x);
          break;
        }
      }
      const contact = faces[u * n + l];
      if (!contact && !(best < searchMm)) continue;
      out.push({
        upper: teeth[u].id,
        lower: teeth[l].id,
        contactAreaMm2: contact,
        minGapMm: best,
        closeAreaMm2: close.size * sx * sy,
      });
    }
  }
  return out.sort(
    (a, b) => b.contactAreaMm2 - a.contactAreaMm2 || a.minGapMm - b.minGapMm,
  );
}
