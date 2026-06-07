import { describe, expect, it } from 'vitest';
import { writeNiftiUint16Labelmap } from './nifti';

describe('nifti export', () => {
  it('writes a single-file uint16 NIfTI labelmap header and payload', () => {
    const bytes = writeNiftiUint16Labelmap({
      labelmap: new Uint16Array([1, 2, 3, 4]),
      dims: [1, 2, 2],
      spacing: [0.2, 0.3, 0.4],
    });
    const view = new DataView(bytes.buffer);
    expect(view.getInt32(0, true)).toBe(348);
    expect(view.getInt16(40, true)).toBe(3);
    expect(view.getInt16(42, true)).toBe(2);
    expect(view.getInt16(44, true)).toBe(2);
    expect(view.getInt16(46, true)).toBe(1);
    expect(view.getInt16(70, true)).toBe(512);
    expect(view.getFloat32(108, true)).toBe(352);
    expect(String.fromCharCode(...bytes.slice(344, 347))).toBe('n+1');
    expect(view.getUint16(352, true)).toBe(1);
    expect(view.getUint16(358, true)).toBe(4);
  });
});
