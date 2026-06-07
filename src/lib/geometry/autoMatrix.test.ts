import { describe, expect, it } from 'vitest';
import {
  applyMatrixToLandmarks,
  resampleLabelmapWithMatrix,
  resampleVolumeWithMatrix,
  voxelToWorldMatrix,
  worldToVoxelMatrix,
} from './autoMatrix';
import { fromRotationTranslation, type Mat4 } from './transformMatrix';
import { rodrigues } from './rigidAlignment';
import type { Landmark } from '../io/slicerMarkups';

describe('autoMatrix', () => {
  it('applies an affine to landmarks, preserving metadata', () => {
    const landmarks: Landmark[] = [
      { label: 'N', position: [1, 2, 3], id: 'a', description: 'nasion' },
    ];
    // Translate by (10, 20, 30).
    const m: Mat4 = [1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30, 0, 0, 0, 1];
    const out = applyMatrixToLandmarks(landmarks, m);
    expect(out[0].position).toEqual([11, 22, 33]);
    expect(out[0].label).toBe('N');
    expect(out[0].id).toBe('a');
    expect(out[0].description).toBe('nasion');
    // Input is not mutated.
    expect(landmarks[0].position).toEqual([1, 2, 3]);
  });

  it('converts a world transform to voxel space via spacing conjugation', () => {
    // Pure translation of 4mm along x, with 2mm spacing in x → 2 voxels.
    const worldT: Mat4 = [1, 0, 0, 4, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const voxelT = worldToVoxelMatrix(worldT, [2, 1, 1]);
    expect(voxelT[3]).toBeCloseTo(2, 10);
  });

  it('voxelToWorldMatrix maps indices to millimetres', () => {
    const w = voxelToWorldMatrix([0.5, 0.5, 1], [10, 20, 30]);
    // voxel (2, 2, 2) → world (10 + 1, 20 + 1, 30 + 2)
    const x = w[0] * 2 + w[3];
    const y = w[5] * 2 + w[7];
    const z = w[10] * 2 + w[11];
    expect([x, y, z]).toEqual([11, 21, 32]);
  });

  it('identity transform reproduces the input volume', () => {
    const dims: [number, number, number] = [2, 2, 2];
    const data = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const identity: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const out = resampleVolumeWithMatrix(data, dims, identity);
    expect([...out.data]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('translates volume content by an integer voxel shift', () => {
    // 1x1x4 row along x: shift content +1 voxel in x; samples off-grid → fill.
    const dims: [number, number, number] = [1, 1, 4];
    const data = new Float32Array([10, 20, 30, 40]);
    // matrix maps source→output: x' = x + 1.
    const shift: Mat4 = [1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const out = resampleVolumeWithMatrix(data, dims, shift, { fill: -1 });
    // Output voxel x picks source x-1: [fill, 10, 20, 30].
    expect([...out.data]).toEqual([-1, 10, 20, 30]);
  });

  it('round-trips a rotation (rotate then rotate back ≈ identity)', () => {
    const dims: [number, number, number] = [1, 8, 8];
    const data = new Float32Array(64);
    for (let i = 0; i < 64; i += 1) data[i] = i;
    // Rotate 37° about z (the in-plane axis for a single z-slice).
    const r = rodrigues([0, 0, 1], (37 * Math.PI) / 180);
    // Rotate about the grid centre to stay in-bounds.
    const cx = 3.5;
    const cy = 3.5;
    const tx = cx - (r[0][0] * cx + r[0][1] * cy);
    const ty = cy - (r[1][0] * cx + r[1][1] * cy);
    const fwd = fromRotationTranslation(r, [tx, ty, 0]);
    const rotated = resampleVolumeWithMatrix(data, dims, fwd);
    const rInv = rodrigues([0, 0, 1], (-37 * Math.PI) / 180);
    const txi = cx - (rInv[0][0] * cx + rInv[0][1] * cy);
    const tyi = cy - (rInv[1][0] * cx + rInv[1][1] * cy);
    const back = resampleVolumeWithMatrix(
      rotated.data,
      dims,
      fromRotationTranslation(rInv, [txi, tyi, 0]),
    );
    // Interior voxels should closely match the original after the round-trip.
    let maxErr = 0;
    for (let y = 2; y < 6; y += 1) {
      for (let x = 2; x < 6; x += 1) {
        const idx = y * 8 + x;
        maxErr = Math.max(maxErr, Math.abs(back.data[idx] - data[idx]));
      }
    }
    expect(maxErr).toBeLessThan(6);
  });

  it('labelmap resample preserves integer values and array type', () => {
    const dims: [number, number, number] = [1, 1, 4];
    const labels = new Uint16Array([0, 5, 9, 0]);
    const shift: Mat4 = [1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const out = resampleLabelmapWithMatrix(labels, dims, shift);
    expect(out.data).toBeInstanceOf(Uint16Array);
    expect([...out.data]).toEqual([0, 0, 5, 9]);
  });

  it('throws on a singular transform', () => {
    const dims: [number, number, number] = [1, 1, 2];
    const data = new Float32Array([1, 2]);
    const singular: Mat4 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
    expect(() => resampleVolumeWithMatrix(data, dims, singular)).toThrow();
  });
});
