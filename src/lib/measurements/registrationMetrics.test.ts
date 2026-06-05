import { describe, expect, it } from 'vitest';
import type { LoadedVolume } from '../../types';
import { VolumeAxis } from '../../types';
import {
  computeDiceCoefficient,
  computeMcagpc,
  computeNcc,
  computeReferenceSlicePlane,
  computeReferenceSliceSet,
  computeSsim,
  computeVolumeMutualInformation,
  type ImagePlane,
} from './index';

function image(width: number, height: number, data: number[]): ImagePlane {
  return { width, height, data };
}

function volume(voxels: number[], dimensions: [number, number, number]): LoadedVolume {
  return {
    voxels: Int16Array.from(voxels),
    histogram: new Uint32Array(0),
    meta: {
      format: 'onevolume',
      formatLabel: 'test',
      scanId: 'test',
      dimensions,
      spacing: [1, 1, 1],
      scalarRange: [Math.min(...voxels), Math.max(...voxels)],
      initialWindowLevel: { window: 1000, level: 0 },
      sliceCount: dimensions[2],
      bytesPerVoxel: 2,
      headerFileName: 'test',
      slicePrefix: 'test',
      sliceFiles: [],
    },
  };
}

describe('registration metrics', () => {
  it('scores identical images as highly similar', () => {
    const a = image(2, 2, [0, 64, 128, 255]);
    expect(computeNcc(a, a)).toBeCloseTo(1);
    expect(computeSsim(a, a)).toBeCloseTo(1);
  });

  it('combines slice similarity with landmark displacement', () => {
    const a = image(2, 2, [10, 20, 30, 40]);
    const b = image(2, 2, [10, 20, 30, 40]);
    const score = computeMcagpc(a, b, [0, 0, 0], [0, 3, 4], {
      maxLandmarkError: 10,
    });
    expect(score.landmarkDistance).toBeCloseTo(5);
    expect(score.landmarkScore).toBeCloseTo(0.5);
    expect(score.mcagpc).toBeGreaterThan(0.8);
  });

  it('computes sampled MI and Dice for matching volumes', () => {
    const a = volume([-1000, 0, 400, 900, 1200, -300, 500, 800], [2, 2, 2]);
    const mi = computeVolumeMutualInformation(a, a, { step: 1, bins: 8 });
    const dice = computeDiceCoefficient(a, a, { step: 1, threshold: 300 });
    expect(mi.value).toBeGreaterThan(0);
    expect(mi.sampledVoxels).toBe(8);
    expect(dice.value).toBeCloseTo(1);
  });
});

describe('reference slice planes', () => {
  it('computes voxel slice offsets from a landmark reference', () => {
    const plane = computeReferenceSlicePlane(VolumeAxis.Axial, [10, 20, 30], {
      distance: 4,
      spacing: [1, 1, 2],
      dimensions: [64, 64, 32],
    });
    expect(plane.normal).toEqual([0, 0, 1]);
    expect(plane.sliceIndex).toBe(31);
  });

  it('builds all orthogonal planes for a reference point', () => {
    const planes = computeReferenceSliceSet([5, 6, 7], {
      dimensions: [20, 20, 20],
    });
    expect(planes[VolumeAxis.Sagittal].sliceIndex).toBe(5);
    expect(planes[VolumeAxis.Coronal].sliceIndex).toBe(6);
    expect(planes[VolumeAxis.Axial].sliceIndex).toBe(7);
  });
});
