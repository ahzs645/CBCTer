import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../types';
import { buildToothModelZip } from './toothExport';
import {
  archOrder,
  buildIsolatedVolume,
  concatBinaryStl,
  crownDirectionFor,
  cropVolume,
  estimateGumline,
  hideTeethInPreview,
  mirrorFdi,
  numberingLooksMirrored,
  overlappingTeeth,
  selectionBounds,
  teethInGroup,
  toothMask,
} from './toothSelection';
import type { ToothInstance } from './types';

const tooth = (
  value: number,
  fdi: number | null,
  min: Vec3,
  max: Vec3,
  review: ToothInstance['review'] = 'unreviewed',
): ToothInstance => ({
  id: `t${value}`,
  groupId: 'g',
  value,
  fdi,
  review,
  source: 'model',
  voxelCount: 1,
  centroid: min.map((v, a) => (v + max[a]) / 2) as Vec3,
  bounds: { min, max },
});

/**
 * A lower tooth standing along +z (crown up) in a 20×20×40 grid: a 6×6 column
 * from z=2 to z=35. "Bone" (value 900) surrounds it up to z=20, soft tissue
 * (value 100) above that, tooth voxels are 1500.
 */
function lowerToothPhantom() {
  const shape: Vec3 = [20, 20, 40];
  const scan = new Int16Array(shape[0] * shape[1] * shape[2]);
  const labels = new Uint16Array(scan.length);
  for (let z = 0; z < shape[2]; z++)
    for (let y = 0; y < shape[1]; y++)
      for (let x = 0; x < shape[0]; x++) {
        const i = (z * shape[1] + y) * shape[0] + x;
        const inside =
          x >= 7 && x < 13 && y >= 7 && y < 13 && z >= 2 && z <= 35;
        if (inside) {
          labels[i] = 5;
          scan[i] = 1500;
        } else scan[i] = z <= 20 ? 900 : 100;
      }
  return { shape, scan, labels };
}

describe('tooth groups', () => {
  const teeth = [
    tooth(1, 13, [0, 0, 10], [1, 1, 11]),
    tooth(2, 23, [5, 0, 10], [6, 1, 11]),
    tooth(3, 24, [7, 0, 10], [8, 1, 11]),
    tooth(4, 33, [0, 0, 0], [1, 1, 1]),
    tooth(5, 41, [2, 0, 0], [3, 1, 1], 'rejected'),
    tooth(6, null, [9, 0, 0], [9, 1, 1]),
  ];
  it('picks canine-to-canine and arches by FDI and skips rejected teeth', () => {
    expect(teethInGroup(teeth, 'upper-anterior').map((t) => t.fdi)).toEqual([
      13, 23,
    ]);
    expect(teethInGroup(teeth, 'lower-anterior').map((t) => t.fdi)).toEqual([
      33,
    ]);
    expect(teethInGroup(teeth, 'upper').map((t) => t.fdi)).toEqual([
      13, 23, 24,
    ]);
    expect(teethInGroup(teeth, 'all')).toHaveLength(5);
  });
  it('mirrors left and right quadrants', () => {
    expect([13, 23, 34, 44, 52, 65, null].map(mirrorFdi)).toEqual([
      23,
      13,
      44,
      34,
      62,
      55,
      null,
    ]);
  });
  it('pads and clamps the selection bounds', () => {
    expect(selectionBounds(teeth.slice(0, 2), [10, 10, 12], 2)).toEqual({
      start: [0, 0, 8],
      shape: [9, 4, 4],
    });
    expect(selectionBounds([], [1, 1, 1])).toBeNull();
  });
  it('orients crowns: upper teeth point down, lower teeth point up', () => {
    expect(crownDirectionFor(teeth[0], teeth)).toBe(-1);
    expect(crownDirectionFor(teeth[3], teeth)).toBe(1);
    expect(crownDirectionFor(teeth[3], teeth, -1)).toBe(-1);
  });
});

