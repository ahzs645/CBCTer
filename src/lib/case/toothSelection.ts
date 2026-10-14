import type { PreparedVolumeFor3D, Vec3 } from '../../types';
import type { ToothInstance } from './types';

/** Named sets of teeth that reviewers and patients ask for most often. */
export const TOOTH_GROUPS = [
  { id: 'upper-anterior', label: 'Upper canine to canine (13–23)' },
  { id: 'lower-anterior', label: 'Lower canine to canine (33–43)' },
  { id: 'upper', label: 'Upper arch' },
  { id: 'lower', label: 'Lower arch' },
  { id: 'all', label: 'All teeth' },
] as const;
export type ToothGroupId = (typeof TOOTH_GROUPS)[number]['id'];

/** Every label value that belongs to a tooth (itself plus merged parts). */
export function toothValues(tooth: ToothInstance): number[] {
  return [tooth.value, ...(tooth.extraValues ?? [])];
}

/** Upper arch for permanent quadrants 1–2 and primary quadrants 5–6. */
export function fdiArch(fdi: number | null): 'upper' | 'lower' | null {
  if (!fdi) return null;
  const quadrant = Math.floor(fdi / 10);
  if ([1, 2, 5, 6].includes(quadrant)) return 'upper';
  if ([3, 4, 7, 8].includes(quadrant)) return 'lower';
  return null;
}

/** Swap patient left and right: 13 ↔ 23, 34 ↔ 44, 52 ↔ 62. */
export function mirrorFdi(fdi: number | null): number | null {
  if (!fdi) return fdi;
  const quadrant = Math.floor(fdi / 10),
    tooth = fdi % 10;
  const swapped = { 1: 2, 2: 1, 3: 4, 4: 3, 5: 6, 6: 5, 7: 8, 8: 7 }[quadrant];
  return swapped ? swapped * 10 + tooth : fdi;
}

export function teethInGroup(
  teeth: ToothInstance[],
  group: ToothGroupId,
): ToothInstance[] {
  return teeth.filter((t) => {
    if (t.review === 'rejected') return false;
    if (group === 'all') return true;
    const arch = fdiArch(t.fdi);
    if (group === 'upper' || group === 'lower') return arch === group;
    const position = (t.fdi ?? 0) % 10;
    return (
      arch === (group === 'upper-anterior' ? 'upper' : 'lower') &&
      position >= 1 &&
      position <= 3
    );
  });
}

export function toothLabel(t: ToothInstance, index?: number): string {
  return t.fdi
    ? `Tooth ${t.fdi}`
    : `Unnumbered ${index === undefined ? t.value : index + 1}`;
}

/** Bounding box of the teeth, padded and clamped to the scan grid. */
export function selectionBounds(
  teeth: ToothInstance[],
  dims: Vec3,
  pad = 4,
): { start: Vec3; shape: Vec3 } | null {
  if (!teeth.length) return null;
  const start = [0, 1, 2].map((a) =>
    Math.max(0, Math.min(...teeth.map((t) => t.bounds.min[a])) - pad),
  ) as Vec3;
  const end = [0, 1, 2].map((a) =>
    Math.min(dims[a] - 1, Math.max(...teeth.map((t) => t.bounds.max[a])) + pad),
  ) as Vec3;
  return {
    start,
    shape: [0, 1, 2].map((a) => Math.max(1, end[a] - start[a] + 1)) as Vec3,
  };
}

export interface CropLabels {
  groupId: string;
  words: Uint16Array;
}

function quantize(value: number, range: [number, number]): number {
  const span = Math.max(1, range[1] - range[0]);
  return Math.round(Math.max(0, Math.min(1, (value - range[0]) / span)) * 255);
}

/**
 * A full-resolution 3D texture of just the chosen teeth, cropped to their
 * bounding box so the 3D camera frames them. With `context`, the crop keeps
 * the surrounding bone and soft tissue instead of only tooth voxels.
 */
