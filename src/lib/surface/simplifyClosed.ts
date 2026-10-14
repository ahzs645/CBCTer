/**
 * Simplification of closed (watertight) triangle meshes that keeps them
 * closed: Garland–Heckbert quadric-error edge collapse with the safety checks
 * that keep a 2-manifold a 2-manifold.
 *
 * Every collapse must pass:
 * - the link condition (the one-rings of the two endpoints share exactly the
 *   two opposite vertices of the edge's two faces), so no edge ever gets a
 *   third face, no pinches appear and the genus is preserved;
 * - no surviving face turns by more than ~78° in one step (60° from its input
 *   orientation overall) or becomes a degenerate sliver;
 * - the quadric error (sum of squared distances to the original planes merged
 *   into the vertex, an upper bound on the squared distance to any one of
 *   them) stays within `maxErrorMm`². The bound is conservative: on CBCT
 *   tooth meshes the measured surface deviation is about a third of it.
 * - no component drops below a tetrahedron.
 *
 * Vertices that are not on a single closed, consistently oriented fan
 * (boundary or non-manifold input) are never moved, so open or broken input
 * comes out no worse than it went in.
 *
 * Pure module (no DOM, no Worker); `simplifyClient.ts` runs it in a worker.
 */

/** Triangle mesh in mm: xyz per vertex, three vertex indices per triangle. */
export interface IndexedMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface SimplifyClosedOptions {
  /** Fraction of the input triangles to keep (0–1). Default 0.1. The error
   * limit may stop it earlier (more triangles kept). */
  targetRatio?: number;
  /** Absolute triangle budget; overrides `targetRatio`. */
  targetTriangles?: number;
  /** Largest allowed distance (mm) of a vertex to any original face plane
   * merged into it. Default 0.05. */
  maxErrorMm?: number;
  /** Called now and then with the fraction of the work done (0–1). */
  onProgress?: (fraction: number) => void;
}

export interface SimplifyClosedStats {
  inputVertices: number;
  inputTriangles: number;
  outputVertices: number;
  outputTriangles: number;
  targetTriangles: number;
  collapses: number;
  /** Collapses refused by the link (manifold / genus) test. */
  rejectedTopology: number;
  /** Collapses refused because a face would flip or degenerate. */
  rejectedGeometry: number;
  /** Vertices never moved (boundary or non-manifold in the input). */
  lockedVertices: number;
  /** sqrt of the largest quadric error accepted, in mm. */
  maxErrorMm: number;
  /** Why it stopped: reached the target, or nothing left within the error limit. */
  stoppedBy: 'target' | 'error';
  passes: number;
  ms: number;
}

export interface SimplifyClosedResult extends IndexedMesh {
  stats: SimplifyClosedStats;
}

export const DEFAULT_TARGET_RATIO = 0.1;
export const DEFAULT_MAX_ERROR_MM = 0.05;

// A surviving face may turn by at most acos(0.2) ≈ 78° in one collapse, and
// by at most 60° from its input orientation over all collapses (so repeated
// small turns cannot fold a face back onto its neighbour).
const MIN_NORMAL_DOT = 0.2;
const MIN_REFERENCE_DOT = 0.5;
// Triangle quality 2√3|n|/Σl² (1 = equilateral); below this a new face must
// not be worse than the one it replaces.
const MIN_QUALITY = 0.1;
// Sweep stale heap entries once roughly this fraction of the heap may be stale.
const STALE_SWEEP = 0.5;

// ---------------------------------------------------------------- STL I/O

