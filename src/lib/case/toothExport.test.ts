import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../types';
import { buildToothModelZip, type ToothCropReader } from './toothExport';
import type { ToothInstance } from './types';

const DIMS: Vec3 = [60, 20, 20];
const SPACING: Vec3 = [0.5, 0.5, 0.5];

/** Two 6-voxel cube teeth at either end of a small volume. */
function scene() {
  const labels = new Uint16Array(DIMS[0] * DIMS[1] * DIMS[2]);
  const teeth: ToothInstance[] = [5, 49].map((x0, k) => {
    for (let z = 7; z < 13; z++)
      for (let y = 7; y < 13; y++)
        for (let x = x0; x < x0 + 6; x++)
          labels[(z * DIMS[1] + y) * DIMS[0] + x] = k + 1;
    return {
      id: `t${k + 1}`,
      groupId: 'g',
      value: k + 1,
      fdi: k ? 21 : 11,
      review: 'unreviewed',
      centroid: [x0 + 2.5, 9.5, 9.5],
      bounds: { min: [x0, 7, 7], max: [x0 + 5, 12, 12] },
      voxelCount: 216,
      source: 'model',
    };
  });
  return { labels, teeth };
}

function reader(labels: Uint16Array, maxVoxels: number): ToothCropReader {
  return async (_groupId, start, shape) => {
    if (shape[0] * shape[1] * shape[2] > maxVoxels)
      throw new Error('Region exceeds 64 MiB.');
    const out = new Uint16Array(shape[0] * shape[1] * shape[2]);
    for (let z = 0; z < shape[2]; z++)
      for (let y = 0; y < shape[1]; y++)
        for (let x = 0; x < shape[0]; x++)
          out[(z * shape[1] + y) * shape[0] + x] =
            labels[
              ((start[2] + z) * DIMS[1] + start[1] + y) * DIMS[0] + start[0] + x
            ];
    return { scan: new Int16Array(out.length), labels: out };
  };
}

describe('buildToothModelZip', () => {
  it('still exports the teeth when the whole selection is too large to read at once', async () => {
    const { labels, teeth } = scene();
    const { zip, reports } = await buildToothModelZip({
      teeth,
      allTeeth: teeth,
      dims: DIMS,
      spacing: SPACING,
      // Each tooth's own box fits; the box over both does not.
      read: reader(labels, 20 * 20 * 20),
      model: { crownOnly: false, gumOffsetMm: 1 },
      scanName: 'test',
    });
    expect(reports).toHaveLength(2);
    const files = unzipSync(zip);
    expect(
      Object.keys(files).filter((f) => f.startsWith('teeth/')),
    ).toHaveLength(2);
    const readme = new TextDecoder().decode(files['README.txt']);
    expect(readme).toContain('Bite check skipped: Region exceeds 64 MiB.');
  });

  it('runs the bite check when the selection fits', async () => {
    const { labels, teeth } = scene();
    const { zip } = await buildToothModelZip({
      teeth,
      allTeeth: teeth,
      dims: DIMS,
      spacing: SPACING,
      read: reader(labels, Infinity),
      model: { crownOnly: false, gumOffsetMm: 1 },
      scanName: 'test',
    });
    const readme = new TextDecoder().decode(unzipSync(zip)['README.txt']);
    expect(readme).toContain('Bite: no upper and lower teeth');
  });
});
