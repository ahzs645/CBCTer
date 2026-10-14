import { describe, expect, it } from 'vitest';
import {
  addedTeethRegion,
  editsFromLinkParams,
  editsToLinkParams,
  hasEdits,
} from './caseEdits';

describe('case edits', () => {
  it('round-trips the numbering swap and merges through link params', () => {
    const params = editsToLinkParams({
      swapSides: true,
      mergedPairs: [
        ['inst-4', 'inst-9'],
        ['a', 'b'],
      ],
    });
    expect(params).toEqual({ swap: '1', merge: 'inst-4~inst-9,a~b' });
    const back = editsFromLinkParams(new URLSearchParams(params));
    expect(back).toEqual({
      swapSides: true,
      mergedPairs: [
        ['inst-4', 'inst-9'],
        ['a', 'b'],
      ],
    });
  });

  it('ignores malformed merge lists', () => {
    expect(
      editsFromLinkParams(new URLSearchParams('merge=a~b,c,~d,e~f')),
    ).toEqual({
      mergedPairs: [
        ['a', 'b'],
        ['e', 'f'],
      ],
    });
  });

  it('knows when there is nothing to keep', () => {
    expect(hasEdits({})).toBe(false);
    expect(hasEdits({ mergedPairs: [] })).toBe(false);
    expect(hasEdits({ swapSides: true })).toBe(true);
  });
});

describe('addedTeethRegion', () => {
  it('places each added tooth with its own value, clipped to the box', () => {
    const tooth = {
      id: 'a',
      fdi: 31,
      start: [2, 2, 2] as [number, number, number],
      shape: [2, 2, 2] as [number, number, number],
      runs: [0, 8],
      voxels: 8,
      centroid: [3, 3, 3] as [number, number, number],
      bounds: { min: [2, 2, 2], max: [3, 3, 3] } as {
        min: [number, number, number];
        max: [number, number, number];
      },
    };
    const masks = new Map([['a', new Uint8Array(8).fill(1)]]);
    const region = addedTeethRegion(
      [tooth, { ...tooth, id: 'b' }],
      masks,
      [3, 3, 3],
      [3, 3, 3],
    );
    // Only voxel (3,3,3) of the 2×2×2 tooth falls in the box, at local (0,0,0).
    expect(region[0]).toBe(1);
    expect(region.reduce((n, v) => n + (v ? 1 : 0), 0)).toBe(1);
  });
});
