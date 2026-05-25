import type { Vec3 } from '../../types';

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
 */
export function maskToBinaryStl(
  mask: Uint8Array,
  dims: [number, number, number],
  spacing: Vec3,
  origin: Vec3 = [0, 0, 0],
): Blob {
  const [cd, ch, cw] = dims;
  const [sx, sy, sz] = spacing;
  const [ox, oy, oz] = origin;
  const at = (z: number, y: number, x: number) => {
    if (z < 0 || y < 0 || x < 0 || z >= cd || y >= ch || x >= cw) return 0;
    return mask[(z * ch + y) * cw + x];
  };

  // Each exposed face becomes two triangles. Faces: ±x, ±y, ±z.
  const triangles: number[][] = []; // [nx,ny,nz, ax,ay,az, bx,by,bz, cx,cy,cz]
  const quad = (
    n: Vec3,
    p0: Vec3,
    p1: Vec3,
    p2: Vec3,
    p3: Vec3,
  ) => {
    triangles.push([...n, ...p0, ...p1, ...p2]);
    triangles.push([...n, ...p0, ...p2, ...p3]);
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
