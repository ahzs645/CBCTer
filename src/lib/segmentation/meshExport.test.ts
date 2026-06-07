import { describe, expect, it } from 'vitest';
import { meshToGlb, meshToObj, parseBinaryStl } from './meshExport';

function stlFixture(): Uint8Array {
  const buffer = new ArrayBuffer(84 + 50);
  const view = new DataView(buffer);
  view.setUint32(80, 1, true);
  const values = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
  let offset = 84;
  for (const value of values) {
    view.setFloat32(offset, value, true);
    offset += 4;
  }
  return new Uint8Array(buffer);
}

describe('mesh export', () => {
  it('converts binary STL triangles to OBJ and GLB', () => {
    const mesh = parseBinaryStl(stlFixture());
    expect(mesh.positions.length).toBe(9);
    expect(mesh.indices.length).toBe(3);

    const obj = new TextDecoder().decode(meshToObj(mesh, 'Test Mesh'));
    expect(obj).toContain('o Test_Mesh');
    expect(obj).toContain('f 1//1 2//2 3//3');

    const glb = meshToGlb(mesh, 'Test Mesh');
    const view = new DataView(glb.buffer);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(glb.byteLength);
  });
});
