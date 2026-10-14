import type { Vec3 } from '../../types';
import type { IndexedMesh } from './simplifyClosed';

/**
 * Surface of a binary mask as an indexed mesh, built with typed arrays so a
 * whole dental arch (tens of millions of voxels, millions of triangles)
 * meshes in a few hundred megabytes instead of several gigabytes.
 *
 * Same surface as `maskToBinaryStl(..., { extraction: 'iso' })`: marching
 * tetrahedra (six tetrahedra around each cube's main diagonal) with vertices
 * at edge midpoints, then the same Laplacian smoothing (factor 0.35).
 *
 * `shape` is [x, y, z] with x fastest; positions are (voxel + origin) ×
 * spacing in millimetres.
 */
export function maskToSurface(
  mask: Uint8Array,
  shape: Vec3,
  spacing: Vec3,
  origin: Vec3 = [0, 0, 0],
  smoothIterations = 0,
): IndexedMesh {
  const [w, h, d] = shape;
  const plane = w * h;
  const at = (x: number, y: number, z: number) =>
    x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d
      ? 0
      : mask[z * plane + y * w + x]
        ? 1
        : 0;
  // Padded grid point index (one point of padding on every side).
  const pw = w + 2,
    pp = pw * (h + 2);
  const point = (x: number, y: number, z: number) =>
    (z + 1) * pp + (y + 1) * pw + (x + 1);
  const span = pp + pw + 2;

  // Edge → vertex: open-addressing hash on a numeric edge key.
  let capacity = 1 << 20;
  let keys = new Float64Array(capacity).fill(-1);
  let ids = new Int32Array(capacity);
  let used = 0;
  let positions = new Float32Array(3 << 20);
  let vertexCount = 0;
  let indices = new Uint32Array(6 << 20);
  let indexCount = 0;
  const slot = (key: number, size: number) => {
    const lo = key % 4294967296,
      hi = Math.floor(key / 4294967296);
    return (
      (Math.imul(lo | 0, 0x9e3779b1) ^ Math.imul(hi | 0, 0x85ebca6b)) &
      (size - 1)
    );
  };
  const grow = () => {
    const oldKeys = keys,
      oldIds = ids;
    capacity *= 2;
    keys = new Float64Array(capacity).fill(-1);
    ids = new Int32Array(capacity);
    for (let i = 0; i < oldKeys.length; i++) {
      if (oldKeys[i] < 0) continue;
      let s = slot(oldKeys[i], capacity);
      while (keys[s] >= 0) s = (s + 1) & (capacity - 1);
      keys[s] = oldKeys[i];
      ids[s] = oldIds[i];
    }
  };
  const vertex = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ) => {
    const pa = point(ax, ay, az),
      pb = point(bx, by, bz);
    const key = Math.min(pa, pb) * span + Math.abs(pb - pa);
    let s = slot(key, capacity);
    while (keys[s] >= 0) {
      if (keys[s] === key) return ids[s];
      s = (s + 1) & (capacity - 1);
    }
    if (vertexCount * 3 + 3 > positions.length) {
      const next = new Float32Array(positions.length * 2);
      next.set(positions);
      positions = next;
    }
    const v = vertexCount++;
    positions[v * 3] = ((ax + bx) / 2 + origin[0]) * spacing[0];
    positions[v * 3 + 1] = ((ay + by) / 2 + origin[1]) * spacing[1];
    positions[v * 3 + 2] = ((az + bz) / 2 + origin[2]) * spacing[2];
    keys[s] = key;
    ids[s] = v;
    if (++used * 2 > capacity) grow();
    return v;
  };
  const triangle = (a: number, b: number, c: number) => {
    if (indexCount + 3 > indices.length) {
      const next = new Uint32Array(indices.length * 2);
      next.set(indices);
      indices = next;
    }
    indices[indexCount++] = a;
    indices[indexCount++] = b;
    indices[indexCount++] = c;
  };

  const offsets = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const tetrahedra = [
    [0, 5, 1, 6],
    [0, 1, 2, 6],
    [0, 2, 3, 6],
    [0, 3, 7, 6],
    [0, 7, 4, 6],
    [0, 4, 5, 6],
  ];
  const cx = new Int32Array(8),
    cy = new Int32Array(8),
    cz = new Int32Array(8),
    value = new Uint8Array(8);
  const edge = (i: number, j: number) =>
    vertex(cx[i], cy[i], cz[i], cx[j], cy[j], cz[j]);
  const inside: number[] = [],
    outside: number[] = [];
  for (let z = -1; z < d; z++)
    for (let y = -1; y < h; y++)
      for (let x = -1; x < w; x++) {
        let count = 0;
        for (let i = 0; i < 8; i++) {
          cx[i] = x + offsets[i][0];
          cy[i] = y + offsets[i][1];
          cz[i] = z + offsets[i][2];
          value[i] = at(cx[i], cy[i], cz[i]);
          count += value[i];
        }
        if (count === 0 || count === 8) continue;
        for (const tet of tetrahedra) {
          inside.length = 0;
          outside.length = 0;
          for (const i of tet) (value[i] ? inside : outside).push(i);
          if (inside.length === 0 || inside.length === 4) continue;
          if (inside.length === 1 || inside.length === 3) {
            const anchor = inside.length === 1 ? inside[0] : outside[0];
            const others = inside.length === 1 ? outside : inside;
            const p0 = edge(anchor, others[0]),
              p1 = edge(anchor, others[1]),
              p2 = edge(anchor, others[2]);
            if (inside.length === 1) triangle(p0, p1, p2);
            else triangle(p2, p1, p0);
            continue;
          }
          const [a, b] = inside;
          const [c, e] = outside;
          const ac = edge(a, c),
            ad = edge(a, e),
            bc = edge(b, c),
            bd = edge(b, e);
          triangle(ac, bc, bd);
          triangle(ac, bd, ad);
        }
      }
  keys = new Float64Array(0);
  ids = new Int32Array(0);

  const mesh: IndexedMesh = {
    positions: positions.slice(0, vertexCount * 3),
    indices: indices.slice(0, indexCount),
  };
  positions = new Float32Array(0);
  indices = new Uint32Array(0);
  if (smoothIterations > 0) smoothMesh(mesh, Math.min(24, smoothIterations));
  return mesh;
}

