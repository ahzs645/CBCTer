import { describe, expect, it } from 'vitest';
import {
  reflectIndex,
  runDentalSegmentation,
  windowStarts,
  type DentalSegPatchRunner,
} from './dentalSegInference';

describe('dental segmentation inference', () => {
  it('reflect index and window starts behave', () => {
    expect(reflectIndex(-1, 4)).toBe(1);
    expect(reflectIndex(4, 4)).toBe(2);
    expect(windowStarts(4, 4, 0.5)).toEqual([0]);
    // size 10, window 4, overlap 0.5 → interval 2 → starts 0,2,4,6 (capped at 6)
    expect(windowStarts(10, 4, 0.5)).toEqual([0, 2, 4, 6]);
  });

  it('runs the full pipeline with a mock model and argmaxes classes', async () => {
    const dims: [number, number, number] = [2, 4, 4]; // [D, H, W]
    const spacing: [number, number, number] = [1, 1, 1];
    const data = new Float32Array(2 * 4 * 4).fill(0);

    // Mock model: 2 classes. Class 1 wins where x >= 2, else class 0.
    const runPatch: DentalSegPatchRunner = async (_patch, [d, h, w]) => {
      const voxels = d * h * w;
      const logits = new Float32Array(2 * voxels);
      let i = 0;
      for (let z = 0; z < d; z += 1) {
        for (let y = 0; y < h; y += 1) {
          for (let x = 0; x < w; x += 1) {
            const right = x >= 2 ? 1 : 0;
            logits[0 * voxels + i] = right ? 0 : 5; // class 0
            logits[1 * voxels + i] = right ? 5 : 0; // class 1
            i += 1;
          }
        }
      }
      return logits;
    };

    const result = await runDentalSegmentation(data, dims, spacing, runPatch, {
      modelSpacing: [1, 1, 1], // identity resample
      patchSize: [2, 4, 4], // single window, no padding
      classCount: 2,
      normalization: { lowerBound: -1e9, upperBound: 1e9, mean: 0, std: 1 },
      overlap: 0,
    });

    expect(result.dims).toEqual([2, 4, 4]);
    // Every voxel with x >= 2 should be class 1, otherwise class 0.
    let index = 0;
    for (let z = 0; z < 2; z += 1) {
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          expect(result.labelmap[index]).toBe(x >= 2 ? 1 : 0);
          index += 1;
        }
      }
    }
  });
});
