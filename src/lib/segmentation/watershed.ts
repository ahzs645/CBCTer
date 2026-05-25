/**
 * Marker-controlled watershed on the Euclidean distance transform, used to
 * split touching teeth that plain connected-components merges into one blob.
 * This is the in-browser analogue of the Python `segment:watershed` step.
 *
 * Pipeline: exact squared EDT (Felzenszwalb–Huttenlocher, separable) → light
 * smoothing → distance local-maxima markers (every foreground component is
 * guaranteed at least one) → priority flood from markers in descending-distance
 * order. Returns the same `{ labels, components }` shape as connected-components
 * so `generateLibrary` can swap it in directly.
 */
import { labelComponents, type MaskComponent } from './connectedComponents';

const INF = 1e20;

/** Distance (voxels) a tooth core must reach to seed its own basin. */
const DEFAULT_CORE_THRESHOLD = 7;

export interface WatershedOptions {
  /** Granularity knob (voxels): the distance-transform depth a region must
   * reach to count as a separate tooth core. Lower merges touching teeth
   * (coarser), higher separates them (finer). */
  coreThreshold?: number;
}

/** 1D squared distance transform of a sampled function (Felzenszwalb). */
function edt1d(
  f: Float64Array,
  n: number,
  d: Float64Array,
  v: Int32Array,
  z: Float64Array,
): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q += 1) {
    let s =
      (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }
}

/** Exact Euclidean distance (in voxels) from each foreground voxel to the
 * nearest background voxel, in [D, H, W] order. */
function distanceTransform(
  mask: Uint8Array,
  dims: [number, number, number],
): Float32Array {
  const [depth, height, width] = dims;
  const out = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) out[i] = mask[i] ? INF : 0;

  const maxN = Math.max(depth, height, width);
  const f = new Float64Array(maxN);
  const d = new Float64Array(maxN);
  const v = new Int32Array(maxN);
  const z = new Float64Array(maxN + 1);

  // Along X (stride 1).
  for (let zc = 0; zc < depth; zc += 1) {
    for (let y = 0; y < height; y += 1) {
      const base = (zc * height + y) * width;
      for (let x = 0; x < width; x += 1) f[x] = out[base + x];
      edt1d(f, width, d, v, z);
      for (let x = 0; x < width; x += 1) out[base + x] = d[x];
    }
  }
  // Along Y (stride width).
  for (let zc = 0; zc < depth; zc += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = zc * height * width + x;
      for (let y = 0; y < height; y += 1) f[y] = out[base + y * width];
      edt1d(f, height, d, v, z);
      for (let y = 0; y < height; y += 1) out[base + y * width] = d[y];
    }
  }
  // Along Z (stride height*width).
  const slice = height * width;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = y * width + x;
      for (let zc = 0; zc < depth; zc += 1) f[zc] = out[base + zc * slice];
      edt1d(f, depth, d, v, z);
      for (let zc = 0; zc < depth; zc += 1) out[base + zc * slice] = d[zc];
    }
  }

  for (let i = 0; i < out.length; i += 1) out[i] = Math.sqrt(out[i]);
  return out;
}

/** 6-neighbor mean smoothing to suppress spurious distance maxima. */
function smooth(
  dist: Float32Array,
  dims: [number, number, number],
): Float32Array {
  const [depth, height, width] = dims;
  const slice = height * width;
  const out = new Float32Array(dist.length);
  for (let z = 0; z < depth; z += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (z * height + y) * width + x;
        if (dist[i] === 0) continue;
        let sum = dist[i];
        let count = 1;
        const add = (value: number) => {
          sum += value;
          count += 1;
        };
        if (x > 0) add(dist[i - 1]);
        if (x < width - 1) add(dist[i + 1]);
        if (y > 0) add(dist[i - width]);
        if (y < height - 1) add(dist[i + width]);
        if (z > 0) add(dist[i - slice]);
        if (z < depth - 1) add(dist[i + slice]);
        out[i] = sum / count;
      }
    }
  }
  return out;
}

/** Binary max-heap of voxel indices keyed by a distance array. */
class MaxHeap {
  private heap: number[] = [];
  constructor(private readonly key: Float32Array) {}
  get size(): number {
    return this.heap.length;
  }
  push(index: number): void {
    const h = this.heap;
    h.push(index);
    let i = h.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.key[h[parent]] >= this.key[h[i]]) break;
      [h[parent], h[i]] = [h[i], h[parent]];
      i = parent;
    }
  }
  pop(): number {
    const h = this.heap;
    const top = h[0];
    const last = h.pop() as number;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let largest = i;
        if (l < h.length && this.key[h[l]] > this.key[h[largest]]) largest = l;
        if (r < h.length && this.key[h[r]] > this.key[h[largest]]) largest = r;
        if (largest === i) break;
        [h[largest], h[i]] = [h[i], h[largest]];
        i = largest;
      }
    }
    return top;
  }
}

