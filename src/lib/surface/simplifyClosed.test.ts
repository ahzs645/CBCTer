import { describe, expect, it } from 'vitest';
import {
  indexedToStl,
  simplifyClosedMesh,
  simplifyClosedStl,
  stlToIndexed,
  type IndexedMesh,
} from './simplifyClosed';

/** Icosphere of radius r, subdivided n times (20·4ⁿ triangles), outward CCW. */
function icosphere(r: number, n: number): IndexedMesh {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts: number[][] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ];
  let faces: number[][] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  const norm = (v: number[]) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [(v[0] / l) * r, (v[1] / l) * r, (v[2] / l) * r];
  };
  for (let i = 0; i < verts.length; i++) verts[i] = norm(verts[i]);
  for (let s = 0; s < n; s++) {
    const mid = new Map<string, number>();
    const midpoint = (a: number, b: number) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let m = mid.get(key);
      if (m === undefined) {
        const va = verts[a];
        const vb = verts[b];
        m = verts.length;
        verts.push(norm([va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]]));
        mid.set(key, m);
      }
      return m;
    };
    const next: number[][] = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  return {
    positions: Float32Array.from(verts.flat()),
    indices: Uint32Array.from(faces.flat()),
  };
}

/** Torus around z with major radius R and minor radius r, outward CCW. */
function torus(R: number, r: number, nu: number, nv: number): IndexedMesh {
  const positions = new Float32Array(nu * nv * 3);
  const indices = new Uint32Array(nu * nv * 6);
  for (let i = 0; i < nu; i++) {
    const u = (i / nu) * 2 * Math.PI;
    for (let j = 0; j < nv; j++) {
      const v = (j / nv) * 2 * Math.PI;
      const k = (i * nv + j) * 3;
      positions[k] = (R + r * Math.cos(v)) * Math.cos(u);
      positions[k + 1] = (R + r * Math.cos(v)) * Math.sin(u);
      positions[k + 2] = r * Math.sin(v);
    }
  }
  let o = 0;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * nv + j;
      const b = ((i + 1) % nu) * nv + j;
      const c = ((i + 1) % nu) * nv + ((j + 1) % nv);
      const d = i * nv + ((j + 1) % nv);
      indices.set([a, b, c, a, c, d], o);
      o += 6;
    }
  }
  return { positions, indices };
}

