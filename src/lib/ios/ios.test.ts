import { describe, expect, it } from 'vitest';
import { meshToBinaryStl, parseMesh, type TriMesh } from './meshIo';
import {
  applyMatrix,
  rigidFromPairs,
  crownSurfacePoints,
  cropMeshNear,
  registerRigid,
  surfaceDeviation,
} from './register';

/** Unit cube, 8 vertices and 12 outward triangles. */
function box(): TriMesh {
  // prettier-ignore
  const positions = Float32Array.of(
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
  );
  // prettier-ignore
  const indices = Uint32Array.of(
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  );
  return { positions, indices };
}

/** Triangles as sorted lists of vertex coordinates, for order-free comparison. */
function triangleSet(mesh: TriMesh): string[] {
  const out: string[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const verts = [0, 1, 2].map((k) => {
      const v = mesh.indices[t + k] * 3;
      return Array.from(mesh.positions.subarray(v, v + 3)).join(',');
    });
    // Keep winding: rotate so the smallest vertex comes first.
    const start = verts.indexOf([...verts].sort()[0]);
    out.push([0, 1, 2].map((k) => verts[(start + k) % 3]).join(' | '));
  }
  return out.sort();
}

const encode = (s: string) => new TextEncoder().encode(s);

describe('parseMesh', () => {
  it('round-trips binary STL and welds shared vertices', () => {
    const stl = meshToBinaryStl(box());
    expect(stl.length).toBe(84 + 12 * 50);
    const view = new DataView(stl.buffer);
    // First face normal of the bottom (z = 0) face points down.
    expect(view.getFloat32(84 + 8, true)).toBeCloseTo(-1);
    const parsed = parseMesh(stl, 'box.stl');
    expect(parsed.positions.length).toBe(8 * 3);
    expect(triangleSet(parsed)).toEqual(triangleSet(box()));
  });

  it('reads a binary STL whose header starts with "solid"', () => {
    const stl = meshToBinaryStl(box());
    stl.set(encode('solid exported by some CAD tool'));
    expect(parseMesh(stl, 'box.stl').indices.length).toBe(36);
  });

  it('reads ASCII STL', () => {
    const text = `solid test
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 1 0 0
      vertex 0 1 0
    endloop
  endfacet
  facet normal 0 0 1
    outer loop
      vertex 1 0 0
      vertex 1 1 0
      vertex 0 1 0
    endloop
  endfacet
endsolid test
`;
    const mesh = parseMesh(encode(text), 'quad.stl');
    expect(mesh.positions.length).toBe(4 * 3);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 1, 3, 2]);
  });

  it('reads ASCII PLY with extra properties and a quad', () => {
    const text = `ply
format ascii 1.0
comment colours and normals are ignored
element vertex 4
property float x
property float y
property float z
property float nx
property uchar red
element face 1
property list uchar int vertex_indices
end_header
0 0 0 0 255
1 0 0 0 255
1 1 0 0 255
0 1 0 0 255
4 0 1 2 3
`;
    const mesh = parseMesh(encode(text), 'quad.ply');
    expect(Array.from(mesh.positions)).toEqual([
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
    ]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('reads binary little-endian PLY', () => {
    const src = box();
    const header = encode(`ply
format binary_little_endian 1.0
element vertex 8
property double x
property double y
property double z
property uchar red
property uchar green
property uchar blue
element face 12
property list uchar uint vertex_indices
property uchar flags
end_header
`);
    const body = new DataView(new ArrayBuffer(8 * 27 + 12 * 14));
    let o = 0;
    for (let v = 0; v < 8; v++) {
      for (let k = 0; k < 3; k++, o += 8)
        body.setFloat64(o, src.positions[v * 3 + k], true);
      o += 3;
    }
    for (let t = 0; t < 12; t++) {
      body.setUint8(o++, 3);
      for (let k = 0; k < 3; k++, o += 4)
        body.setUint32(o, src.indices[t * 3 + k], true);
      body.setUint8(o++, 7);
    }
    const bytes = new Uint8Array(header.length + body.byteLength);
    bytes.set(header);
    bytes.set(new Uint8Array(body.buffer), header.length);
    const mesh = parseMesh(bytes, 'box.ply');
    expect(Array.from(mesh.positions)).toEqual(Array.from(src.positions));
    expect(Array.from(mesh.indices)).toEqual(Array.from(src.indices));
  });

  it('reads OBJ with quads, v/vt/vn and negative indices', () => {
    const text = `# exported
mtllib a.mtl
o quad
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
vt 0 0
vn 0 0 1
f 1/1/1 2/1/1 3/1/1 4/1/1
v 0 0 1
f -1//1 -5 -4/1
`;
    const mesh = parseMesh(encode(text), 'quad.obj');
    expect(mesh.positions.length).toBe(5 * 3);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3, 4, 0, 1]);
  });

  it('rejects unsupported or corrupt files', () => {
    expect(() => parseMesh(encode('hello world'), 'notes.txt')).toThrow(
      /unsupported/,
    );
    expect(() => parseMesh(new Uint8Array(200), 'broken.stl')).toThrow(/STL/);
    expect(() =>
      parseMesh(encode('ply\nformat ascii 1.0\nelement vertex 1\n'), 'a.ply'),
    ).toThrow(/end_header/);
    expect(() =>
      parseMesh(encode('v 0 0 0\nv 1 0 0\nf 1 2 9\n'), 'a.obj'),
    ).toThrow(/missing vertex/);
  });
});

