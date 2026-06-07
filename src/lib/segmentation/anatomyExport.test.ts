import { unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import type { GeneratedSurface } from '../surface';
import { buildAnatomySurfaceArchive, labelmapToSegmentMask } from './anatomyExport';
import type { DentalClassStat } from './dentalSegmentGroup';

function fixtureStl(): Uint8Array {
  const buffer = new ArrayBuffer(84 + 50);
  const view = new DataView(buffer);
  view.setUint32(80, 1, true);
  const values = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
  let offset = 84;
  for (const value of values) {
    view.setFloat32(offset, value, true);
    offset += 4;
  }
  view.setUint16(offset, 0, true);
  return new Uint8Array(buffer);
}

vi.mock('../surface', async () => {
  const actual = await vi.importActual<typeof import('../surface')>('../surface');
  return {
    ...actual,
    generateSurfaceInWorker: vi.fn(async () => {
      const generated: GeneratedSurface = {
        blob: new Blob([fixtureStl().buffer as ArrayBuffer], {
          type: 'model/stl',
        }),
        areaMm2: 12,
        volumeMm3: 3,
        triangleCount: 4,
        voxelCount: 2,
      };
      return generated;
    }),
  };
});

const stats: DentalClassStat[] = [
  {
    value: 1,
    key: 'upperSkull',
    name: 'Upper Skull',
    color: '#d8c3a5',
    voxelCount: 2,
    volumeMm3: 2,
  },
  {
    value: 2,
    key: 'mandible',
    name: 'Mandible',
    color: '#e8a87c',
    voxelCount: 0,
    volumeMm3: 0,
  },
  {
    value: 3,
    key: 'upperTeeth',
    name: 'Upper Teeth',
    color: '#54b6e8',
    voxelCount: 1,
    volumeMm3: 1,
  },
];

describe('anatomyExport', () => {
  it('converts one label value into a binary mask', () => {
    expect([...labelmapToSegmentMask(new Uint16Array([0, 1, 2, 1]), 1)]).toEqual([
      0, 1, 0, 1,
    ]);
  });

  it('packages present labels, a raw uint16 labelmap, and a manifest', async () => {
    const blob = await buildAnatomySurfaceArchive({
      labelmap: new Uint16Array([1, 0, 3, 1]),
      stats,
      dims: [1, 2, 2],
      spacing: [1, 1, 1],
      quality: 'balanced',
    });

    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([
      'labelmaps/full-anatomy.nii',
      'labelmaps/full-anatomy.uint16.raw',
      'manifest.json',
      'surfaces/01-Upper_Skull.glb',
      'surfaces/01-Upper_Skull.obj',
      'surfaces/01-Upper_Skull.stl',
      'surfaces/03-Upper_Teeth.glb',
      'surfaces/03-Upper_Teeth.obj',
      'surfaces/03-Upper_Teeth.stl',
    ]);
    expect(files['labelmaps/full-anatomy.uint16.raw'].byteLength).toBe(8);
    expect(files['labelmaps/full-anatomy.nii'].byteLength).toBe(360);
    expect(new TextDecoder().decode(files['surfaces/01-Upper_Skull.obj'])).toContain(
      'o Upper_Skull',
    );
    expect(new DataView(files['surfaces/01-Upper_Skull.glb'].buffer).getUint32(0, true)).toBe(
      0x46546c67,
    );
    const manifest = JSON.parse(
      new TextDecoder().decode(files['manifest.json']),
    ) as { nifti: string; surfaces: Array<{ value: number; stlPath: string; objPath: string; glbPath: string }> };
    expect(manifest.nifti).toBe('labelmaps/full-anatomy.nii');
    expect(manifest.surfaces.map((surface) => surface.value)).toEqual([1, 3]);
    expect(manifest.surfaces[0].stlPath).toBe('surfaces/01-Upper_Skull.stl');
    expect(manifest.surfaces[0].objPath).toBe('surfaces/01-Upper_Skull.obj');
    expect(manifest.surfaces[0].glbPath).toBe('surfaces/01-Upper_Skull.glb');
  });
});
