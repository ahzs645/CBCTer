import type { Vec3 } from '../../types';

export interface NiftiLabelmapOptions {
  labelmap: Uint16Array;
  dims: [number, number, number];
  spacing: Vec3;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

export function writeNiftiUint16Labelmap({
  labelmap,
  dims,
  spacing,
}: NiftiLabelmapOptions): Uint8Array {
  const headerSize = 352;
  const dataBytes = labelmap.byteLength;
  const out = new Uint8Array(headerSize + dataBytes);
  const view = new DataView(out.buffer);
  const [depth, height, width] = dims;
  const [sx, sy, sz] = spacing;

  view.setInt32(0, 348, true);
  view.setInt16(40, 3, true);
  view.setInt16(42, width, true);
  view.setInt16(44, height, true);
  view.setInt16(46, depth, true);
  view.setInt16(48, 1, true);
  view.setInt16(50, 1, true);
  view.setInt16(52, 1, true);
  view.setInt16(54, 1, true);
  view.setInt16(70, 512, true); // DT_UINT16
  view.setInt16(72, 16, true);
  view.setFloat32(76, 0, true);
  view.setFloat32(80, sx, true);
  view.setFloat32(84, sy, true);
  view.setFloat32(88, sz, true);
  view.setFloat32(92, 1, true);
  view.setFloat32(108, headerSize, true);
  view.setFloat32(112, 1, true);
  view.setFloat32(116, 0, true);
  view.setInt16(252, 0, true);
  view.setInt16(254, 0, true);
  writeAscii(out, 344, 'n+1\0');

  out.set(
    new Uint8Array(
      labelmap.buffer,
      labelmap.byteOffset,
      labelmap.byteLength,
    ),
    headerSize,
  );
  return out;
}