// --- synthetic dental arch ---------------------------------------------------

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

function gaussian(random: () => number): number {
  return (
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
  );
}

const archY = (x: number) => -(8 / 225) * x * x;

/** Six tapered crown blobs along a ~30 mm parabola, sampled on their surfaces. */
function archCrowns(random: () => number, count: number): Float32Array {
  const out = new Float32Array(count * 3);
  const centres = [-12.5, -7.5, -2.5, 2.5, 7.5, 12.5];
  const widths = [3.6, 3.0, 3.8, 3.8, 3.0, 3.6];
  for (let i = 0; i < count; i++) {
    const tooth = i % 6;
    const cx = centres[tooth];
    const cy = archY(cx);
    const angle = Math.atan(-(16 / 225) * cx);
    // Random direction on the unit sphere.
    const u = 2 * random() - 1,
      phi = 2 * Math.PI * random();
    const s = Math.sqrt(1 - u * u);
    let x = s * Math.cos(phi),
      y = s * Math.sin(phi),
      z = u;
    // Rounded box (superellipsoid-ish), crown wider toward the incisal end.
    const pow = 0.6;
    const scale = (v: number) => Math.sign(v) * Math.abs(v) ** pow;
    x = scale(x);
    y = scale(y);
    z = scale(z);
    const taper = 1 + 0.3 * z;
    const lx = x * widths[tooth] * 0.6 * taper,
      ly = y * 2.6 * taper,
      lz = z * 4.5;
    out[i * 3] = cx + lx * Math.cos(angle) - ly * Math.sin(angle);
    out[i * 3 + 1] = cy + lx * Math.sin(angle) + ly * Math.cos(angle);
    out[i * 3 + 2] = lz;
  }
  return out;
}

/** Curved gum sheet below and buccal to the crowns. */
function gingiva(random: () => number, count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = -17 + 34 * random();
    const z = -11 + 7 * random();
    out[i * 3] = x;
    out[i * 3 + 1] = archY(x) + 3.5 + 0.08 * (z + 11) ** 2;
    out[i * 3 + 2] = z;
  }
  return out;
}

function randomPose(random: () => number): Float64Array {
  // Uniform random rotation (Shoemake) and translation up to 50 mm.
  const u1 = random(),
    u2 = random(),
    u3 = random();
  const a = Math.sqrt(1 - u1),
    b = Math.sqrt(u1);
  const [w, x, y, z] = [
    a * Math.sin(2 * Math.PI * u2),
    a * Math.cos(2 * Math.PI * u2),
    b * Math.sin(2 * Math.PI * u3),
    b * Math.cos(2 * Math.PI * u3),
  ];
  const t = [0, 0, 0].map(() => (2 * random() - 1) * 29);
  // prettier-ignore
  return Float64Array.of(
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), t[0],
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), t[1],
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y), t[2],
    0, 0, 0, 1,
  );
}

function multiply(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++) out[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  return out;
}

