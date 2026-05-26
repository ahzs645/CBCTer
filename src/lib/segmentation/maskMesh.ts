import type { Vec3 } from '../../types';

type SurfaceTriangle = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface MaskMeshOptions {
  extraction?: 'voxel' | 'iso';
  smoothIterations?: number;
  decimateReduction?: number;
}

/** Downsample a binary mask by `stride`; a coarse cell is set if any fine
 * voxel in its stride³ block is set. */
function downsampleMask(
  mask: Uint8Array,
  dims: [number, number, number],
  stride: number,
): { mask: Uint8Array; dims: [number, number, number] } {
  const [cd, ch, cw] = dims;
  const dd = Math.ceil(cd / stride);
  const dh = Math.ceil(ch / stride);
  const dw = Math.ceil(cw / stride);
  const out = new Uint8Array(dd * dh * dw);
  for (let z = 0; z < cd; z += 1) {
    for (let y = 0; y < ch; y += 1) {
      const row = (z * ch + y) * cw;
      for (let x = 0; x < cw; x += 1) {
        if (!mask[row + x]) continue;
        const oz = Math.floor(z / stride);
        const oy = Math.floor(y / stride);
        const ox = Math.floor(x / stride);
        out[(oz * dh + oy) * dw + ox] = 1;
      }
    }
  }
  return { mask: out, dims: [dd, dh, dw] };
}

function triangleNormal(triangle: SurfaceTriangle): Vec3 {
  const ab: Vec3 = [
    triangle[6] - triangle[3],
    triangle[7] - triangle[4],
    triangle[8] - triangle[5],
  ];
  const ac: Vec3 = [
    triangle[9] - triangle[3],
    triangle[10] - triangle[4],
    triangle[11] - triangle[5],
  ];
  const normal: Vec3 = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  return [normal[0] / length, normal[1] / length, normal[2] / length];
}

function vertexKey(x: number, y: number, z: number): string {
  return `${x.toFixed(5)}|${y.toFixed(5)}|${z.toFixed(5)}`;
}

function processTriangles(
  input: SurfaceTriangle[],
  options: MaskMeshOptions = {},
): SurfaceTriangle[] {
  const decimateReduction = Math.min(
    0.95,
    Math.max(0, options.decimateReduction ?? 0),
  );
  const keepEvery =
    decimateReduction > 0 ? Math.max(1, Math.round(1 / (1 - decimateReduction))) : 1;
  const decimated =
    keepEvery <= 1
      ? input
      : input.filter((_, index) => index % keepEvery === 0);

  const smoothIterations = Math.max(
    0,
    Math.min(24, Math.round(options.smoothIterations ?? 0)),
  );
  if (smoothIterations === 0 || decimated.length === 0) return decimated;

  const vertices: Vec3[] = [];
  const vertexIds = new Map<string, number>();
  const faces: Array<[number, number, number]> = [];
  const getVertexId = (x: number, y: number, z: number) => {
    const key = vertexKey(x, y, z);
    const existing = vertexIds.get(key);
    if (existing !== undefined) return existing;
    const next = vertices.length;
    vertices.push([x, y, z]);
    vertexIds.set(key, next);
    return next;
  };

  for (const triangle of decimated) {
    faces.push([
      getVertexId(triangle[3], triangle[4], triangle[5]),
      getVertexId(triangle[6], triangle[7], triangle[8]),
      getVertexId(triangle[9], triangle[10], triangle[11]),
    ]);
  }

  const neighbors = vertices.map(() => new Set<number>());
  for (const [a, b, c] of faces) {
    neighbors[a].add(b).add(c);
    neighbors[b].add(a).add(c);
    neighbors[c].add(a).add(b);
  }

  let current = vertices.map((vertex) => [...vertex] as Vec3);
  for (let iteration = 0; iteration < smoothIterations; iteration += 1) {
    const next = current.map((vertex) => [...vertex] as Vec3);
    for (let index = 0; index < current.length; index += 1) {
      const linked = [...neighbors[index]];
      if (linked.length < 3) continue;
      const centroid: Vec3 = [0, 0, 0];
      for (const neighbor of linked) {
        centroid[0] += current[neighbor][0];
        centroid[1] += current[neighbor][1];
        centroid[2] += current[neighbor][2];
      }
      centroid[0] /= linked.length;
      centroid[1] /= linked.length;
      centroid[2] /= linked.length;
      next[index] = [
        current[index][0] + (centroid[0] - current[index][0]) * 0.35,
        current[index][1] + (centroid[1] - current[index][1]) * 0.35,
        current[index][2] + (centroid[2] - current[index][2]) * 0.35,
      ];
    }
    current = next;
  }

  return faces.map(([a, b, c]) => {
    const triangle = [
      0,
      0,
      0,
      ...current[a],
      ...current[b],
      ...current[c],
    ] as SurfaceTriangle;
    const normal = triangleNormal(triangle);
    triangle[0] = normal[0];
    triangle[1] = normal[1];
    triangle[2] = normal[2];
    return triangle;
  });
}