/** Parse a binary STL, welding corners with bit-identical coordinates. */
export function stlToIndexed(stl: Uint8Array): IndexedMesh {
  if (stl.byteLength < 84) throw new Error('Not a binary STL (too short).');
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const count = view.getUint32(80, true);
  if (84 + count * 50 > stl.byteLength)
    throw new Error('Not a binary STL (size does not match triangle count).');
  const corners = count * 3;
  let size = 16;
  while (size <= corners) size <<= 1;
  const mask = size - 1;
  const table = new Int32Array(size).fill(-1);
  const bits = new Uint32Array(corners * 3);
  const indices = new Uint32Array(corners);
  let nv = 0;
  for (let c = 0; c < corners; c++) {
    const off = 84 + ((c / 3) | 0) * 50 + 12 + (c % 3) * 12;
    let x = view.getUint32(off, true);
    let y = view.getUint32(off + 4, true);
    let z = view.getUint32(off + 8, true);
    // -0 and +0 are the same point.
    if (x === 0x80000000) x = 0;
    if (y === 0x80000000) y = 0;
    if (z === 0x80000000) z = 0;
    let h =
      Math.imul(x, 0x9e3779b1) ^
      Math.imul(y ^ (y >>> 16), 0x85ebca77) ^
      Math.imul(z ^ (z >>> 13), 0xc2b2ae3d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    let slot = h & mask;
    for (;;) {
      const v = table[slot];
      if (v < 0) {
        table[slot] = nv;
        bits[nv * 3] = x;
        bits[nv * 3 + 1] = y;
        bits[nv * 3 + 2] = z;
        indices[c] = nv++;
        break;
      }
      if (bits[v * 3] === x && bits[v * 3 + 1] === y && bits[v * 3 + 2] === z) {
        indices[c] = v;
        break;
      }
      slot = (slot + 1) & mask;
    }
  }
  const positions = new Float32Array(bits.buffer, 0, nv * 3).slice();
  return { positions, indices };
}

/** Binary STL with computed face normals. */
export function indexedToStl(mesh: IndexedMesh): Uint8Array {
  const { positions: p, indices } = mesh;
  const count = Math.floor(indices.length / 3);
  const out = new Uint8Array(84 + count * 50);
  out.set(new TextEncoder().encode('CBCTer simplified surface (mm)'));
  const view = new DataView(out.buffer);
  view.setUint32(80, count, true);
  let o = 84;
  for (let t = 0; t < count; t++) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    view.setFloat32(o, nx / len, true);
    view.setFloat32(o + 4, ny / len, true);
    view.setFloat32(o + 8, nz / len, true);
    view.setFloat32(o + 12, p[a], true);
    view.setFloat32(o + 16, p[a + 1], true);
    view.setFloat32(o + 20, p[a + 2], true);
    view.setFloat32(o + 24, p[b], true);
    view.setFloat32(o + 28, p[b + 1], true);
    view.setFloat32(o + 32, p[b + 2], true);
    view.setFloat32(o + 36, p[c], true);
    view.setFloat32(o + 40, p[c + 1], true);
    view.setFloat32(o + 44, p[c + 2], true);
    o += 50;
  }
  return out;
}

/** Parse, simplify and re-encode a binary STL. */
export function simplifyClosedStl(
  stl: Uint8Array,
  options: SimplifyClosedOptions = {},
): Uint8Array {
  return indexedToStl(simplifyClosedMesh(stlToIndexed(stl), options));
}

// ------------------------------------------------------------ simplifier