export function buildIsolatedVolume(options: {
  scan: ArrayLike<number>;
  labels: CropLabels[];
  start: Vec3;
  shape: Vec3;
  spacing: Vec3;
  teeth: ToothInstance[];
  scalarRange: [number, number];
  threshold: number;
  context?: boolean;
  maxEdge?: number;
}): PreparedVolumeFor3D {
  const { scan, labels, start, shape, spacing, teeth, scalarRange } = options;
  const wanted = new Map<string, Set<number>>();
  for (const t of teeth) {
    if (!wanted.has(t.groupId)) wanted.set(t.groupId, new Set());
    for (const value of toothValues(t)) wanted.get(t.groupId)!.add(value);
  }
  const layers = labels
    .filter((l) => wanted.has(l.groupId))
    .map((l) => ({ words: l.words, values: wanted.get(l.groupId)! }));
  const step = Math.max(
    1,
    Math.ceil(Math.max(...shape) / (options.maxEdge ?? 512)),
  );
  const out = shape.map((n) => Math.max(1, Math.floor(n / step))) as Vec3;
  const voxels = new Uint8Array(out[0] * out[1] * out[2]);
  const [sx, sy] = shape;
  for (let z = 0; z < out[2]; z++)
    for (let y = 0; y < out[1]; y++) {
      const row = (z * step * sy + y * step) * sx;
      const outRow = (z * out[1] + y) * out[0];
      for (let x = 0; x < out[0]; x++) {
        const source = row + x * step;
        let keep = options.context === true;
        for (let l = 0; !keep && l < layers.length; l++)
          keep = layers[l].values.has(layers[l].words[source]);
        if (keep) voxels[outRow + x] = quantize(scan[source], scalarRange);
      }
    }
  return {
    dimensions: out,
    sourceDimensions: [...shape] as Vec3,
    origin: [...start] as Vec3,
    spacing: spacing.map((s) => s * step) as Vec3,
    voxels,
    scalarRange,
    threshold: options.threshold,
    downsampled: step > 1,
    cropped: true,
  };
}

/** Clear tooth voxels from a quantized 3D texture (the "hide teeth" view). */
export function hideTeethInPreview(
  preview: PreparedVolumeFor3D,
  toothLayers: Uint16Array[],
  dims: Vec3,
): PreparedVolumeFor3D {
  const out = preview.dimensions;
  const voxels = new Uint8Array(preview.voxels);
  const map = (a: number) => {
    const m = new Int32Array(out[a]);
    for (let i = 0; i < out[a]; i++)
      m[i] = out[a] <= 1 ? 0 : Math.round((i / (out[a] - 1)) * (dims[a] - 1));
    return m;
  };
  const mx = map(0),
    my = map(1),
    mz = map(2);
  for (let z = 0; z < out[2]; z++)
    for (let y = 0; y < out[1]; y++) {
      const row = (mz[z] * dims[1] + my[y]) * dims[0],
        outRow = (z * out[1] + y) * out[0];
      for (let x = 0; x < out[0]; x++) {
        const source = row + mx[x];
        for (let l = 0; l < toothLayers.length; l++)
          if (toothLayers[l][source]) {
            voxels[outRow + x] = 0;
            break;
          }
      }
    }
  return { ...preview, voxels };
}

function otsu(values: number[]): number {
  if (!values.length) return 0;
  let min = Infinity,
    max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max <= min) return min;
  const bins = 256,
    hist = new Float64Array(bins),
    scale = (bins - 1) / (max - min);
  for (const v of values) hist[Math.round((v - min) * scale)]++;
  let total = 0,
    sum = 0;
  for (let i = 0; i < bins; i++) {
    total += hist[i];
    sum += i * hist[i];
  }
  let background = 0,
    backgroundSum = 0,
    best = 0,
    threshold = 0;
  for (let i = 0; i < bins; i++) {
    background += hist[i];
    if (!background || background === total) continue;
    backgroundSum += i * hist[i];
    const mb = backgroundSum / background,
      mf = (sum - backgroundSum) / (total - background);
    const between = background * (total - background) * (mb - mf) ** 2;
    if (between > best) {
      best = between;
      threshold = i;
    }
  }
  return min + (threshold + 0.5) / scale;
}