function collectMaskSurfaceTriangles(
  mask: Uint8Array,
  dims: [number, number, number],
  spacing: Vec3,
  origin: Vec3 = [0, 0, 0],
): SurfaceTriangle[] {
  const [cd, ch, cw] = dims;
  const [sx, sy, sz] = spacing;
  const [ox, oy, oz] = origin;
  const at = (z: number, y: number, x: number) => {
    if (z < 0 || y < 0 || x < 0 || z >= cd || y >= ch || x >= cw) return 0;
    return mask[(z * ch + y) * cw + x];
  };

  // Each exposed face becomes two triangles. Faces: ±x, ±y, ±z.
  const triangles: SurfaceTriangle[] = [];
  const quad = (
    n: Vec3,
    p0: Vec3,
    p1: Vec3,
    p2: Vec3,
    p3: Vec3,
  ) => {
    triangles.push([...n, ...p0, ...p1, ...p2] as SurfaceTriangle);
    triangles.push([...n, ...p0, ...p2, ...p3] as SurfaceTriangle);
  };

  for (let z = 0; z < cd; z += 1) {
    for (let y = 0; y < ch; y += 1) {
      for (let x = 0; x < cw; x += 1) {
        if (!at(z, y, x)) continue;
        const x0 = (x + ox) * sx;
        const x1 = (x + 1 + ox) * sx;
        const y0 = (y + oy) * sy;
        const y1 = (y + 1 + oy) * sy;
        const z0 = (z + oz) * sz;
        const z1 = (z + 1 + oz) * sz;

        if (!at(z, y, x - 1))
          quad([-1, 0, 0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
        if (!at(z, y, x + 1))
          quad([1, 0, 0], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
        if (!at(z, y - 1, x))
          quad([0, -1, 0], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
        if (!at(z, y + 1, x))
          quad([0, 1, 0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
        if (!at(z - 1, y, x))
          quad([0, 0, -1], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
        if (!at(z + 1, y, x))
          quad([0, 0, 1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
      }
    }
  }
  return triangles;
}

function interpolateIsoVertex(a: Vec3, b: Vec3, av: number, bv: number): Vec3 {
  const t = av === bv ? 0.5 : (0.5 - av) / (bv - av);
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function appendIsoTriangle(
  triangles: SurfaceTriangle[],
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
): void {
  const triangle = [0, 0, 0, ...p0, ...p1, ...p2] as SurfaceTriangle;
  const normal = triangleNormal(triangle);
  triangle[0] = normal[0];
  triangle[1] = normal[1];
  triangle[2] = normal[2];
  triangles.push(triangle);
}

function collectMarchingTetrahedraTriangles(
  mask: Uint8Array,
  dims: [number, number, number],
  spacing: Vec3,
  origin: Vec3 = [0, 0, 0],
): SurfaceTriangle[] {
  const [depth, height, width] = dims;
  const [sx, sy, sz] = spacing;
  const [ox, oy, oz] = origin;
  const cubeOffsets: Array<[number, number, number]> = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const tetrahedra: Array<[number, number, number, number]> = [
    [0, 5, 1, 6],
    [0, 1, 2, 6],
    [0, 2, 3, 6],
    [0, 3, 7, 6],
    [0, 7, 4, 6],
    [0, 4, 5, 6],
  ];
  const at = (z: number, y: number, x: number) => {
    if (z < 0 || y < 0 || x < 0 || z >= depth || y >= height || x >= width) {
      return 0;
    }
    return mask[(z * height + y) * width + x] ? 1 : 0;
  };
  const triangles: SurfaceTriangle[] = [];

  for (let z = -1; z < depth; z += 1) {
    for (let y = -1; y < height; y += 1) {
      for (let x = -1; x < width; x += 1) {
        const positions: Vec3[] = [];
        const values: number[] = [];
        for (const [dx, dy, dz] of cubeOffsets) {
          const vx = x + dx;
          const vy = y + dy;
          const vz = z + dz;
          positions.push([(vx + ox) * sx, (vy + oy) * sy, (vz + oz) * sz]);
          values.push(at(vz, vy, vx));
        }

        for (const tetrahedron of tetrahedra) {
          const inside = tetrahedron.filter((index) => values[index] >= 0.5);
          if (inside.length === 0 || inside.length === 4) continue;
          const outside = tetrahedron.filter((index) => values[index] < 0.5);
          if (inside.length === 1 || inside.length === 3) {
            const anchor = inside.length === 1 ? inside[0] : outside[0];
            const others = inside.length === 1 ? outside : inside;
            const points = others.map((index) =>
              interpolateIsoVertex(
                positions[anchor],
                positions[index],
                values[anchor],
                values[index],
              ),
            );
            if (inside.length === 1) {
              appendIsoTriangle(triangles, points[0], points[1], points[2]);
            } else {
              appendIsoTriangle(triangles, points[2], points[1], points[0]);
            }
            continue;
          }

          const [a, b] = inside;
          const [c, d] = outside;
          const ac = interpolateIsoVertex(
            positions[a],
            positions[c],
            values[a],
            values[c],
          );
          const ad = interpolateIsoVertex(
            positions[a],
            positions[d],
            values[a],
            values[d],
          );
          const bc = interpolateIsoVertex(
            positions[b],
            positions[c],
            values[b],
            values[c],
          );
          const bd = interpolateIsoVertex(
            positions[b],
            positions[d],
            values[b],
            values[d],
          );
          appendIsoTriangle(triangles, ac, bc, bd);
          appendIsoTriangle(triangles, ac, bd, ad);
        }
      }
    }
  }
  return triangles;
}

function prepareMaskForMeshing(
  mask: Uint8Array,
  dims: [number, number, number],
  spacing: Vec3,
  origin: Vec3,
  stride: number,
): {
  mask: Uint8Array;
  dims: [number, number, number];
  spacing: Vec3;
  origin: Vec3;
} {
  if (stride <= 1) return { mask, dims, spacing, origin };
  const coarse = downsampleMask(mask, dims, stride);
  return {
    mask: coarse.mask,
    dims: coarse.dims,
    spacing: [spacing[0] * stride, spacing[1] * stride, spacing[2] * stride],
    origin: [origin[0] / stride, origin[1] / stride, origin[2] / stride],
  };
}

/**
 * Build a binary STL blob from a binary mask by emitting the exposed faces
 * of foreground voxels (a "blocky" but topologically exact surface). This
 * avoids large marching-cubes tables while reusing the existing STL mesh
 * viewer to display a fully client-side segmentation result.
 *
 * @param mask   binary mask in [D, H, W] order
 * @param dims   [depth, height, width]
 * @param spacing voxel spacing in mm [x, y, z]
 * @param origin voxel offset [x, y, z] added before scaling, so a per-tooth
 *   submask can be placed at its position within a shared frame (lets several
 *   tooth meshes keep their relative arch arrangement). Defaults to no offset.
 * @param stride decimation factor (>1 builds a coarser mesh with fewer faces
 *   for large volumes); the mask is downsampled by `stride` before meshing.
 */
export function maskToBinaryStl(
  mask: Uint8Array,
  dims: [number, number, number],
  spacing: Vec3,
  origin: Vec3 = [0, 0, 0],
  stride = 1,
  options: MaskMeshOptions = {},
): Blob {
  const prepared = prepareMaskForMeshing(mask, dims, spacing, origin, stride);
  const collect =
    options.extraction === 'iso'
      ? collectMarchingTetrahedraTriangles
      : collectMaskSurfaceTriangles;
  const triangles = processTriangles(
    collect(
      prepared.mask,
      prepared.dims,
      prepared.spacing,
      prepared.origin,
    ),
    options,
  );

  const count = triangles.length;
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  view.setUint32(80, count, true);
  let offset = 84;
  for (const tri of triangles) {
    for (let i = 0; i < 12; i += 1) {
      view.setFloat32(offset, tri[i], true);
      offset += 4;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'model/stl' });
}

export function maskToAsciiPly(
  mask: Uint8Array,
  dims: [number, number, number],
  spacing: Vec3,
  origin: Vec3 = [0, 0, 0],
  stride = 1,
  options: MaskMeshOptions = {},
): Blob {
  const prepared = prepareMaskForMeshing(mask, dims, spacing, origin, stride);
  const collect =
    options.extraction === 'iso'
      ? collectMarchingTetrahedraTriangles
      : collectMaskSurfaceTriangles;
  const triangles = processTriangles(
    collect(
      prepared.mask,
      prepared.dims,
      prepared.spacing,
      prepared.origin,
    ),
    options,
  );
  const vertexCount = triangles.length * 3;
  const lines = [
    'ply',
    'format ascii 1.0',
    'comment CBCTer binary mask surface',
    `element vertex ${vertexCount}`,
    'property float x',
    'property float y',
    'property float z',
    `element face ${triangles.length}`,
    'property list uchar int vertex_indices',
    'end_header',
  ];

  for (const triangle of triangles) {
    lines.push(`${triangle[3]} ${triangle[4]} ${triangle[5]}`);
    lines.push(`${triangle[6]} ${triangle[7]} ${triangle[8]}`);
    lines.push(`${triangle[9]} ${triangle[10]} ${triangle[11]}`);
  }

  for (let index = 0; index < triangles.length; index += 1) {
    const vertex = index * 3;
    lines.push(`3 ${vertex} ${vertex + 1} ${vertex + 2}`);
  }

  return new Blob([`${lines.join('\n')}\n`], { type: 'model/ply' });
}
