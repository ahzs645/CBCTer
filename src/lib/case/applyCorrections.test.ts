import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../types';
import { applyStreamedCorrections } from './applyCorrections';
import { encodeMask } from '../dental/growTooth';
import type { ToothInstance } from './types';

const DIMS: Vec3 = [10, 10, 10];
const tooth = (id: string, value: number, fdi: number): ToothInstance => ({
  id,
  groupId: 'g',
  value,
  fdi,
  review: 'unreviewed',
  centroid: [0, 0, 0],
  bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  voxelCount: 0,
  source: 'model',
});

function grid() {
  const labels = new Uint16Array(1000);
  for (let i = 0; i < 100; i++) labels[i] = 1; // z = 0
  for (let i = 100; i < 200; i++) labels[i] = 2; // z = 1
  return labels;
}

describe('applyStreamedCorrections', () => {
  it('merges split parts into the lower-numbered tooth', () => {
    const labels = grid();
    const result = applyStreamedCorrections({
      instances: [tooth('a', 1, 42), tooth('b', 2, 41)],
      labels: { g: labels },
      dims: DIMS,
      edits: { mergedPairs: [['a', 'b']] },
    });
    expect(result.instances).toHaveLength(1);
    expect(result.instances[0].id).toBe('b');
    expect(result.instances[0].voxelCount).toBe(200);
    expect(labels[0]).toBe(1); // the input grid is not changed
    expect(result.labels.g[0]).toBe(2);
  });

  it('writes hand-added teeth with new values, never over other teeth', () => {
    const mask = new Uint8Array(2 * 2 * 3).fill(1);
    const result = applyStreamedCorrections({
      instances: [tooth('a', 1, 11), tooth('b', 2, 12)],
      labels: { g: grid() },
      dims: DIMS,
      edits: {
        addedTeeth: [
          {
            id: 'x',
            fdi: 13,
            start: [4, 4, 0],
            shape: [2, 2, 3],
            runs: encodeMask(mask),
            voxels: 12,
            centroid: [5, 5, 1],
            bounds: { min: [4, 4, 0], max: [5, 5, 2] },
          },
        ],
      },
    });
    const added = result.instances.find((t) => t.fdi === 13)!;
    expect(added.value).toBe(3);
    // z = 0 and 1 belong to other teeth; only z = 2 (4 voxels) is free.
    expect(added.voxelCount).toBe(4);
    expect(result.added).toEqual([{ groupId: 'g', value: 3, fdi: 13 }]);
  });

  it('claims voxels of label values no listed tooth uses', () => {
    const labels = grid();
    for (let i = 200; i < 300; i++) labels[i] = 9; // a leftover at z = 2
    const result = applyStreamedCorrections({
      instances: [tooth('a', 1, 11), tooth('b', 2, 12)],
      labels: { g: labels },
      dims: DIMS,
      edits: {
        addedTeeth: [
          {
            id: 'x',
            fdi: 13,
            start: [4, 4, 2],
            shape: [2, 2, 1],
            runs: encodeMask(new Uint8Array(4).fill(1)),
            voxels: 4,
            centroid: [5, 5, 2],
            bounds: { min: [4, 4, 2], max: [5, 5, 2] },
          },
        ],
      },
    });
    expect(result.instances.find((t) => t.fdi === 13)!.voxelCount).toBe(4);
    expect(result.added).toEqual([{ groupId: 'g', value: 10, fdi: 13 }]);
  });

  it('swaps left and right numbers', () => {
    const result = applyStreamedCorrections({
      instances: [tooth('a', 1, 13), tooth('b', 2, 46)],
      labels: { g: grid() },
      dims: DIMS,
      edits: { swapSides: true },
    });
    expect(result.instances.map((t) => t.fdi)).toEqual([23, 36]);
    expect(result.changedGroups).toEqual([]);
  });
});
