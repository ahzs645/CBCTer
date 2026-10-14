import { describe, expect, it } from 'vitest';
import type { LoadedVolume } from '../../types';
import { prepareVolumeFor3D } from './preview-3d';

function volumeOf(voxels: Int16Array, range: [number, number]) {
  return {
    voxels,
    meta: {
      dimensions: [voxels.length, 1, 1],
      spacing: [1, 1, 1],
      scalarRange: range,
      initialWindowLevel: { window: 1000, level: 300 },
    },
  } as unknown as LoadedVolume;
}

describe('prepareVolumeFor3D', () => {
  it('maps values to 0–255 across the scalar range, clamping outside it', () => {
    const voxels = Int16Array.from([-32768, -1000, -999, 0, 500, 3000, 32767]);
    const prepared = prepareVolumeFor3D(volumeOf(voxels, [-1000, 3000]));
    const expected = Array.from(voxels, (v) =>
      Math.round(Math.min(1, Math.max(0, (v + 1000) / 4000)) * 255),
    );
    expect(Array.from(prepared.voxels)).toEqual(expected);
  });

  it('puts the 3D threshold between the 95th and 99th percentile', () => {
    const voxels = new Int16Array(10000);
    for (let i = 0; i < voxels.length; i++) voxels[i] = i < 9000 ? 0 : 2000;
    const prepared = prepareVolumeFor3D(volumeOf(voxels, [-1000, 3000]));
    expect(prepared.threshold).toBeGreaterThan(1900);
    expect(prepared.threshold).toBeLessThanOrEqual(2001);
  });
});