describe('isolated 3D volume', () => {
  it('keeps only the chosen tooth and frames its crop', () => {
    const { shape, scan, labels } = lowerToothPhantom();
    const t = tooth(5, 33, [7, 7, 2], [12, 12, 35]);
    const iso = buildIsolatedVolume({
      scan,
      labels: [{ groupId: 'g', words: labels }],
      start: [100, 50, 10],
      shape,
      spacing: [0.2, 0.2, 0.2],
      teeth: [t],
      scalarRange: [0, 2000],
      threshold: 500,
    });
    expect(iso.cropped).toBe(true);
    expect(iso.origin).toEqual([100, 50, 10]);
    expect(iso.sourceDimensions).toEqual(shape);
    const kept = iso.voxels.filter((v) => v > 0).length;
    expect(kept).toBe(labels.filter((v) => v === 5).length);
    const context = buildIsolatedVolume({
      scan,
      labels: [],
      start: [0, 0, 0],
      shape,
      spacing: [0.2, 0.2, 0.2],
      teeth: [t],
      scalarRange: [0, 2000],
      threshold: 500,
      context: true,
    });
    expect(context.voxels.filter((v) => v > 0).length).toBe(scan.length);
  });
  it('downsamples crops larger than the texture limit', () => {
    const iso = buildIsolatedVolume({
      scan: new Int16Array(40 * 10 * 10),
      labels: [],
      start: [0, 0, 0],
      shape: [40, 10, 10],
      spacing: [0.1, 0.1, 0.1],
      teeth: [],
      scalarRange: [0, 1],
      threshold: 0,
      maxEdge: 20,
    });
    expect(iso.dimensions).toEqual([20, 5, 5]);
    expect(iso.spacing[0]).toBeCloseTo(0.2);
  });
  it('hides teeth from a downsampled preview', () => {
    const { shape, labels } = lowerToothPhantom();
    const preview = {
      dimensions: shape,
      sourceDimensions: shape,
      origin: [0, 0, 0] as Vec3,
      spacing: [1, 1, 1] as Vec3,
      voxels: new Uint8Array(labels.length).fill(200),
      scalarRange: [0, 1] as [number, number],
      threshold: 0,
      downsampled: false,
      cropped: false,
    };
    const hidden = hideTeethInPreview(preview, [labels], shape);
    expect(hidden.voxels.filter((v) => v === 0).length).toBe(
      labels.filter(Boolean).length,
    );
    expect(preview.voxels.every((v) => v === 200)).toBe(true);
  });
});

describe('gumline estimate', () => {
  it('finds the bone crest and places the gumline crownward of it', () => {
    const { shape, scan, labels } = lowerToothPhantom();
    const estimate = estimateGumline({
      scan,
      labels,
      shape,
      spacing: [0.5, 0.5, 0.5],
      value: 5,
      crownDirection: 1,
      gumOffsetMm: 2,
    })!;
    expect(estimate.measured).toBe(true);
    expect(Math.abs(estimate.crest - 20)).toBeLessThanOrEqual(1);
    expect(estimate.gumline).toBe(estimate.crest + 4);
    const crown = toothMask(labels, shape, 5, estimate);
    expect(crown.voxels).toBe(36 * (35 - estimate.gumline + 1));
  });
  it('falls back to a proportional guess without bone', () => {
    const { shape, scan, labels } = lowerToothPhantom();
    const noBone = scan.map((v) => (v === 900 ? 100 : v));
    const estimate = estimateGumline({
      scan: noBone,
      labels,
      shape,
      spacing: [0.5, 0.5, 0.5],
      value: 5,
      crownDirection: 1,
    })!;
    expect(estimate.measured).toBe(false);
    expect(estimate.crest).toBeLessThan(35);
    expect(estimate.crest).toBeGreaterThan(2);
  });
});

