import { describe, expect, it } from 'vitest';
import type { ParsedVolumeMeta } from '../../types';
import { archAxesFromMeta, assignFdiToItems } from './toothFdi';
import type { SegmentationItem } from './types';

/** Minimal SegmentationItem with a centroid at full-volume voxel [z, y, x]. */
function item(x: number, y: number, z: number): SegmentationItem {
  return {
    label: 0,
    name: 'tooth',
    preview: '',
    stl: '',
    assignedVoxels: 1000,
    centroidZYX: [z, y, x],
    bboxZYX: [0, 0, 0, 1, 1, 1],
    extentZYX: [1, 1, 1],
  };
}

const HALF_ARCH: Array<[number, number]> = [
  [3, 12],
  [6, 11],
  [9, 9],
  [11, 6],
  [12.5, 3],
  [13.5, -1],
  [14, -5],
  [14, -9],
];

describe('assignFdiToItems', () => {
  it('numbers a single-jaw arch from item centroids', () => {
    const items: SegmentationItem[] = [];
    for (const [x, y] of HALF_ARCH) items.push(item(x, y, 5)); // left
    for (const [x, y] of HALF_ARCH) items.push(item(-x, y, 5)); // right

    const numbered = assignFdiToItems(items, {
      jaw: 'upper',
      leftAxis: [1, 0, 0],
      anteriorAxis: [0, 1, 0],
    });

    expect(numbered[0].fdi).toBe(21); // left central incisor
    expect(numbered[7].fdi).toBe(28); // left third molar
    expect(numbered[8].fdi).toBe(11); // right central incisor
    expect(numbered[15].fdi).toBe(18); // right third molar
    expect(numbered[0].fdiName).toBe('Upper Left Central Incisor');
    // Original items are not mutated.
    expect(items[0].fdi).toBeUndefined();
  });

  it("splits 'both' jaws by the superior axis", () => {
    // Upper teeth at z=20, lower teeth at z=0; superior axis = +z.
    const items = [
      item(3, 12, 20),
      item(-3, 12, 20),
      item(3, 12, 0),
      item(-3, 12, 0),
    ];
    const numbered = assignFdiToItems(items, {
      jaw: 'both',
      leftAxis: [1, 0, 0],
      anteriorAxis: [0, 1, 0],
      superiorAxis: [0, 0, 1],
    });
    expect(numbered[0].quadrant).toBe(2); // upper left
    expect(numbered[1].quadrant).toBe(1); // upper right
    expect(numbered[2].quadrant).toBe(3); // lower left
    expect(numbered[3].quadrant).toBe(4); // lower right
  });

  it('returns input unchanged when empty', () => {
    expect(assignFdiToItems([], { jaw: 'both' })).toEqual([]);
  });

  it('numbers incisor→molar with the LPS-canonical default axes (anterior = −y)', () => {
    // LPS-canonical: +y = posterior, so incisors sit at LOW y, molars at HIGH y.
    const half: Array<[number, number]> = [
      [3, -12],
      [6, -11],
      [9, -9],
      [11, -6],
      [12.5, -3],
      [13.5, 1],
      [14, 5],
      [14, 9],
    ];
    const items: SegmentationItem[] = [];
    for (const [x, y] of half) items.push(item(x, y, 5)); // left
    for (const [x, y] of half) items.push(item(-x, y, 5)); // right

    // No explicit axes → uses the LPS-canonical default. The OLD buggy default
    // (anterior = +y) would label the incisor as a molar.
    const numbered = assignFdiToItems(items, { jaw: 'upper' });
    expect(numbered[0].fdi).toBe(21); // left central incisor (anterior, low y)
    expect(numbered[7].fdi).toBe(28); // left third molar (posterior, high y)
    expect(numbered[8].fdi).toBe(11); // right central incisor
  });
});

describe('archAxesFromMeta', () => {
  it('defaults to LPS-canonical axes (anterior = −y)', () => {
    const axes = archAxesFromMeta();
    expect(axes.leftAxis).toEqual([1, 0, 0]);
    expect(axes.anteriorAxis).toEqual([0, -1, 0]);
    expect(axes.superiorAxis).toEqual([0, 0, 1]);
  });

  it('uses meta.patientAxes when present', () => {
    const meta = {
      patientAxes: {
        left: [0, 1, 0] as [number, number, number],
        anterior: [0, 0, 1] as [number, number, number],
        superior: [1, 0, 0] as [number, number, number],
      },
    } as ParsedVolumeMeta;
    const axes = archAxesFromMeta(meta);
    expect(axes.leftAxis).toEqual([0, 1, 0]);
    expect(axes.anteriorAxis).toEqual([0, 0, 1]);
    expect(axes.superiorAxis).toEqual([1, 0, 0]);
  });
});
