import { describe, expect, it } from 'vitest';
import {
  fillMaskHoles,
  keepLargestMaskComponent,
  regionGrowMask,
  splitMaskComponents,
  thresholdVolume,
} from './maskOperations';

describe('mask operations', () => {
  it('thresholds and grows a constrained region', () => {
    const voxels = new Int16Array([0, 10, 10, 0, 20, 20, 0, 0]);
    expect([...thresholdVolume(voxels, [10, 20])]).toEqual([
      0, 1, 1, 0, 1, 1, 0, 0,
    ]);
    expect([...regionGrowMask(voxels, [2, 2, 2], [1, 0, 0], [10, 10], 6)]).toEqual([
      0, 1, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('splits components and keeps the largest component', () => {
    const mask = new Uint8Array([1, 1, 0, 0, 0, 0, 1, 0]);
    const components = splitMaskComponents(mask, [2, 2, 2], 6);
    expect(components.map((component) => component.voxels)).toEqual([2, 1]);
    expect([...keepLargestMaskComponent(mask, [2, 2, 2], 6)]).toEqual([
      1, 1, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('fills enclosed holes without filling border background', () => {
    const dims: [number, number, number] = [3, 3, 3];
    const mask = new Uint8Array(27).fill(1);
    mask[13] = 0;
    const filled = fillMaskHoles(mask, dims);
    expect(filled[13]).toBe(1);

    const open = new Uint8Array(mask);
    open[4] = 0;
    const filledOpen = fillMaskHoles(open, dims);
    expect(filledOpen[4]).toBe(0);
  });
});