/** Square 2D dilation of a slice mask by `radius` pixels. */
function dilate2d(mask: Uint8Array, w: number, h: number, radius: number) {
  const tmp = new Uint8Array(mask.length),
    out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let d = -radius; d <= radius && !on; d++) {
        const xx = x + d;
        if (xx >= 0 && xx < w) on = mask[y * w + xx];
      }
      tmp[y * w + x] = on;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let d = -radius; d <= radius && !on; d++) {
        const yy = y + d;
        if (yy >= 0 && yy < h) on = tmp[yy * w + x];
      }
      out[y * w + x] = on;
    }
  return out;
}

export interface GumlineEstimate {
  /** Crop-local axial index of the estimated alveolar bone crest. */
  crest: number;
  /** Crop-local axial index of the estimated gingival margin. */
  gumline: number;
  /** +1 when the crown points toward higher axial indices. */
  crownDirection: 1 | -1;
  /** False when no bone contact was found and a proportional guess was used. */
  measured: boolean;
}

/**
 * CBCT barely shows gingiva, so the gumline is estimated from bone: walking
 * from the crown tip toward the root, the alveolar crest is the first level
 * where most of the thin ring around the tooth is bone-dense for at least
 * 2 mm. The gingival margin usually sits a few millimetres crownward of it.
 */
export function estimateGumline(options: {
  scan: ArrayLike<number>;
  labels: Uint16Array;
  shape: Vec3;
  spacing: Vec3;
  /** The tooth's label value, or all values of a merged tooth. */
  value: number | number[];
  crownDirection: 1 | -1;
  gumOffsetMm?: number;
}): GumlineEstimate | null {
  const { scan, labels, shape, spacing, crownDirection } = options;
  const wanted = new Set(
    Array.isArray(options.value) ? options.value : [options.value],
  );
  const [w, h, d] = shape,
    plane = w * h;
  const rings: Array<{ z: number; values: number[] } | null> = [];
  const toothValues: number[] = [];
  let first = -1,
    last = -1;
  for (let z = 0; z < d; z++) {
    const me = new Uint8Array(plane);
    let count = 0;
    for (let i = 0; i < plane; i++)
      if (wanted.has(labels[z * plane + i])) {
        me[i] = 1;
        count++;
        if (i % 7 === 0) toothValues.push(scan[z * plane + i]);
      }
    if (count < 5) {
      rings.push(null);
      continue;
    }
    if (first < 0) first = z;
    last = z;
    const inner = dilate2d(me, w, h, 1),
      outer = dilate2d(me, w, h, 3);
    const values: number[] = [];
    for (let i = 0; i < plane; i++) {
      const label = labels[z * plane + i];
      if (outer[i] && !inner[i] && (label === 0 || wanted.has(label)))
        values.push(scan[z * plane + i]);
    }
    rings.push({ z, values });
  }
  if (first < 0) return null;
  toothValues.sort((a, b) => a - b);
  const toothMedian = toothValues[toothValues.length >> 1] ?? 0;
  const all = rings.flatMap((r) =>
    r ? r.values.map((v) => Math.min(v, toothMedian)) : [],
  );
  const threshold = otsu(all);
  const raw = rings.map((r) =>
    r && r.values.length
      ? r.values.filter((v) => v > threshold).length / r.values.length
      : NaN,
  );
  const half = Math.max(1, Math.round(0.5 / spacing[2]));
  const fraction = raw.map((_, z) => {
    let s = 0,
      n = 0;
    for (let k = z - half; k <= z + half; k++)
      if (k >= 0 && k < raw.length && !Number.isNaN(raw[k])) {
        s += raw[k];
        n++;
      }
    return n ? s / n : NaN;
  });
  const tip = crownDirection === 1 ? last : first,
    apex = crownDirection === 1 ? first : last,
    toward = -crownDirection,
    need = Math.max(1, Math.round(2 / spacing[2]));
  let crest = -1;
  for (let z = tip; z !== apex + toward && crest < 0; z += toward) {
    if (!(fraction[z] >= 0.5)) continue;
    let held = true;
    for (let k = 1; k < need && held; k++) {
      const zz = z + toward * k;
      if (zz < first || zz > last) break;
      held = !(fraction[zz] < 0.5);
    }
    if (held) crest = z;
  }
  const measured = crest >= 0;
  if (!measured) crest = Math.round(tip + toward * 0.4 * (last - first));
  const offset = Math.round((options.gumOffsetMm ?? 2) / spacing[2]);
  const gumline = Math.max(
    first,
    Math.min(last, crest + crownDirection * offset),
  );
  return { crest, gumline, crownDirection, measured };
}