describe('tooth model export', () => {
  it('writes per-tooth, combined STL and a README with caveats', async () => {
    const { shape, scan, labels } = lowerToothPhantom();
    const t = tooth(5, 33, [7, 7, 2], [12, 12, 35]);
    const dims = shape;
    const { zip, reports } = await buildToothModelZip({
      teeth: [t],
      allTeeth: [t],
      dims,
      spacing: [0.5, 0.5, 0.5],
      scanName: 'phantom',
      model: { crownOnly: true, gumOffsetMm: 2 },
      read: async (_g, start, size) => {
        const s = new Int16Array(size[0] * size[1] * size[2]);
        const l = new Uint16Array(s.length);
        for (let z = 0; z < size[2]; z++)
          for (let y = 0; y < size[1]; y++)
            for (let x = 0; x < size[0]; x++) {
              const src =
                ((z + start[2]) * dims[1] + y + start[1]) * dims[0] +
                x +
                start[0];
              const dst = (z * size[1] + y) * size[0] + x;
              s[dst] = scan[src];
              l[dst] = labels[src];
            }
        return { scan: s, labels: l };
      },
    });
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual([
      'README.txt',
      'crowns-combined.stl',
      'teeth/tooth-33-crown.stl',
    ]);
    expect(reports[0].gumlineMeasured).toBe(true);
    expect(reports[0].crownHeightMm).toBeGreaterThan(5);
    expect(reports[0].triangles).toBeGreaterThan(0);
    expect(new TextDecoder().decode(files['README.txt'])).toMatch(
      /ESTIMATED gumline/,
    );
    expect(files['crowns-combined.stl'].byteLength).toBe(
      files['teeth/tooth-33-crown.stl'].byteLength,
    );
  });
  it('concatenates binary STL triangle counts', () => {
    const part = (n: number) => {
      const b = new Uint8Array(84 + n * 50);
      new DataView(b.buffer).setUint32(80, n, true);
      return b;
    };
    const out = concatBinaryStl([part(2), part(3)]);
    expect(new DataView(out.buffer).getUint32(80, true)).toBe(5);
    expect(out.byteLength).toBe(84 + 5 * 50);
  });
});

describe('numbering checks', () => {
  const at = (value: number, fdi: number, x: number) =>
    tooth(value, fdi, [x, 0, 0], [x, 0, 0]);
  it('flags quadrants that sit on the wrong side of the midline', () => {
    // +X is patient left: 2x/3x belong on the high-X side.
    const correct = [
      at(1, 13, 10),
      at(2, 43, 12),
      at(3, 23, 90),
      at(4, 33, 88),
    ];
    const mirrored = [
      at(1, 23, 10),
      at(2, 33, 12),
      at(3, 13, 90),
      at(4, 43, 88),
    ];
    expect(numberingLooksMirrored(correct)).toBe(false);
    expect(numberingLooksMirrored(mirrored)).toBe(true);
    expect(numberingLooksMirrored(mirrored, -1)).toBe(false);
  });
  it('orders teeth like the chart', () => {
    const teeth = [
      at(1, 33, 0),
      at(2, 11, 0),
      at(3, 18, 0),
      at(4, 21, 0),
      at(5, 48, 0),
    ];
    expect(archOrder(teeth).map((t) => t.fdi)).toEqual([18, 11, 21, 48, 33]);
  });
});

describe('overlap check', () => {
  it('flags one tooth split into two outlines', () => {
    const a = tooth(1, 41, [282, 110, 175], [320, 176, 309]);
    const b = tooth(2, 42, [284, 117, 204], [316, 171, 287]);
    const c = tooth(3, 43, [314, 126, 154], [351, 195, 314]);
    // Tilted neighbours: boxes overlap but centres are far apart.
    const d = tooth(4, 23, [160, 100, 320], [200, 160, 470]);
    const e = tooth(5, 24, [150, 110, 320], [185, 170, 400]);
    expect(overlappingTeeth([a, b, c, d, e]).map(([x, y]) => [x.fdi, y.fdi])).toEqual(
      [[41, 42]],
    );
  });
});

describe('crop', () => {
  it('copies a box out of an x-fastest volume', () => {
    const dims: Vec3 = [4, 3, 2];
    const src = Int16Array.from({ length: 24 }, (_, i) => i);
    expect([...cropVolume(src, dims, [1, 1, 1], [2, 2, 1])]).toEqual([
      17, 18, 21, 22,
    ]);
  });
});