/** Simplify a closed mesh, keeping it closed, manifold and oriented. */
export function simplifyClosedMesh(
  mesh: IndexedMesh,
  options: SimplifyClosedOptions = {},
): SimplifyClosedResult {
  const t0 = now();
  const nV = Math.floor(mesh.positions.length / 3);
  const nF = Math.floor(mesh.indices.length / 3);
  const maxErr = options.maxErrorMm ?? DEFAULT_MAX_ERROR_MM;
  const maxCost = maxErr * maxErr;
  const targetFaces = Math.max(
    4,
    Math.floor(
      options.targetTriangles ??
        nF * (options.targetRatio ?? DEFAULT_TARGET_RATIO),
    ),
  );
  const onProgress = options.onProgress;

  const pos = Float64Array.from(mesh.positions);
  const tri = new Int32Array(nF * 3);
  const faceAlive = new Uint8Array(nF);
  let liveFaces = 0;
  for (let f = 0; f < nF; f++) {
    const a = mesh.indices[f * 3];
    const b = mesh.indices[f * 3 + 1];
    const c = mesh.indices[f * 3 + 2];
    tri[f * 3] = a;
    tri[f * 3 + 1] = b;
    tri[f * 3 + 2] = c;
    if (a !== b && b !== c && a !== c && a < nV && b < nV && c < nV) {
      faceAlive[f] = 1;
      liveFaces++;
    }
  }

  // Vertex → faces lists in one pool; a list that outgrows its slot moves to
  // the end of the pool, and the pool is repacked when it runs out.
  const fStart = new Int32Array(nV);
  const fCount = new Int32Array(nV);
  const fCap = new Int32Array(nV);
  for (let f = 0; f < nF; f++) {
    if (!faceAlive[f]) continue;
    fCount[tri[f * 3]]++;
    fCount[tri[f * 3 + 1]]++;
    fCount[tri[f * 3 + 2]]++;
  }
  const SLACK = 2;
  let poolEnd = 0;
  for (let v = 0; v < nV; v++) {
    fStart[v] = poolEnd;
    fCap[v] = fCount[v] + SLACK;
    poolEnd += fCap[v];
    fCount[v] = 0;
  }
  let pool = new Int32Array(Math.max(64, Math.ceil(poolEnd * 1.25)));
  for (let f = 0; f < nF; f++) {
    if (!faceAlive[f]) continue;
    for (let k = 0; k < 3; k++) {
      const v = tri[f * 3 + k];
      pool[fStart[v] + fCount[v]++] = f;
    }
  }

  const vAlive = new Uint8Array(nV);
  for (let v = 0; v < nV; v++) vAlive[v] = fCount[v] > 0 ? 1 : 0;

  // Quadrics: a², ab, ac, ad, b², bc, bd, c², cd, d² of each face plane
  // (unit normal, unweighted), summed onto the face's three vertices.
  const Q = new Float64Array(nV * 10);
  // Each face's input unit normal (faces keep their ids through collapses).
  const refNormal = new Float32Array(nF * 3);
  for (let f = 0; f < nF; f++) {
    if (!faceAlive[f]) continue;
    const i0 = tri[f * 3] * 3;
    const i1 = tri[f * 3 + 1] * 3;
    const i2 = tri[f * 3 + 2] * 3;
    const ux = pos[i1] - pos[i0];
    const uy = pos[i1 + 1] - pos[i0 + 1];
    const uz = pos[i1 + 2] - pos[i0 + 2];
    const vx = pos[i2] - pos[i0];
    const vy = pos[i2 + 1] - pos[i0 + 1];
    const vz = pos[i2 + 2] - pos[i0 + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0) {
      refNormal[f * 3] = NaN; // no reference orientation: never refuses
      continue;
    }
    nx /= len;
    ny /= len;
    nz /= len;
    refNormal[f * 3] = nx;
    refNormal[f * 3 + 1] = ny;
    refNormal[f * 3 + 2] = nz;
    const d = -(nx * pos[i0] + ny * pos[i0 + 1] + nz * pos[i0 + 2]);
    for (let k = 0; k < 3; k++) {
      const q = tri[f * 3 + k] * 10;
      Q[q] += nx * nx;
      Q[q + 1] += nx * ny;
      Q[q + 2] += nx * nz;
      Q[q + 3] += nx * d;
      Q[q + 4] += ny * ny;
      Q[q + 5] += ny * nz;
      Q[q + 6] += ny * d;
      Q[q + 7] += nz * nz;
      Q[q + 8] += nz * d;
      Q[q + 9] += d * d;
    }
  }

  // Lock every vertex whose faces are not one closed, consistently oriented
  // fan (boundary, non-manifold, or flipped neighbours).
  const locked = new Uint8Array(nV);
  let lockedCount = 0;
  for (let v = 0; v < nV; v++) {
    if (!vAlive[v]) continue;
    if (!closedFan(v)) {
      locked[v] = 1;
      lockedCount++;
    }
  }

  function closedFan(v: number): boolean {
    const s = fStart[v];
    const n = fCount[v];
    if (n < 3) return false;
    // Each face around v contributes the directed opposite edge from → to.
    // A closed fan is a single cycle through all of them.
    let first = -1;
    let cur = -1;
    for (let step = 0; step < n; step++) {
      const f = step === 0 ? pool[s] : findFrom(v, cur);
      if (f < 0) return false;
      const k = cornerOf(f, v);
      const to = tri[f * 3 + ((k + 2) % 3)];
      if (step === 0) first = tri[f * 3 + ((k + 1) % 3)];
      cur = to;
    }
    if (cur !== first) return false;
    // Every 'from' must be distinct (no vertex visited twice around v).
    for (let i = 0; i < n; i++) {
      const fi = pool[s + i];
      const from = tri[fi * 3 + ((cornerOf(fi, v) + 1) % 3)];
      for (let j = i + 1; j < n; j++) {
        const fj = pool[s + j];
        if (tri[fj * 3 + ((cornerOf(fj, v) + 1) % 3)] === from) return false;
      }
    }
    return true;
  }

  function findFrom(v: number, from: number): number {
    const s = fStart[v];
    const n = fCount[v];
    let found = -1;
    for (let i = 0; i < n; i++) {
      const f = pool[s + i];
      if (tri[f * 3 + ((cornerOf(f, v) + 1) % 3)] === from) {
        if (found >= 0) return -1;
        found = f;
      }
    }
    return found;
  }

  function cornerOf(f: number, v: number): number {
    return tri[f * 3] === v ? 0 : tri[f * 3 + 1] === v ? 1 : 2;
  }

  // ------------------------------------------------------------- heap
  // 4-ary min-heap of (error, entry). An entry is an edge a–b plus the
  // endpoints' stamps when it was queued; any later change to a or b bumps
  // its stamp, so stale entries are recognised and skipped when popped.
  // Sized for the first pass (about 1.5 edges per face) to avoid regrowth.
  let hCap = Math.max(1 << 12, Math.ceil(liveFaces * 1.6));
  let hKey = new Float64Array(hCap);
  let hEnt = new Int32Array(hCap);
  let hSize = 0;
  let eData = new Int32Array(hCap * 4);
  let eFree = new Int32Array(hCap);
  let eFreeTop = 0;
  let eNext = 0;
  const stamp = new Int32Array(nV);

  function heapGrow(): void {
    hCap *= 2;
    const k = new Float64Array(hCap);
    k.set(hKey);
    hKey = k;
    const e = new Int32Array(hCap);
    e.set(hEnt);
    hEnt = e;
    const d = new Int32Array(hCap * 4);
    d.set(eData);
    eData = d;
    const fr = new Int32Array(hCap);
    fr.set(eFree.subarray(0, eFreeTop));
    eFree = fr;
  }

  function newEntry(a: number, b: number): number {
    const e = eFreeTop > 0 ? eFree[--eFreeTop] : eNext++;
    const e4 = e * 4;
    eData[e4] = a;
    eData[e4 + 1] = b;
    eData[e4 + 2] = stamp[a];
    eData[e4 + 3] = stamp[b];
    return e;
  }

  function siftUp(i: number, key: number, e: number): void {
    while (i > 0) {
      const p = (i - 1) >> 2;
      if (hKey[p] <= key) break;
      hKey[i] = hKey[p];
      hEnt[i] = hEnt[p];
      i = p;
    }
    hKey[i] = key;
    hEnt[i] = e;
  }

  function siftDown(i: number): void {
    const key = hKey[i];
    const e = hEnt[i];
    for (;;) {
      const c0 = 4 * i + 1;
      if (c0 >= hSize) break;
      let c = c0;
      let ck = hKey[c0];
      const cEnd = Math.min(c0 + 4, hSize);
      for (let j = c0 + 1; j < cEnd; j++) {
        if (hKey[j] < ck) {
          ck = hKey[j];
          c = j;
        }
      }
      if (ck >= key) break;
      hKey[i] = ck;
      hEnt[i] = hEnt[c];
      i = c;
    }
    hKey[i] = key;
    hEnt[i] = e;
  }

  /** Append without ordering (call heapify after a batch). */
  function heapAppend(key: number, a: number, b: number): void {
    if (hSize === hCap) heapGrow();
    hKey[hSize] = key;
    hEnt[hSize++] = newEntry(a, b);
  }

  function heapify(): void {
    for (let i = (hSize - 2) >> 2; i >= 0; i--) siftDown(i);
  }

  function heapPush(key: number, a: number, b: number): void {
    if (hSize === hCap) heapGrow();
    siftUp(hSize++, key, newEntry(a, b));
  }

  /** Remove the top; its entry slot is recycled. */
  function heapPopTop(): void {
    eFree[eFreeTop++] = hEnt[0];
    hSize--;
    if (hSize > 0) {
      hKey[0] = hKey[hSize];
      hEnt[0] = hEnt[hSize];
      siftDown(0);
    }
  }

  function entryValid(e: number): boolean {
    const e4 = e * 4;
    const a = eData[e4];
    const b = eData[e4 + 1];
    return (
      vAlive[a] === 1 &&
      vAlive[b] === 1 &&
      stamp[a] === eData[e4 + 2] &&
      stamp[b] === eData[e4 + 3]
    );
  }

  /** Drop stale entries and re-heapify. */
  function heapCompact(): void {
    let n = 0;
    for (let i = 0; i < hSize; i++) {
      const e = hEnt[i];
      if (!entryValid(e)) {
        eFree[eFreeTop++] = e;
        continue;
      }
      hKey[n] = hKey[i];
      hEnt[n++] = e;
    }
    hSize = n;
    heapify();
  }

  // --------------------------------------------------------- placement
  let tx = 0;
  let ty = 0;
  let tz = 0;

  /** Collapse target for edge a–b into tx/ty/tz; returns its quadric error. */
  function placement(a: number, b: number): number {
    const qa = a * 10;
    const qb = b * 10;
    const q0 = Q[qa] + Q[qb];
    const q1 = Q[qa + 1] + Q[qb + 1];
    const q2 = Q[qa + 2] + Q[qb + 2];
    const q3 = Q[qa + 3] + Q[qb + 3];
    const q4 = Q[qa + 4] + Q[qb + 4];
    const q5 = Q[qa + 5] + Q[qb + 5];
    const q6 = Q[qa + 6] + Q[qb + 6];
    const q7 = Q[qa + 7] + Q[qb + 7];
    const q8 = Q[qa + 8] + Q[qb + 8];
    const q9 = Q[qa + 9] + Q[qb + 9];
    const ax = pos[a * 3];
    const ay = pos[a * 3 + 1];
    const az = pos[a * 3 + 2];
    const bx = pos[b * 3];
    const by = pos[b * 3 + 1];
    const bz = pos[b * 3 + 2];
    const mx = (ax + bx) * 0.5;
    const my = (ay + by) * 0.5;
    const mz = (az + bz) * 0.5;

    // Cofactors of the symmetric 3×3 A = [q0 q1 q2; q1 q4 q5; q2 q5 q7].
    const c00 = q4 * q7 - q5 * q5;
    const c01 = q2 * q5 - q1 * q7;
    const c02 = q1 * q5 - q2 * q4;
    const det = q0 * c00 + q1 * c01 + q2 * c02;
    const tr = (q0 + q4 + q7) / 3;
    if (tr > 0 && det > 1e-3 * tr * tr * tr) {
      const c11 = q0 * q7 - q2 * q2;
      const c12 = q1 * q2 - q0 * q5;
      const c22 = q0 * q4 - q1 * q1;
      const inv = -1 / det;
      const x = (c00 * q3 + c01 * q6 + c02 * q8) * inv;
      const y = (c01 * q3 + c11 * q6 + c12 * q8) * inv;
      const z = (c02 * q3 + c12 * q6 + c22 * q8) * inv;
      const ex = bx - ax;
      const ey = by - ay;
      const ez = bz - az;
      const dx = x - mx;
      const dy = y - my;
      const dz = z - mz;
      // Accept only if it stays near the edge (ill-conditioned otherwise).
      if (dx * dx + dy * dy + dz * dz <= ex * ex + ey * ey + ez * ez) {
        tx = x;
        ty = y;
        tz = z;
        return Math.max(0, qerr(x, y, z));
      }
    }
    let best = qerr(mx, my, mz);
    tx = mx;
    ty = my;
    tz = mz;
    const ea = qerr(ax, ay, az);
    if (ea < best) {
      best = ea;
      tx = ax;
      ty = ay;
      tz = az;
    }
    const eb = qerr(bx, by, bz);
    if (eb < best) {
      best = eb;
      tx = bx;
      ty = by;
      tz = bz;
    }
    return Math.max(0, best);

    function qerr(x: number, y: number, z: number): number {
      return (
        q0 * x * x +
        2 * q1 * x * y +
        2 * q2 * x * z +
        2 * q3 * x +
        q4 * y * y +
        2 * q5 * y * z +
        2 * q6 * y +
        q7 * z * z +
        2 * q8 * z +
        q9
      );
    }
  }

  // ---------------------------------------------------------- collapse
  const mark = new Int32Array(nV);
  const seen = new Int32Array(nV);
  let markStamp = 0;
  let scratch = new Int32Array(256);
  let collapses = 0;
  let rejectedTopology = 0;
  let rejectedGeometry = 0;
  let maxAccepted = 0;

  /** Would moving vertex `v`'s faces (except a–b's two) to t keep them sane? */
  function facesStayValid(v: number, a: number, b: number): boolean {
    const s = fStart[v];
    const n = fCount[v];
    for (let i = 0; i < n; i++) {
      const f = pool[s + i];
      const f3 = f * 3;
      const k = cornerOf(f, v);
      const o1 = tri[f3 + ((k + 1) % 3)];
      const o2 = tri[f3 + ((k + 2) % 3)];
      if (o1 === a || o1 === b || o2 === a || o2 === b) continue; // shared face
      const p0 = v * 3;
      const p1 = o1 * 3;
      const p2 = o2 * 3;
      const e1x = pos[p1] - pos[p0];
      const e1y = pos[p1 + 1] - pos[p0 + 1];
      const e1z = pos[p1 + 2] - pos[p0 + 2];
      const e2x = pos[p2] - pos[p0];
      const e2y = pos[p2 + 1] - pos[p0 + 1];
      const e2z = pos[p2 + 2] - pos[p0 + 2];
      const ox = e1y * e2z - e1z * e2y;
      const oy = e1z * e2x - e1x * e2z;
      const oz = e1x * e2y - e1y * e2x;
      const n1x = pos[p1] - tx;
      const n1y = pos[p1 + 1] - ty;
      const n1z = pos[p1 + 2] - tz;
      const n2x = pos[p2] - tx;
      const n2y = pos[p2 + 1] - ty;
      const n2z = pos[p2 + 2] - tz;
      const nx = n1y * n2z - n1z * n2y;
      const ny = n1z * n2x - n1x * n2z;
      const nz = n1x * n2y - n1y * n2x;
      const oLen = Math.sqrt(ox * ox + oy * oy + oz * oz);
      const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nLen === 0) return false;
      if (ox * nx + oy * ny + oz * nz < MIN_NORMAL_DOT * oLen * nLen)
        return false;
      if (
        refNormal[f3] * nx + refNormal[f3 + 1] * ny + refNormal[f3 + 2] * nz <
        MIN_REFERENCE_DOT * nLen
      )
        return false;
      // Sliver check: 2√3|n| / Σ edge² (1 for an equilateral triangle).
      const ex = pos[p2] - pos[p1];
      const ey = pos[p2 + 1] - pos[p1 + 1];
      const ez = pos[p2 + 2] - pos[p1 + 2];
      const opp = ex * ex + ey * ey + ez * ez;
      const qNew =
        (3.4641016151377544 * nLen) /
        (n1x * n1x +
          n1y * n1y +
          n1z * n1z +
          n2x * n2x +
          n2y * n2y +
          n2z * n2z +
          opp);
      if (qNew < MIN_QUALITY) {
        const qOld =
          (3.4641016151377544 * oLen) /
          (e1x * e1x +
            e1y * e1y +
            e1z * e1z +
            e2x * e2x +
            e2y * e2y +
            e2z * e2z +
            opp);
        if (qNew < qOld) return false;
      }
    }
    return true;
  }

  function removeFace(v: number, f: number): void {
    const s = fStart[v];
    const n = fCount[v];
    for (let i = 0; i < n; i++) {
      if (pool[s + i] === f) {
        pool[s + i] = pool[s + n - 1];
        fCount[v] = n - 1;
        return;
      }
    }
  }

  function repackPool(need: number): void {
    let total = need;
    for (let v = 0; v < nV; v++) if (vAlive[v]) total += fCount[v] + SLACK;
    const next = new Int32Array(Math.ceil(total * 1.5) + 64);
    let end = 0;
    for (let v = 0; v < nV; v++) {
      if (!vAlive[v]) {
        fStart[v] = 0;
        fCap[v] = 0;
        continue;
      }
      const n = fCount[v];
      next.set(pool.subarray(fStart[v], fStart[v] + n), end);
      fStart[v] = end;
      fCap[v] = n + SLACK;
      end += n + SLACK;
    }
    pool = next;
    poolEnd = end;
  }

  /** Try to collapse a–b to its placement; true if it happened. */
  function tryCollapse(a: number, b: number): boolean {
    // Shared faces: faces of b that contain a. Must be exactly two.
    const sb = fStart[b];
    const nb = fCount[b];
    let s0 = -1;
    let s1 = -1;
    let shared = 0;
    for (let i = 0; i < nb; i++) {
      const f = pool[sb + i];
      const f3 = f * 3;
      if (tri[f3] === a || tri[f3 + 1] === a || tri[f3 + 2] === a) {
        if (shared === 0) s0 = f;
        else s1 = f;
        shared++;
      }
    }
    if (shared !== 2) {
      rejectedTopology++;
      return false;
    }
    // Resulting valence: deg(a) + deg(b) − 4 (closed fans: valence = faces).
    if (fCount[a] + nb - 4 < 3) {
      rejectedTopology++;
      return false;
    }
    // Link condition: ring(a) ∩ ring(b) = {c, d}.
    markStamp++;
    const sa = fStart[a];
    const na = fCount[a];
    for (let i = 0; i < na; i++) {
      const f3 = pool[sa + i] * 3;
      mark[tri[f3]] = markStamp;
      mark[tri[f3 + 1]] = markStamp;
      mark[tri[f3 + 2]] = markStamp;
    }
    let common = 0;
    for (let i = 0; i < nb; i++) {
      const f3 = pool[sb + i] * 3;
      for (let k = 0; k < 3; k++) {
        const w = tri[f3 + k];
        if (w === a || w === b || seen[w] === markStamp) continue;
        seen[w] = markStamp;
        if (mark[w] === markStamp) common++;
      }
    }
    if (common !== 2) {
      rejectedTopology++;
      return false;
    }
    if (!facesStayValid(a, a, b) || !facesStayValid(b, a, b)) {
      rejectedGeometry++;
      return false;
    }

    // Apply.
    pos[a * 3] = tx;
    pos[a * 3 + 1] = ty;
    pos[a * 3 + 2] = tz;
    for (let k = 0; k < 10; k++) Q[a * 10 + k] += Q[b * 10 + k];
    for (let r = 0; r < 2; r++) {
      const f = r === 0 ? s0 : s1;
      faceAlive[f] = 0;
      liveFaces--;
      const f3 = f * 3;
      for (let k = 0; k < 3; k++) {
        const w = tri[f3 + k];
        if (w !== a && w !== b) removeFace(w, f);
      }
    }
    const need = na + nb - 4;
    if (scratch.length < need) scratch = new Int32Array(need * 2);
    let n = 0;
    for (let i = 0; i < na; i++) {
      const f = pool[sa + i];
      if (f !== s0 && f !== s1) scratch[n++] = f;
    }
    for (let i = 0; i < nb; i++) {
      const f = pool[sb + i];
      if (f === s0 || f === s1) continue;
      const f3 = f * 3;
      if (tri[f3] === b) tri[f3] = a;
      else if (tri[f3 + 1] === b) tri[f3 + 1] = a;
      else tri[f3 + 2] = a;
      scratch[n++] = f;
    }
    vAlive[b] = 0;
    fCount[b] = 0;
    if (n > fCap[a]) {
      const cap = n + 4;
      if (poolEnd + cap > pool.length) repackPool(cap);
      fStart[a] = poolEnd;
      fCap[a] = cap;
      poolEnd += cap;
    }
    pool.set(scratch.subarray(0, n), fStart[a]);
    fCount[a] = n;
    stamp[a]++;
    stamp[b]++;
    return true;
  }

  /** Queue every edge from a to its (unlocked) neighbours. */
  function pushRing(a: number): void {
    markStamp++;
    const s = fStart[a];
    const n = fCount[a];
    mark[a] = markStamp;
    for (let i = 0; i < n; i++) {
      const f3 = pool[s + i] * 3;
      for (let k = 0; k < 3; k++) {
        const w = tri[f3 + k];
        if (mark[w] === markStamp) continue;
        mark[w] = markStamp;
        if (locked[w]) continue;
        const cost = placement(a, w);
        if (cost <= maxCost) heapPush(cost, a, w);
      }
    }
  }

  const startFaces = liveFaces;
  const toRemove = Math.max(1, startFaces - targetFaces);
  let nextReport = 0;
  let passes = 0;
  let stoppedBy: 'target' | 'error' = 'error';
  while (liveFaces > targetFaces && passes < 8) {
    passes++;
    // Queue every unlocked edge once (each interior edge appears once as i<j).
    hSize = 0;
    eFreeTop = 0;
    eNext = 0;
    for (let f = 0; f < nF; f++) {
      if (!faceAlive[f]) continue;
      for (let k = 0; k < 3; k++) {
        const i = tri[f * 3 + k];
        const j = tri[f * 3 + ((k + 1) % 3)];
        if (i > j || locked[i] || locked[j]) continue;
        const cost = placement(i, j);
        if (cost <= maxCost) heapAppend(cost, i, j);
      }
    }
    heapify();
    let staleEstimate = 0;
    const before = collapses;
    while (hSize > 0 && liveFaces > targetFaces) {
      const e4 = hEnt[0] * 4;
      const valid = entryValid(hEnt[0]);
      const a = eData[e4];
      const b = eData[e4 + 1];
      heapPopTop();
      if (!valid) continue;
      const cost = placement(a, b);
      if (cost > maxCost) continue;
      // Entries naming a or b go stale; when about half the heap may be stale,
      // sweeping it is cheaper than popping them one by one.
      const touched = fCount[a] + fCount[b];
      if (!tryCollapse(a, b)) continue;
      collapses++;
      if (cost > maxAccepted) maxAccepted = cost;
      pushRing(a);
      staleEstimate += touched;
      if (hSize > 1 << 16 && staleEstimate > hSize * STALE_SWEEP) {
        heapCompact();
        staleEstimate = 0;
      }
      if (onProgress && collapses >= nextReport) {
        nextReport = collapses + 32768;
        onProgress(Math.min(1, (startFaces - liveFaces) / toRemove));
      }
    }
    if (liveFaces <= targetFaces) {
      stoppedBy = 'target';
      break;
    }
    // A later pass retries edges refused earlier; stop when that stops paying.
    if (collapses - before < Math.max(1, liveFaces * 0.002)) break;
  }
  onProgress?.(1);

  // Compact.
  const remap = new Int32Array(nV).fill(-1);
  let outV = 0;
  const outIndices = new Uint32Array(liveFaces * 3);
  let o = 0;
  for (let f = 0; f < nF; f++) {
    if (!faceAlive[f]) continue;
    for (let k = 0; k < 3; k++) {
      const v = tri[f * 3 + k];
      if (remap[v] < 0) remap[v] = outV++;
      outIndices[o++] = remap[v];
    }
  }
  const outPositions = new Float32Array(outV * 3);
  for (let v = 0; v < nV; v++) {
    const r = remap[v];
    if (r < 0) continue;
    outPositions[r * 3] = pos[v * 3];
    outPositions[r * 3 + 1] = pos[v * 3 + 1];
    outPositions[r * 3 + 2] = pos[v * 3 + 2];
  }

  return {
    positions: outPositions,
    indices: outIndices,
    stats: {
      inputVertices: nV,
      inputTriangles: nF,
      outputVertices: outV,
      outputTriangles: liveFaces,
      targetTriangles: targetFaces,
      collapses,
      rejectedTopology,
      rejectedGeometry,
      lockedVertices: lockedCount,
      maxErrorMm: Math.sqrt(maxAccepted),
      stoppedBy,
      passes,
      ms: now() - t0,
    },
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
