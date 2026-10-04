import { asByteSource, type ZipSource } from './byteSource';
import { inflateSync } from 'fflate';

/**
 * Minimal random-access ZIP reader over a Blob/File. It reads the central
 * directory from the end of the file and then only the bytes of the entries
 * that are actually requested, so a multi-level scan package can hand a
 * phone its small volume without the large one ever being read into memory.
 *
 * Supports stored (0) and deflated (8) entries in classic (non-ZIP64)
 * archives — what CBCTer and common zip tools write for files < 4 GB.
 */

export interface ZipIndexEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
  crc32: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT = 0xffff;

async function readRange(
  blob: ZipSource,
  start: number,
  end: number,
): Promise<Uint8Array> {
  return asByteSource(blob).read(start, end);
}

export async function readZipIndex(blob: ZipSource): Promise<ZipIndexEntry[]> {
  if (blob.size < EOCD_MIN_SIZE) throw new Error('Not a ZIP file (too small).');
  const tailStart = Math.max(0, blob.size - (EOCD_MIN_SIZE + MAX_COMMENT));
  const tail = await readRange(blob, tailStart, blob.size);
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let index = tail.length - EOCD_MIN_SIZE; index >= 0; index -= 1) {
    if (tailView.getUint32(index, true) === EOCD_SIGNATURE) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0)
    throw new Error('Not a ZIP file (no end-of-central-directory record).');
  const entryCount = tailView.getUint16(eocd + 10, true);
  const directorySize = tailView.getUint32(eocd + 12, true);
  const directoryOffset = tailView.getUint32(eocd + 16, true);
  if (entryCount === 0xffff || directoryOffset === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported.');
  }

  if (
    directorySize > 4 * 1024 * 1024 ||
    directoryOffset + directorySize > blob.size - 22
  )
    throw new Error('Invalid or oversized ZIP directory.');
  const directory = await readRange(
    blob,
    directoryOffset,
    directoryOffset + directorySize,
  );
  const view = new DataView(
    directory.buffer,
    directory.byteOffset,
    directory.byteLength,
  );
  const decoder = new TextDecoder();
  const entries: ZipIndexEntry[] = [];
  let cursor = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw new Error('Corrupt ZIP central directory.');
    }
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    if (
      cursor + 46 + nameLength + extraLength + commentLength >
      directory.length
    )
      throw new Error('Truncated ZIP directory.');
    if (view.getUint16(cursor + 8, true) & 1)
      throw new Error('Encrypted scan packages are not supported.');
    entries.push({
      crc32: view.getUint32(cursor + 16, true),
      method: view.getUint16(cursor + 10, true),
      compressedSize: view.getUint32(cursor + 20, true),
      size: view.getUint32(cursor + 24, true),
      localHeaderOffset: view.getUint32(cursor + 42, true),
      name: decoder.decode(
        directory.subarray(cursor + 46, cursor + 46 + nameLength),
      ),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(
  compressed: Uint8Array,
  size: number,
): Promise<Uint8Array> {
  // Native streaming inflate where available (all current browsers);
  // fflate otherwise.
  if (typeof DecompressionStream === 'function') {
    try {
      const stream = new Blob([compressed as Uint8Array<ArrayBuffer>])
        .stream()
        .pipeThrough(new DecompressionStream('deflate-raw'));
      const out = new Uint8Array(size);
      let offset = 0;
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out.set(value, offset);
        offset += value.length;
      }
      if (offset === size) return out;
    } catch {
      // Fall through to the JS inflater.
    }
  }
  return inflateSync(compressed, { out: new Uint8Array(size) });
}

export async function readZipEntry(
  blob: ZipSource,
  entry: ZipIndexEntry,
): Promise<Uint8Array> {
  const header = await readRange(
    blob,
    entry.localHeaderOffset,
    entry.localHeaderOffset + 30,
  );
  const view = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  );
  if (view.getUint32(0, true) !== LOCAL_SIGNATURE) {
    throw new Error(`Corrupt ZIP entry header for ${entry.name}.`);
  }
  const dataStart =
    entry.localHeaderOffset +
    30 +
    view.getUint16(26, true) +
    view.getUint16(28, true);
  const compressed = await readRange(
    blob,
    dataStart,
    dataStart + entry.compressedSize,
  );
  const data =
    entry.method === 0
      ? compressed
      : entry.method === 8
        ? await inflateRaw(compressed, entry.size)
        : null;
  if (!data)
    throw new Error(
      `Unsupported ZIP compression method ${entry.method} for ${entry.name}.`,
    );
  if (data.length !== entry.size || crc32(data) !== entry.crc32)
    throw new Error(`Corrupt ZIP payload for ${entry.name}.`);
  return data;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, i) => {
  let value = i;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