function signedVolume(m: IndexedMesh): number {
  const p = m.positions;
  const ix = m.indices;
  let v = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3;
    const b = ix[t + 1] * 3;
    const c = ix[t + 2] * 3;
    v +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
      p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

/** Edge/topology summary: every undirected edge's use count and orientation. */
function topology(m: IndexedMesh) {
  const nv = m.positions.length / 3;
  const directed = new Map<number, number>();
  const ix = m.indices;
  let degenerate = 0;
  for (let t = 0; t < ix.length; t += 3) {
    if (ix[t] === ix[t + 1] || ix[t + 1] === ix[t + 2] || ix[t] === ix[t + 2])
      degenerate++;
    for (let k = 0; k < 3; k++) {
      const key = ix[t + k] * nv + ix[t + ((k + 1) % 3)];
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  }
  let edges = 0;
  let notTwoFaced = 0;
  let misoriented = 0;
  for (const [key, count] of directed) {
    const i = Math.floor(key / nv);
    const j = key % nv;
    const back = directed.get(j * nv + i) ?? 0;
    if (count !== 1 || back !== 1) misoriented++;
    if (i < j || back === 0) {
      edges++;
      if (count + back !== 2) notTwoFaced++;
    }
  }
  const used = new Set(ix);
  return {
    V: used.size,
    E: edges,
    F: ix.length / 3,
    euler: used.size - edges + ix.length / 3,
    notTwoFaced,
    misoriented,
    degenerate,
  };
}

describe('simplifyClosedMesh', () => {
  it('keeps a finely tessellated sphere closed, outward and on the surface', () => {
    const R = 10;
    const sphere = icosphere(R, 6);
    expect(sphere.indices.length / 3).toBe(81920);
    const before = topology(sphere);
    expect(before.euler).toBe(2);
    const v0 = signedVolume(sphere);
    const maxErrorMm = 0.1;
    const progress: number[] = [];
    const out = simplifyClosedMesh(sphere, {
      targetRatio: 0.1,
      maxErrorMm,
      onProgress: (f) => progress.push(f),
    });

    expect(out.stats.outputTriangles).toBe(out.indices.length / 3);
    expect(out.stats.outputTriangles).toBeLessThanOrEqual(8192);
    expect(out.stats.outputTriangles).toBeGreaterThan(8000);
    expect(out.stats.stoppedBy).toBe('target');
    expect(progress.at(-1)).toBe(1);

    const after = topology(out);
    expect(after.notTwoFaced).toBe(0);
    expect(after.misoriented).toBe(0);
    expect(after.degenerate).toBe(0);
    expect(after.euler).toBe(2);

    const v1 = signedVolume(out);
    expect(v1).toBeGreaterThan(0);
    expect(Math.abs(v1 / v0 - 1)).toBeLessThan(0.01);

    // Every face still points away from the centre.
    const p = out.positions;
    const ix = out.indices;
    let inward = 0;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3;
      const b = ix[t + 1] * 3;
      const c = ix[t + 2] * 3;
      const ux = p[b] - p[a];
      const uy = p[b + 1] - p[a + 1];
      const uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a];
      const vy = p[c + 1] - p[a + 1];
      const vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const cx = p[a] + p[b] + p[c];
      const cy = p[a + 1] + p[b + 1] + p[c + 1];
      const cz = p[a + 2] + p[b + 2] + p[c + 2];
      if (nx * cx + ny * cy + nz * cz <= 0) inward++;
    }
    expect(inward).toBe(0);

    let maxDist = 0;
    for (let v = 0; v < p.length; v += 3) {
      const d = Math.abs(Math.hypot(p[v], p[v + 1], p[v + 2]) - R);
      maxDist = Math.max(maxDist, d);
    }
    expect(maxDist).toBeLessThan(maxErrorMm);
  });

  it('keeps a torus a closed genus-1 surface', () => {
    const R = 10;
    const r = 3;
    const shape = torus(R, r, 256, 160);
    expect(shape.indices.length / 3).toBe(81920);
    expect(topology(shape).euler).toBe(0);
    const v0 = signedVolume(shape);
    const maxErrorMm = 0.1;
    const out = simplifyClosedMesh(shape, { targetRatio: 0.1, maxErrorMm });

    expect(out.stats.outputTriangles).toBeLessThanOrEqual(8192);
    const after = topology(out);
    expect(after.notTwoFaced).toBe(0);
    expect(after.misoriented).toBe(0);
    expect(after.degenerate).toBe(0);
    expect(after.euler).toBe(0);

    const v1 = signedVolume(out);
    expect(v1).toBeGreaterThan(0);
    expect(Math.abs(v1 / v0 - 1)).toBeLessThan(0.01);

    const p = out.positions;
    let maxDist = 0;
    for (let v = 0; v < p.length; v += 3) {
      const ring = Math.hypot(p[v], p[v + 1]) - R;
      const d = Math.abs(Math.hypot(ring, p[v + 2]) - r);
      maxDist = Math.max(maxDist, d);
    }
    expect(maxDist).toBeLessThan(maxErrorMm);
  });

  it('stops at the error limit instead of the target', () => {
    const sphere = icosphere(10, 5);
    const out = simplifyClosedMesh(sphere, {
      targetTriangles: 20,
      maxErrorMm: 0.01,
    });
    expect(out.stats.stoppedBy).toBe('error');
    expect(out.stats.outputTriangles).toBeGreaterThan(20);
    expect(out.stats.maxErrorMm).toBeLessThanOrEqual(0.01);
    expect(topology(out).euler).toBe(2);
  });

  it('never moves the rim of an open mesh', () => {
    const sphere = icosphere(10, 4);
    // Drop one triangle: three boundary edges.
    const open: IndexedMesh = {
      positions: sphere.positions,
      indices: sphere.indices.slice(3),
    };
    const out = simplifyClosedMesh(open, { targetRatio: 0.2, maxErrorMm: 0.2 });
    const t = topology(out);
    expect(out.stats.lockedVertices).toBe(3);
    expect(t.notTwoFaced).toBe(3);
    expect(t.euler).toBe(1);
    expect(out.stats.outputTriangles).toBeLessThan(open.indices.length / 3 / 2);
  });

  it('reduces a tetrahedron no further', () => {
    const tetra: IndexedMesh = {
      positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
      indices: Uint32Array.from([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
    };
    const out = simplifyClosedMesh(tetra, {
      targetTriangles: 1,
      maxErrorMm: 10,
    });
    expect(out.indices.length / 3).toBe(4);
    expect(topology(out).euler).toBe(2);
  });
});

describe('STL round trip', () => {
  it('preserves vertex and triangle counts and coordinates', () => {
    const sphere = icosphere(5, 3);
    const stl = indexedToStl(sphere);
    expect(stl.byteLength).toBe(84 + (sphere.indices.length / 3) * 50);
    const back = stlToIndexed(stl);
    expect(back.indices.length).toBe(sphere.indices.length);
    expect(back.positions.length).toBe(sphere.positions.length);
    for (let i = 0; i < back.indices.length; i++) {
      for (let k = 0; k < 3; k++) {
        expect(back.positions[back.indices[i] * 3 + k]).toBe(
          sphere.positions[sphere.indices[i] * 3 + k],
        );
      }
    }
  });

  it('simplifies an STL end to end', () => {
    const stl = indexedToStl(icosphere(10, 5));
    const small = simplifyClosedStl(stl, {
      targetRatio: 0.25,
      maxErrorMm: 0.1,
    });
    const mesh = stlToIndexed(small);
    expect(mesh.indices.length / 3).toBeLessThanOrEqual(5120);
    const t = topology(mesh);
    expect(t.notTwoFaced).toBe(0);
    expect(t.euler).toBe(2);
  });

  it('rejects a truncated file', () => {
    const stl = indexedToStl(icosphere(5, 1));
    expect(() => stlToIndexed(stl.subarray(0, 200))).toThrow();
  });
});
