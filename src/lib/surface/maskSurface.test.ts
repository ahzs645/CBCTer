import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../types';
import { maskToBinaryStl } from '../segmentation/maskMesh';
import { maskToSurface, orientMesh } from './maskSurface';
import { orientStl } from '../case/archModel';
import { indexedToStl } from './simplifyClosed';
import { stlToIndexed, type IndexedMesh } from './simplifyClosed';

const SPACING: Vec3 = [0.2, 0.25, 0.3];

/** A ball with a tunnel and a separate small cube: two closed shells. */
function phantom(): { mask: Uint8Array; shape: Vec3 } {
  const shape: Vec3 = [30, 28, 26];
  const mask = new Uint8Array(shape[0] * shape[1] * shape[2]);
  for (let z = 0; z < shape[2]; z++)
    for (let y = 0; y < shape[1]; y++)
      for (let x = 0; x < shape[0]; x++) {
        const ball = (x - 12) ** 2 + (y - 13) ** 2 + (z - 12) ** 2 <= 81;
        const tunnel = (x - 12) ** 2 + (y - 13) ** 2 <= 4;
        const cube = x >= 24 && x <= 27 && y >= 3 && y <= 6 && z >= 3 && z <= 6;
        mask[(z * shape[1] + y) * shape[0] + x] =
          (ball && !tunnel) || cube ? 1 : 0;
      }
  return { mask, shape };
}

function stats(mesh: IndexedMesh) {
  const p = mesh.positions,
    f = mesh.indices;
  let volume = 0,
    area = 0;
  const edges = new Map<string, number>();
  for (let i = 0; i < f.length; i += 3) {
    const a = [p[f[i] * 3], p[f[i] * 3 + 1], p[f[i] * 3 + 2]];
    const b = [p[f[i + 1] * 3], p[f[i + 1] * 3 + 1], p[f[i + 1] * 3 + 2]];
    const c = [p[f[i + 2] * 3], p[f[i + 2] * 3 + 1], p[f[i + 2] * 3 + 2]];
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    area +=
      Math.hypot(
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ) / 2;
    for (const [x, y] of [
      [f[i], f[i + 1]],
      [f[i + 1], f[i + 2]],
      [f[i + 2], f[i]],
    ]) {
      const key = x < y ? `${x},${y}` : `${y},${x}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  const counts = [...edges.values()];
  return {
    triangles: f.length / 3,
    volume: Math.abs(volume),
    area,
    open: counts.filter((n) => n !== 2).length,
  };
}

describe('maskToSurface', () => {
  for (const smooth of [0, 6]) {
    it(`matches the reference mesher (smoothing ${smooth})`, async () => {
      const { mask, shape } = phantom();
      const origin: Vec3 = [5, 7, 9];
      const fast = stats(maskToSurface(mask, shape, SPACING, origin, smooth));
      const reference = stats(
        stlToIndexed(
          new Uint8Array(
            await maskToBinaryStl(
              mask,
              [shape[2], shape[1], shape[0]],
              SPACING,
              origin,
              1,
              {
                extraction: 'iso',
                smoothIterations: smooth,
                decimateReduction: 0,
              },
            ).arrayBuffer(),
          ),
        ),
      );
      expect(fast.triangles).toBe(reference.triangles);
      expect(fast.open).toBe(0);
      expect(fast.volume).toBeCloseTo(reference.volume, 3);
      expect(fast.area).toBeCloseTo(reference.area, 3);
    });
  }

  it('orients every shell outward, like orientStl', () => {
    const { mask, shape } = phantom();
    const mesh = maskToSurface(mask, shape, SPACING, [0, 0, 0], 4);
    // Scramble the winding of every other triangle first.
    for (let t = 0; t < mesh.indices.length / 3; t += 2) {
      const tmp = mesh.indices[t * 3 + 1];
      mesh.indices[t * 3 + 1] = mesh.indices[t * 3 + 2];
      mesh.indices[t * 3 + 2] = tmp;
    }
    const reference = stats(stlToIndexed(orientStl(indexedToStl(mesh))));
    orientMesh(mesh);
    const oriented = stats(mesh);
    expect(oriented.volume).toBeCloseTo(reference.volume, 3);
    // Signed volume is positive (outward) once oriented.
    let signed = 0;
    const p = mesh.positions,
      f = mesh.indices;
    for (let i = 0; i < f.length; i += 3) {
      const [a, b, c] = [f[i] * 3, f[i + 1] * 3, f[i + 2] * 3];
      signed +=
        p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) +
        p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
    }
    expect(signed / 6).toBeCloseTo(reference.volume, 3);
  });

  it('places vertices in the scan frame', () => {
    const shape: Vec3 = [3, 3, 3];
    const mask = new Uint8Array(27);
    mask[13] = 1; // the centre voxel
    const mesh = maskToSurface(mask, shape, [1, 2, 3], [10, 0, 0]);
    const xs = [];
    for (let i = 0; i < mesh.positions.length; i += 3)
      xs.push(mesh.positions[i]);
    // Vertices sit half a voxel from the centre voxel (x = 11).
    expect(Math.min(...xs)).toBeCloseTo(10.5);
    expect(Math.max(...xs)).toBeCloseTo(11.5);
  });
});