/** Rotation angle (degrees) of a rigid 4×4 matrix. */
function rotationDegrees(m: Float64Array): number {
  const c = (m[0] + m[5] + m[10] - 1) / 2;
  return (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI;
}

describe('registerRigid', () => {
  // [seed, gingiva share, resample the moving surface independently]
  it.each([
    [1, 0.3, false],
    [2, 0.3, false],
    [3, 0.3, false],
    [4, 0.3, false],
    [5, 0.3, true],
    [6, 0.3, true],
    [7, 0.5, false],
    [8, 0.5, true],
  ] as const)(
    'recovers an arbitrary pose despite noise, holes and gingiva (seed %i, gingiva %f, resampled %s)',
    (seed, gumShare, resample) => {
      const random = mulberry32(seed * 7919);
      const fixed = archCrowns(random, 9000);
      const source = resample ? archCrowns(random, 9000) : fixed;
      const truth = randomPose(random);
      // Keep 80% of points, add noise, then gingiva with no counterpart.
      const kept: number[] = [];
      const clean: number[] = [];
      for (let i = 0; i < source.length / 3; i++) {
        if (random() < 0.2) continue;
        const p = source.subarray(i * 3, i * 3 + 3);
        clean.push(...p);
        kept.push(...Array.from(p, (v) => v + 0.05 * gaussian(random)));
      }
      const gum = gingiva(random, Math.round(gumShare * (kept.length / 3)));
      const moving = applyMatrix(Float32Array.from([...kept, ...gum]), truth);
      const result = registerRigid(moving, fixed);
      const residual = multiply(result.matrix, truth);
      expect(rotationDegrees(residual)).toBeLessThan(1);
      const mapped = applyMatrix(Float32Array.from(clean), residual);
      let sum = 0;
      for (let i = 0; i < clean.length; i++) sum += (mapped[i] - clean[i]) ** 2;
      const rms = Math.sqrt(sum / (clean.length / 3));
      expect(rms).toBeLessThan(0.15);
      expect(result.rms).toBeLessThan(0.2);
      expect(result.inlierRatio).toBeGreaterThan(0.5);
    },
  );

  it('fits a rigid transform to landmark pairs', () => {
    const truth = randomPose(mulberry32(5));
    const picked = Float32Array.of(0, 0, 0, 10, 0, 0, 0, 8, 0, 3, 3, 6);
    const m = rigidFromPairs(picked, applyMatrix(picked, truth));
    for (let i = 0; i < 12; i++) expect(m[i]).toBeCloseTo(truth[i], 4);
  });

  it('refines from an initial pose', () => {
    const random = mulberry32(99);
    const fixed = archCrowns(random, 6000);
    const shift = Float64Array.of(
      1,
      0,
      0,
      0.8,
      0,
      1,
      0,
      -0.5,
      0,
      0,
      1,
      0.3,
      0,
      0,
      0,
      1,
    );
    const moving = applyMatrix(fixed, shift);
    const result = registerRigid(moving, fixed, {
      initial: Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1),
      trim: 1,
    });
    expect(result.matrix[3]).toBeCloseTo(-0.8, 3);
    expect(result.matrix[7]).toBeCloseTo(0.5, 3);
    expect(result.matrix[11]).toBeCloseTo(-0.3, 3);
    expect(result.rms).toBeLessThan(1e-3);
  });
});

describe('cropMeshNear and surfaceDeviation', () => {
  it('keeps only triangles near the targets and reindexes them', () => {
    const a = box();
    const far = box();
    const positions = new Float32Array(48);
    positions.set(a.positions);
    positions.set(
      far.positions.map((v, i) => (i % 3 === 0 ? v + 20 : v)),
      24,
    );
    const indices = new Uint32Array(72);
    indices.set(a.indices);
    indices.set(
      far.indices.map((i) => i + 8),
      36,
    );
    const cropped = cropMeshNear(
      { positions, indices },
      Float32Array.of(20.5, 0.5, 0.5),
      1,
    );
    expect(cropped.positions.length).toBe(24);
    expect(cropped.indices.length).toBe(36);
    expect(Math.min(...cropped.positions.filter((_, i) => i % 3 === 0))).toBe(
      20,
    );
    expect(Math.max(...cropped.indices)).toBe(7);
  });

  it('measures nearest-point distances', () => {
    const a = Float32Array.of(0, 0, 0, 0, 0, 1, 0, 0, 3);
    const b = Float32Array.of(0, 0, 0);
    const d = surfaceDeviation(a, b);
    expect(d.mean).toBeCloseTo(4 / 3);
    expect(d.max).toBe(3);
    expect(d.p95).toBe(3);
  });
});

describe('crownSurfacePoints', () => {
  it('returns boundary voxels of the selected labels in mm', () => {
    const shape: [number, number, number] = [5, 5, 5];
    const labels = new Uint16Array(125);
    // 3×3×3 block of label 7 in the middle, one stray voxel of label 9.
    for (let z = 1; z < 4; z++)
      for (let y = 1; y < 4; y++)
        for (let x = 1; x < 4; x++) labels[z * 25 + y * 5 + x] = 7;
    labels[0] = 9;
    const pts = crownSurfacePoints(
      labels,
      shape,
      [10, 0, 0],
      [0.5, 0.5, 0.5],
      new Set([7]),
    );
    expect(pts.length / 3).toBe(26); // all but the centre voxel
    expect(Math.min(...pts.filter((_, i) => i % 3 === 0))).toBe(5.5);
    // Dropping the bottom layer leaves the cut open: no new surface voxels.
    const crown = crownSurfacePoints(
      labels,
      shape,
      [0, 0, 0],
      [1, 1, 1],
      new Set([7]),
      (z) => z >= 2,
    );
    expect(crown.length / 3).toBe(17);
  });
});