const NEIGHBORS_26: Array<[number, number, number]> = (() => {
  const out: Array<[number, number, number]> = [];
  for (let dz = -1; dz <= 1; dz += 1)
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dx = -1; dx <= 1; dx += 1)
        if (dz || dy || dx) out.push([dz, dy, dx]);
  return out;
})();

export interface WatershedResult {
  labels: Int32Array;
  components: MaskComponent[];
}

export function watershedSplit(
  mask: Uint8Array,
  dims: [number, number, number],
  options: WatershedOptions = {},
): WatershedResult {
  const [depth, height, width] = dims;
  const slice = height * width;

  const dist = smooth(distanceTransform(mask, dims), dims);

  // One foreground component pass, so we can guarantee every component seeds at
  // least one marker (otherwise a thin component would be left unlabeled).
  const fg = labelComponents(mask, dims, 26);
  const compMaxVal = new Float32Array(fg.components.length + 1);
  const compMaxIdx = new Int32Array(fg.components.length + 1).fill(-1);
  const compHasSeed = new Uint8Array(fg.components.length + 1);

  // Markers = connected "cores": foreground voxels deep enough (distance ≥
  // coreThreshold) to be a tooth center. One connected core per tooth — far
  // less over-splitting than one-marker-per-local-max — and the threshold is
  // the granularity knob: lower lets cores of touching teeth merge (coarser,
  // fewer teeth), higher shrinks cores so they separate (finer, more teeth).
  // Any fg component with no core still gets its peak voxel so nothing is left
  // unlabeled.
  const coreThreshold = options.coreThreshold ?? DEFAULT_CORE_THRESHOLD;
  const seedMask = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] === 0) continue;
    const comp = fg.labels[i];
    const dv = dist[i];
    if (dv > compMaxVal[comp]) {
      compMaxVal[comp] = dv;
      compMaxIdx[comp] = i;
    }
    if (dv >= coreThreshold) {
      seedMask[i] = 1;
      compHasSeed[comp] = 1;
    }
  }
  for (let c = 1; c < fg.components.length + 1; c += 1) {
    if (!compHasSeed[c] && compMaxIdx[c] >= 0) seedMask[compMaxIdx[c]] = 1;
  }

  // Each connected core is one marker basin.
  const markers = labelComponents(seedMask, dims, 26);

  const labels = new Int32Array(mask.length);
  const heap = new MaxHeap(dist);
  for (let i = 0; i < mask.length; i += 1) {
    if (seedMask[i]) {
      labels[i] = markers.labels[i];
      heap.push(i);
    }
  }

  while (heap.size > 0) {
    const i = heap.pop();
    const label = labels[i];
    const z = Math.floor(i / slice);
    const rem = i - z * slice;
    const y = Math.floor(rem / width);
    const x = rem - y * width;
    for (const [dz, dy, dx] of NEIGHBORS_26) {
      const nz = z + dz;
      const ny = y + dy;
      const nx = x + dx;
      if (nz < 0 || ny < 0 || nx < 0) continue;
      if (nz >= depth || ny >= height || nx >= width) continue;
      const ni = (nz * height + ny) * width + nx;
      if (mask[ni] === 0 || labels[ni] !== 0) continue;
      labels[ni] = label;
      heap.push(ni);
    }
  }

  // Build components from the final basins.
  const stats = new Map<
    number,
    { voxels: number; bbox: [number, number, number, number, number, number]; sz: number; sy: number; sx: number }
  >();
  for (let z = 0; z < depth; z += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (z * height + y) * width + x;
        const label = labels[i];
        if (label === 0) continue;
        let s = stats.get(label);
        if (!s) {
          s = {
            voxels: 0,
            bbox: [depth, height, width, 0, 0, 0],
            sz: 0,
            sy: 0,
            sx: 0,
          };
          stats.set(label, s);
        }
        s.voxels += 1;
        s.sz += z;
        s.sy += y;
        s.sx += x;
        if (z < s.bbox[0]) s.bbox[0] = z;
        if (y < s.bbox[1]) s.bbox[1] = y;
        if (x < s.bbox[2]) s.bbox[2] = x;
        if (z + 1 > s.bbox[3]) s.bbox[3] = z + 1;
        if (y + 1 > s.bbox[4]) s.bbox[4] = y + 1;
        if (x + 1 > s.bbox[5]) s.bbox[5] = x + 1;
      }
    }
  }

  const components: MaskComponent[] = [];
  for (const [id, s] of stats) {
    components.push({
      id,
      voxels: s.voxels,
      bbox: s.bbox,
      centroid: [s.sz / s.voxels, s.sy / s.voxels, s.sx / s.voxels],
    });
  }

  return { labels, components };
}