/** +1 when the crown of this tooth points toward higher axial indices. */
export function crownDirectionFor(
  tooth: ToothInstance,
  teeth: ToothInstance[],
  superiorSign: 1 | -1 = 1,
): 1 | -1 {
  let arch = fdiArch(tooth.fdi);
  if (!arch) {
    const zs = teeth.map((t) => t.centroid[2]).sort((a, b) => a - b);
    const median = zs[zs.length >> 1] ?? tooth.centroid[2];
    arch = (tooth.centroid[2] - median) * superiorSign >= 0 ? 'upper' : 'lower';
  }
  // Upper crowns point inferiorly, lower crowns superiorly.
  return (arch === 'upper' ? -superiorSign : superiorSign) as 1 | -1;
}

/** Binary mask of one tooth (or only its crown above the gumline) in a crop. */
export function toothMask(
  labels: Uint16Array,
  shape: Vec3,
  value: number | number[],
  crown?: Pick<GumlineEstimate, 'gumline' | 'crownDirection'>,
): { mask: Uint8Array; voxels: number } {
  const plane = shape[0] * shape[1];
  const values = new Set(Array.isArray(value) ? value : [value]);
  const mask = new Uint8Array(labels.length);
  let voxels = 0;
  for (let i = 0; i < labels.length; i++) {
    if (!values.has(labels[i])) continue;
    if (crown) {
      const z = Math.floor(i / plane);
      if ((z - crown.gumline) * crown.crownDirection < 0) continue;
    }
    mask[i] = 1;
    voxels++;
  }
  return { mask, voxels };
}

/** Concatenate binary STL files into one (one closed shell per tooth). */
export function concatBinaryStl(parts: Uint8Array[]): Uint8Array {
  const count = parts.reduce(
    (n, p) =>
      n +
      (p.byteLength >= 84
        ? new DataView(p.buffer, p.byteOffset, p.byteLength).getUint32(80, true)
        : 0),
    0,
  );
  const out = new Uint8Array(84 + count * 50);
  const header = new TextEncoder().encode('CBCTer tooth model (mm)');
  out.set(header.subarray(0, 80));
  new DataView(out.buffer).setUint32(80, count, true);
  let offset = 84;
  for (const p of parts) {
    if (p.byteLength <= 84) continue;
    out.set(p.subarray(84), offset);
    offset += p.byteLength - 84;
  }
  return out;
}

/**
 * True when most numbered teeth sit on the opposite side of the midline from
 * their quadrant, e.g. "33" (lower LEFT canine) on the patient's right.
 * `leftSign` is +1 when increasing X runs toward the patient's left.
 */
export function numberingLooksMirrored(
  teeth: ToothInstance[],
  leftSign: 1 | -1 = 1,
): boolean {
  const sided = teeth.filter((t) => t.fdi && t.review !== 'rejected');
  if (sided.length < 4) return false;
  const xs = sided.map((t) => t.centroid[0]).sort((a, b) => a - b);
  const midline = (xs[0] + xs[xs.length - 1]) / 2;
  let checked = 0,
    opposite = 0;
  for (const t of sided) {
    const offset = (t.centroid[0] - midline) * leftSign;
    if (Math.abs(offset) < 3) continue;
    const quadrant = Math.floor(t.fdi! / 10);
    const patientLeft = [2, 3, 6, 7].includes(quadrant);
    checked++;
    if (patientLeft !== offset > 0) opposite++;
  }
  return checked >= 4 && opposite / checked > 0.7;
}

