import { describe, expect, it } from 'vitest';
import type { LoadedVolume } from '../../types';
import { FACE_SOFT_TISSUE_HU, softTissueMask } from './faceSurface';

function makeVolume(
  dimensions: [number, number, number],
  voxels: Int16Array,
): LoadedVolume {
  return { meta: { dimensions }, voxels } as unknown as LoadedVolume;
}

describe('softTissueMask', () => {
  it('keeps voxels denser than air and drops air', () => {
    const { mask, dims } = softTissueMask(
      makeVolume([2, 1, 1], Int16Array.from([-1000, 0])),
    );
    expect(Array.from(mask)).toEqual([0, 1]);
    // dims are emitted z-major [depth, height, width] from meta [w, h, d]
    expect(dims).toEqual([1, 1, 2]);
  });

  it('treats the cutoff as inclusive of soft tissue, exclusive of air', () => {
    const { mask } = softTissueMask(
      makeVolume(
        [3, 1, 1],
        Int16Array.from([
          FACE_SOFT_TISSUE_HU - 1,
          FACE_SOFT_TISSUE_HU,
          FACE_SOFT_TISSUE_HU + 1,
        ]),
      ),
    );
    expect(Array.from(mask)).toEqual([0, 1, 1]);
  });
});