/**
 * Laplacian smoothing (factor 0.35) towards the mean of each vertex's
 * neighbours, skipping vertices with fewer than three; in place.
 */
function smoothMesh(mesh: IndexedMesh, iterations: number) {
  const { indices } = mesh;
  const n = mesh.positions.length / 3;
  // Neighbour lists (each face adds both other corners to each corner; on a
  // closed surface every neighbour appears twice, which keeps the mean).
  const start = new Uint32Array(n + 1);
  for (let i = 0; i < indices.length; i++) start[indices[i] + 1] += 2;
  for (let v = 0; v < n; v++) start[v + 1] += start[v];
  const fill = start.slice(0, n);
  const neighbours = new Uint32Array(start[n]);
  for (let f = 0; f < indices.length; f += 3) {
    const a = indices[f],
      b = indices[f + 1],
      c = indices[f + 2];
    neighbours[fill[a]++] = b;
    neighbours[fill[a]++] = c;
    neighbours[fill[b]++] = a;
    neighbours[fill[b]++] = c;
    neighbours[fill[c]++] = a;
    neighbours[fill[c]++] = b;
  }
  let current: Float32Array = mesh.positions;
  let next: Float32Array = new Float32Array(current.length);
  const seen = new Int32Array(n).fill(-1);
  for (let it = 0; it < iterations; it++) {
    for (let v = 0; v < n; v++) {
      const s = start[v],
        e = start[v + 1];
      // Distinct neighbours, as the reference smoother counts them.
      let distinct = 0,
        sx = 0,
        sy = 0,
        sz = 0;
      for (let k = s; k < e; k++) {
        const u = neighbours[k];
        if (seen[u] === v) continue;
        seen[u] = v;
        distinct++;
        sx += current[u * 3];
        sy += current[u * 3 + 1];
        sz += current[u * 3 + 2];
      }
      // Reset the marks for the next vertex's pass of this iteration.
      for (let k = s; k < e; k++) seen[neighbours[k]] = -1;
      const o = v * 3;
      if (distinct < 3) {
        next[o] = current[o];
        next[o + 1] = current[o + 1];
        next[o + 2] = current[o + 2];
        continue;
      }
      next[o] = current[o] + (sx / distinct - current[o]) * 0.35;
      next[o + 1] = current[o + 1] + (sy / distinct - current[o + 1]) * 0.35;
      next[o + 2] = current[o + 2] + (sz / distinct - current[o + 2]) * 0.35;
    }
    const swap = current;
    current = next;
    next = swap;
  }
  mesh.positions = current;
}