/** Next/previous tooth in chart order (patient right to left, upper then lower). */
export function archOrder(teeth: ToothInstance[]): ToothInstance[] {
  const rank = (fdi: number | null) => {
    if (!fdi) return 1000;
    const q = Math.floor(fdi / 10),
      n = fdi % 10;
    const upper = [1, 2, 5, 6].includes(q);
    const right = [1, 4, 5, 8].includes(q);
    return (upper ? 0 : 100) + (right ? 10 - n : 10 + n);
  };
  return [...teeth].sort(
    (a, b) => rank(a.fdi) - rank(b.fdi) || a.value - b.value,
  );
}

/**
 * Pairs of outlines whose boxes mostly overlap: usually one tooth the model
 * split in two (fix with Merge), occasionally a tooth labelled twice.
 */
export function overlappingTeeth(
  teeth: ToothInstance[],
  threshold = 0.6,
  /** Neighbouring tilted teeth share box volume; split halves share a centre. */
  maxCentreVoxels = 20,
): Array<[ToothInstance, ToothInstance]> {
  const live = teeth.filter((t) => t.review !== 'rejected');
  const volume = (t: ToothInstance) =>
    [0, 1, 2].reduce((v, a) => v * (t.bounds.max[a] - t.bounds.min[a] + 1), 1);
  const pairs: Array<[ToothInstance, ToothInstance]> = [];
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i],
        b = live[j];
      const shared = [0, 1, 2].reduce(
        (v, k) =>
          v *
          Math.max(
            0,
            Math.min(a.bounds.max[k], b.bounds.max[k]) -
              Math.max(a.bounds.min[k], b.bounds.min[k]) +
              1,
          ),
        1,
      );
      const centres = Math.hypot(
        ...[0, 1, 2].map((k) => a.centroid[k] - b.centroid[k]),
      );
      if (
        shared / Math.min(volume(a), volume(b)) > threshold &&
        centres <= maxCentreVoxels
      )
        pairs.push([a, b]);
    }
  return pairs;
}

/** Copy a box out of an x-fastest volume. */
export function cropVolume<T extends Int16Array | Uint16Array>(
  source: T,
  dims: Vec3,
  start: Vec3,
  shape: Vec3,
): T {
  const out = new (source.constructor as { new (n: number): T })(
    shape[0] * shape[1] * shape[2],
  );
  for (let z = 0; z < shape[2]; z++)
    for (let y = 0; y < shape[1]; y++) {
      const from =
        ((start[2] + z) * dims[1] + start[1] + y) * dims[0] + start[0];
      out.set(
        source.subarray(from, from + shape[0]),
        (z * shape[1] + y) * shape[0],
      );
    }
  return out;
}

/** The teeth an "only selected" view shows: the multi-selection, else the focus. */
export function selectionIds(state: {
  toothSelection?: string[];
  selectedInstanceId?: string;
}): string[] {
  return state.toothSelection?.length
    ? state.toothSelection
    : state.selectedInstanceId
      ? [state.selectedInstanceId]
      : [];
}

/** Area (mm²) of the faces shared by voxels of labels `a` and `b` in a crop. */
export function sharedSurfaceMm2(
  labels: Uint16Array,
  shape: Vec3,
  spacing: Vec3,
  a: number,
  b: number,
): number {
  const [w, h, d] = shape,
    plane = w * h;
  const faces: Vec3 = [0, 0, 0];
  for (let z = 0; z < d; z++)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = z * plane + y * w + x,
          v = labels[i];
        if (v !== a && v !== b) continue;
        const other = v === a ? b : a;
        if (x < w - 1 && labels[i + 1] === other) faces[0]++;
        if (y < h - 1 && labels[i + w] === other) faces[1]++;
        if (z < d - 1 && labels[i + plane] === other) faces[2]++;
      }
  return (
    faces[0] * spacing[1] * spacing[2] +
    faces[1] * spacing[0] * spacing[2] +
    faces[2] * spacing[0] * spacing[1]
  );
}

