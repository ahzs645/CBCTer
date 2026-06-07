import { describe, expect, it } from 'vitest';
import {
  cropVolume,
  cropVolumePhysical,
  embedCrop,
  physicalRoiToVoxel,
} from './autoCrop3d';
import type { Vec3 } from '../../types';

describe('autoCrop3d', () => {
  it('converts a physical-mm ROI to a clamped, voxel-aligned box', () => {
    const dims: Vec3 = [10, 10, 10];
    const spacing: Vec3 = [0.5, 0.5, 0.5];
    // 1mm..3mm in every axis with 0.5mm spacing → voxels 2..6.
    const roi = physicalRoiToVoxel(
      { minMm: [1, 1, 1], maxMm: [3, 3, 3] },
      dims,
      spacing,
    );
    expect(roi.min).toEqual([2, 2, 2]);
    expect(roi.max).toEqual([6, 6, 6]);
  });

  it('honours a non-zero origin and clamps to the grid', () => {
    const dims: Vec3 = [4, 4, 4];
    const spacing: Vec3 = [1, 1, 1];
    const origin: Vec3 = [10, 10, 10];
    // Request beyond the grid: should clamp to [0..4).
    const roi = physicalRoiToVoxel(
      { minMm: [9, 11, 12], maxMm: [100, 100, 100] },
      dims,
      spacing,
      origin,
    );
    // x: (9-10)/1 = -1 → floor -1 → clamp 0; y: 1; z: 2.
    expect(roi.min).toEqual([0, 1, 2]);
    expect(roi.max).toEqual([4, 4, 4]);
  });

  it('crops a sub-volume and shifts the origin', () => {
    // 4x1x1 row (width=4): values 0..3.
    const dims: Vec3 = [4, 1, 1];
    const data = new Int16Array([0, 1, 2, 3]);
    const out = cropVolume(
      data,
      dims,
      { min: [1, 0, 0], max: [3, 1, 1] },
      [0.5, 0.5, 0.5],
      [10, 10, 10],
    );
    expect(out.data).toBeInstanceOf(Int16Array);
    expect([...out.data]).toEqual([1, 2]);
    expect(out.dimensions).toEqual([2, 1, 1]);
    // origin shifts by 1 voxel * 0.5mm in x only.
    expect(out.origin).toEqual([10.5, 10, 10]);
  });

  it('crops a 3D block in [z, y, x] order', () => {
    // 2x2x2 volume, values 0..7 laid out [z, y, x].
    const dims: Vec3 = [2, 2, 2];
    const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    // Take x in [1,2), all y, all z → picks x=1 column: indices 1,3,5,7.
    const out = cropVolume(data, dims, { min: [1, 0, 0], max: [2, 2, 2] }, [1, 1, 1]);
    expect(out.dimensions).toEqual([1, 2, 2]);
    expect([...out.data]).toEqual([1, 3, 5, 7]);
  });

  it('cropVolumePhysical matches the two-step path', () => {
    const dims: Vec3 = [4, 1, 1];
    const data = new Int16Array([0, 1, 2, 3]);
    const out = cropVolumePhysical(
      data,
      dims,
      { minMm: [1, 0, 0], maxMm: [2, 1, 1] },
      [1, 1, 1],
    );
    expect([...out.data]).toEqual([1]);
    expect(out.dimensions).toEqual([1, 1, 1]);
  });

  it('embedCrop is the inverse of cropVolume for the ROI region', () => {
    const fullDims: Vec3 = [4, 1, 1];
    const data = new Int16Array([0, 1, 2, 3]);
    const roi = { min: [1, 0, 0] as Vec3, max: [3, 1, 1] as Vec3 };
    const crop = cropVolume(data, fullDims, roi, [1, 1, 1]);
    const back = embedCrop(crop.data, crop.dimensions, fullDims, roi, -1);
    expect([...back]).toEqual([-1, 1, 2, -1]);
  });

  it('embedCrop clips a crop that would overflow the full grid', () => {
    const fullDims: Vec3 = [3, 1, 1];
    const crop = new Uint8Array([7, 8, 9]);
    // ROI starts at x=2 but crop is 3 wide → only first voxel fits.
    const back = embedCrop(crop, [3, 1, 1], fullDims, {
      min: [2, 0, 0],
      max: [5, 1, 1],
    });
    expect([...back]).toEqual([0, 0, 7]);
  });
});