/**
 * Make every closed piece of an indexed mesh consistently wound and facing
 * outward (positive volume), in place. Typed-array counterpart of
 * `orientStl` for meshes that already share vertices.
 */
export function orientMesh(mesh: IndexedMesh): void {
  const f = mesh.indices,
    p = mesh.positions;
  const halfEdges = f.length,
    count = halfEdges / 3,
    vertices = p.length / 3;
  const next = (e: number) => (e % 3 === 2 ? e - 2 : e + 1);
  // Half-edges listed under their lower vertex, to find each one's twin.
  const start = new Uint32Array(vertices + 1);
  for (let e = 0; e < halfEdges; e++) start[Math.min(f[e], f[next(e)]) + 1]++;
  for (let v = 0; v < vertices; v++) start[v + 1] += start[v];
  const fill = start.slice(0, vertices);
  const other = new Uint32Array(halfEdges),
    edgeOf = new Uint32Array(halfEdges);
  for (let e = 0; e < halfEdges; e++) {
    const a = f[e],
      b = f[next(e)];
    const slot = fill[Math.min(a, b)]++;
    other[slot] = Math.max(a, b);
    edgeOf[slot] = e;
  }
  const twin = new Int32Array(halfEdges).fill(-1);
  for (let v = 0; v < vertices; v++)
    for (let i = start[v]; i < start[v + 1]; i++) {
      if (twin[edgeOf[i]] >= 0) continue;
      for (let j = i + 1; j < start[v + 1]; j++)
        if (other[j] === other[i] && twin[edgeOf[j]] < 0) {
          twin[edgeOf[i]] = edgeOf[j];
          twin[edgeOf[j]] = edgeOf[i];
          break;
        }
    }
  const flip = new Uint8Array(count),
    seen = new Uint8Array(count),
    queue = new Int32Array(count);
  let tail = 0;
  for (let s = 0; s < count; s++) {
    if (seen[s]) continue;
    const first = tail;
    queue[tail++] = s;
    seen[s] = 1;
    let volume = 0;
    for (let head = first; head < tail; head++) {
      const t = queue[head];
      const a = f[t * 3] * 3,
        b = f[t * 3 + 1] * 3,
        c = f[t * 3 + 2] * 3;
      const signed =
        p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) +
        p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
      volume += flip[t] ? -signed : signed;
      for (let k = 0; k < 3; k++) {
        const e = t * 3 + k,
          o = twin[e];
        if (o < 0) continue;
        const g = (o / 3) | 0;
        if (seen[g]) continue;
        // Agreeing neighbours run a shared edge in opposite directions.
        flip[g] = flip[t] ^ (f[e] === f[o] ? 1 : 0);
        seen[g] = 1;
        queue[tail++] = g;
      }
    }
    if (volume < 0)
      for (let head = first; head < tail; head++) flip[queue[head]] ^= 1;
  }
  for (let t = 0; t < count; t++)
    if (flip[t]) {
      const tmp = f[t * 3 + 1];
      f[t * 3 + 1] = f[t * 3 + 2];
      f[t * 3 + 2] = tmp;
    }
}
