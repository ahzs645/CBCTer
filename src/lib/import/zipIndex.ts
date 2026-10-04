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
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT = 0xffff;

async function readRange(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

export async function readZipIndex(blob: Blob): Promise<ZipIndexEntry[]> {
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
  if (eocd < 0) throw new Error('Not a ZIP file (no end-of-central-directory record).');
  const entryCount = tailView.getUint16(eocd + 10, true);
  const directorySize = tailView.getUint32(eocd + 12, true);
  const directoryOffset = tailView.getUint32(eocd + 16, true);
  if (entryCount === 0xffff || directoryOffset === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported.');
  }

  const directory = await readRange(
    blob,
    directoryOffset,
    directoryOffset + directorySize,
  );
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
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
    entries.push({
      method: view.getUint16(cursor + 10, true),
      compressedSize: view.getUint32(cursor + 20, true),
      size: view.getUint32(cursor + 24, true),
      localHeaderOffset: view.getUint32(cursor + 42, true),
      name: decoder.decode(directory.subarray(cursor + 46, cursor + 46 + nameLength)),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(compressed: Uint8Array, size: number): Promise<Uint8Array> {
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
  blob: Blob,
  entry: ZipIndexEntry,
): Promise<Uint8Array> {
  const header = await readRange(blob, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(0, true) !== LOCAL_SIGNATURE) {
    throw new Error(`Corrupt ZIP entry header for ${entry.name}.`);
  }
  const dataStart =
    entry.localHeaderOffset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
  const compressed = await readRange(blob, dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflateRaw(compressed, entry.size);
  throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.name}.`);
}