/**
 * Outlines that share a large surface are one tooth the model cut in two
 * (a crown and its root, or two halves of an incisor). Neighbouring teeth
 * only touch at small contact points: on a 0.16 mm Sirona case real contacts
 * were ≤ 4 mm² and the three split teeth shared 52–73 mm².
 */
export async function findSplitTeeth(
  teeth: ToothInstance[],
  dims: Vec3,
  spacing: Vec3,
  read: (groupId: string, start: Vec3, shape: Vec3) => Promise<Uint16Array>,
  minSharedMm2 = 15,
  measure: (input: {
    labels: Uint16Array;
    shape: Vec3;
    spacing: Vec3;
    a: number;
    b: number;
  }) => number | Promise<number> = (input) =>
    sharedSurfaceMm2(input.labels, input.shape, input.spacing, input.a, input.b),
): Promise<Array<{ a: ToothInstance; b: ToothInstance; sharedMm2: number }>> {
  const live = teeth.filter((t) => t.review !== 'rejected');
  const found: Array<{
    a: ToothInstance;
    b: ToothInstance;
    sharedMm2: number;
  }> = [];
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i],
        b = live[j];
      if (a.groupId !== b.groupId) continue;
      const touching = [0, 1, 2].every(
        (k) =>
          a.bounds.min[k] <= b.bounds.max[k] + 1 &&
          b.bounds.min[k] <= a.bounds.max[k] + 1,
      );
      if (!touching) continue;
      // Only the overlap of the two boxes (plus a voxel) can hold shared faces.
      const start = [0, 1, 2].map((k) =>
        Math.max(0, Math.max(a.bounds.min[k], b.bounds.min[k]) - 1),
      ) as Vec3;
      const end = [0, 1, 2].map((k) =>
        Math.min(dims[k] - 1, Math.min(a.bounds.max[k], b.bounds.max[k]) + 1),
      );
      const shape = [0, 1, 2].map((k) =>
        Math.max(1, end[k] - start[k] + 1),
      ) as Vec3;
      const labels = await read(a.groupId, start, shape);
      const sharedMm2 = await measure({
        labels,
        shape,
        spacing,
        a: a.value,
        b: b.value,
      });
      if (sharedMm2 >= minSharedMm2) found.push({ a, b, sharedMm2 });
    }
  return found;
}

/**
 * Show split pairs as single teeth: the part with the lower FDI number keeps
 * its identity and absorbs the other part's label value and bounds.
 */
export function mergeTeethView(
  teeth: ToothInstance[],
  pairs: Array<[string, string]>,
): ToothInstance[] {
  const byId = new Map(teeth.map((t) => [t.id, { ...t }]));
  const absorbedInto = new Map<string, string>();
  const root = (id: string): string => {
    let current = id;
    while (absorbedInto.has(current)) current = absorbedInto.get(current)!;
    return current;
  };
  for (const [x, y] of pairs) {
    const a = byId.get(root(x)),
      b = byId.get(root(y));
    if (!a || !b || a.id === b.id || a.groupId !== b.groupId) continue;
    const [keep, drop] = (a.fdi ?? 99) <= (b.fdi ?? 99) ? [a, b] : [b, a];
    const total = keep.voxelCount + drop.voxelCount || 1;
    keep.extraValues = [...toothValues(keep).slice(1), ...toothValues(drop)];
    keep.centroid = keep.centroid.map(
      (c, k) =>
        (c * keep.voxelCount + drop.centroid[k] * drop.voxelCount) / total,
    ) as Vec3;
    keep.voxelCount += drop.voxelCount;
    keep.bounds = {
      min: keep.bounds.min.map((v, k) =>
        Math.min(v, drop.bounds.min[k]),
      ) as Vec3,
      max: keep.bounds.max.map((v, k) =>
        Math.max(v, drop.bounds.max[k]),
      ) as Vec3,
    };
    absorbedInto.set(drop.id, keep.id);
    byId.delete(drop.id);
  }
  return teeth.filter((t) => byId.has(t.id)).map((t) => byId.get(t.id)!);
}
