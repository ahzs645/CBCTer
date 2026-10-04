import Zstd from 'numcodecs/zstd';
import type { NativeVoxelMetadata } from '../../volume/native';
let codec: ReturnType<typeof Zstd.fromConfig> | undefined;
function zstd() {
  return (codec ??= Zstd.fromConfig({ id: 'zstd', level: 3 }));
}
/** Modular uint16 differences restart on every row inside every block. */
export function predictAndShuffle(
  words: Int16Array | Uint16Array,
  width: number,
): Uint8Array {
  const out = new Uint8Array(words.length * 2);
  for (let i = 0; i < words.length; i++) {
    const delta = (words[i] - (i % width ? words[i - 1] : 0)) & 65535;
    out[i] = delta & 255;
    out[words.length + i] = delta >>> 8;
  }
  return out;
}
export function restoreWords(
  bytes: Uint8Array,
  width: number,
  dtype: NativeVoxelMetadata['dtype'],
): Int16Array | Uint16Array {
  if (bytes.length % 2) throw new Error('Invalid chunk word length.');
  const n = bytes.length / 2;
  const out = dtype === 'int16' ? new Int16Array(n) : new Uint16Array(n);
  for (let i = 0; i < n; i++)
    out[i] =
      ((bytes[i] | (bytes[n + i] << 8)) + (i % width ? out[i - 1] : 0)) & 65535;
  return out;
}
export async function encodeChunk(
  words: Int16Array | Uint16Array,
  width: number,
) {
  return await zstd().encode(predictAndShuffle(words, width));
}
export async function decodeChunk(
  bytes: Uint8Array,
  shape: number[],
  dtype: NativeVoxelMetadata['dtype'],
) {
  const n = shape.reduce((a, b) => a * b, 1);
  // Inspect the frame's declared content size before WASM can allocate it.
  // The reader additionally constrains encoded length and canonical block shape.
  if (zstdContentSize(bytes) !== n * 2)
    throw new Error('Zstd frame content size does not match its chunk.');
  const decoded = await zstd().decode(bytes);
  if (decoded.length !== n * 2)
    throw new Error('Decoded chunk size does not match its geometry.');
  return restoreWords(decoded, shape[0], dtype);
}
export async function sha256(data: ArrayBufferView): Promise<string> {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (!globalThis.crypto?.subtle)
    throw new Error('Streamable scan packages require HTTPS or localhost.');
  const hash = await crypto.subtle.digest(
    'SHA-256',
    bytes as Uint8Array<ArrayBuffer>,
  );
  return Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}

function zstdContentSize(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 6 || v.getUint32(0, true) !== 0xfd2fb528)
    throw new Error('Invalid Zstd frame.');
  const descriptor = bytes[4],
    flag = descriptor >>> 6,
    single = (descriptor & 32) !== 0;
  if (descriptor & 8) throw new Error('Invalid Zstd frame descriptor.');
  const length =
    flag === 0 ? (single ? 1 : 0) : flag === 1 ? 2 : flag === 2 ? 4 : 8;
  const offset = 5 + (single ? 0 : 1) + [0, 1, 2, 4][descriptor & 3];
  if (!length || offset + length > bytes.length)
    throw new Error('Zstd frame must declare its bounded content size.');
  const size =
    length === 1
      ? bytes[offset]
      : length === 2
        ? v.getUint16(offset, true) + 256
        : length === 4
          ? v.getUint32(offset, true)
          : Number(v.getBigUint64(offset, true));
  if (!Number.isSafeInteger(size)) throw new Error('Invalid Zstd frame size.');
  return size;
}
