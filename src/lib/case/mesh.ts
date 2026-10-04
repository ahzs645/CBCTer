import type { Vec3 } from '../../types';
/** STL vertices use local physical millimetres. Cropping shifts the local origin. */
export function translateStl(bytes: Uint8Array, offsetMm: Vec3): Uint8Array {
  if (offsetMm.every((n) => n === 0)) return bytes;
  if (bytes.length >= 84) {
    const original = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      ),
      count = original.getUint32(80, true);
    if (84 + 50 * count === bytes.length) {
      const copy = new Uint8Array(bytes),
        view = new DataView(copy.buffer);
      for (let t = 0; t < count; t++)
        for (let vertex = 0; vertex < 3; vertex++)
          for (let a = 0; a < 3; a++) {
            const at = 84 + t * 50 + 12 + vertex * 12 + a * 4;
            view.setFloat32(at, view.getFloat32(at, true) + offsetMm[a], true);
          }
      return copy;
    }
  }
  const decoded = new TextDecoder().decode(bytes);
  if (!/^\s*solid\b/.test(decoded))
    throw new Error('Unsupported STL geometry.');
  return new TextEncoder().encode(
    decoded.replace(
      /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g,
      (_, x, y, z) =>
        `vertex ${Number(x) + offsetMm[0]} ${Number(y) + offsetMm[1]} ${Number(z) + offsetMm[2]}`,
    ),
  );
}
