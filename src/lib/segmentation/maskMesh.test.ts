import { describe, expect, it } from 'vitest';
import { maskToAsciiPly, maskToBinaryStl } from './maskMesh';

async function stlTriangleCount(blob: Blob): Promise<number> {
  const buffer = await blob.arrayBuffer();
  return new DataView(buffer).getUint32(80, true);
}

describe('mask mesh generation', () => {
  it('exports a known single-voxel block as 12 exposed-face triangles', async () => {
    const blob = maskToBinaryStl(
      new Uint8Array([1]),
      [1, 1, 1],
      [1, 1, 1],
      [0, 0, 0],
      1,
      { extraction: 'voxel' },
    );
    expect(await stlTriangleCount(blob)).toBe(12);
  });

  it('exports non-empty iso STL and PLY for a single-voxel mask', async () => {
    const mask = new Uint8Array([1]);
    const stl = maskToBinaryStl(mask, [1, 1, 1], [1, 1, 1], [0, 0, 0], 1, {
      extraction: 'iso',
    });
    expect(await stlTriangleCount(stl)).toBeGreaterThan(0);

    const ply = await maskToAsciiPly(
      mask,
      [1, 1, 1],
      [1, 1, 1],
      [0, 0, 0],
      1,
      { extraction: 'iso' },
    ).text();
    expect(ply).toContain('format ascii 1.0');
    expect(ply).toContain('element face');
  });
});
