import type { Vec3 } from '../../../types';
import { blobSource, httpSource, type ByteSource } from '../byteSource';
import { readZipIndex, readZipEntry } from '../zipIndex';
import { decodeChunk, sha256 } from './codec';
import {
  parseChunkedManifest,
  type ChunkInfo,
  type ChunkedManifest,
} from './manifest';
export type PackageSourceDescriptor =
  | { blob: Blob }
  | { url: string }
  | { files: Record<string, File> };
export interface ChunkReadStats {
  bytesRead: number;
  decodedChunks: number;
  cacheBytes: number;
  cacheLimitBytes: number;
  cacheHits: number;
}
export class ChunkedReader {
  private shared = {
    cache: new Map<string, Int16Array | Uint16Array>(),
    pending: new Map<string, Promise<Int16Array | Uint16Array>>(),
    decodedChunks: 0,
    cacheHits: 0,
    cacheBytes: 0,
  };
  constructor(
    readonly manifest: ChunkedManifest,
    private readEntry: (name: string, expected?: number) => Promise<Uint8Array>,
    private source: Pick<ByteSource, 'bytesRead'>,
    readonly cacheLimitBytes = 64 * 1024 * 1024,
  ) {}
  fileBytes(name: string, expected?: number) {
    return this.readEntry(name, expected);
  }
  fork(manifest: ChunkedManifest) {
    const fork = new ChunkedReader(
      manifest,
      this.readEntry,
      this.source,
      this.cacheLimitBytes,
    );
    fork.shared = this.shared;
    return fork;
  }
  stats(): ChunkReadStats {
    return {
      bytesRead: this.source.bytesRead,
      decodedChunks: this.shared.decodedChunks,
      cacheBytes: this.shared.cacheBytes,
      cacheLimitBytes: this.cacheLimitBytes,
      cacheHits: this.shared.cacheHits,
    };
  }
  async preview(): Promise<Int16Array> {
    const p = this.manifest.preview;
    const bytes = await this.readEntry(
      p.file,
      p.dimensions.reduce((a, b) => a * b, 2),
    );
    if ((await sha256(bytes)) !== p.sha256)
      throw new Error('Preview checksum mismatch.');
    return new Int16Array(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    );
  }
  private async chunk(c: ChunkInfo): Promise<Int16Array | Uint16Array> {
    const cached = this.shared.cache.get(c.file);
    if (cached) {
      this.shared.cacheHits++;
      this.shared.cache.delete(c.file);
      this.shared.cache.set(c.file, cached);
      return cached;
    }
    const pending = this.shared.pending.get(c.file);
    if (pending) return pending;
    const promise = (async () => {
      const data = await this.readEntry(c.file, c.bytes);
      const words = await decodeChunk(
        data,
        c.shape,
        this.manifest.volume.dtype,
      );
      if ((await sha256(words)) !== c.sha256)
        throw new Error('Native chunk checksum mismatch.');
      this.shared.decodedChunks++;
      while (
        this.shared.cacheBytes + words.byteLength > this.cacheLimitBytes &&
        this.shared.cache.size
      ) {
        const [key, value] = this.shared.cache.entries().next().value!;
        this.shared.cache.delete(key);
        this.shared.cacheBytes -= value.byteLength;
      }
      if (words.byteLength <= this.cacheLimitBytes) {
        this.shared.cache.set(c.file, words);
        this.shared.cacheBytes += words.byteLength;
      }
      return words;
    })();
    this.shared.pending.set(c.file, promise);
    try {
      return await promise;
    } finally {
      this.shared.pending.delete(c.file);
    }
  }
  private checkRegion(start: Vec3, shape: Vec3) {
    if (
      !start.every(Number.isInteger) ||
      !shape.every(Number.isInteger) ||
      start.some(
        (n, i) =>
          n < 0 ||
          shape[i] < 1 ||
          n + shape[i] > this.manifest.volume.dimensions[i],
      )
    )
      throw new Error('Region is outside the native volume.');
  }
  async region(
    start: Vec3,
    shape: Vec3,
    cancelled = () => false,
  ): Promise<Int16Array | Uint16Array> {
    this.checkRegion(start, shape);
    const count = shape.reduce((a, b) => a * b, 1);
    if (count * 2 > 64 * 1024 * 1024)
      throw new Error(
        'Region exceeds 64 MiB. Load the full volume explicitly for larger operations.',
      );
    const out =
      this.manifest.volume.dtype === 'int16'
        ? new Int16Array(count)
        : new Uint16Array(count);
    const selected = this.manifest.volume.chunks.filter((c) =>
      c.start.every(
        (n, i) => n < start[i] + shape[i] && n + c.shape[i] > start[i],
      ),
    );
    let next = 0;
    const tasks = Array.from(
      { length: Math.min(4, selected.length) },
      async () => {
        while (next < selected.length) {
          if (cancelled()) throw new DOMException('Cancelled', 'AbortError');
          const c = selected[next++];
          const words = await this.chunk(c);
          if (cancelled()) throw new DOMException('Cancelled', 'AbortError');
          const lo = c.start.map((n, i) => Math.max(n, start[i])) as Vec3;
          const hi = c.start.map((n, i) =>
            Math.min(n + c.shape[i], start[i] + shape[i]),
          ) as Vec3;
          for (let z = lo[2]; z < hi[2]; z++)
            for (let y = lo[1]; y < hi[1]; y++) {
              const from =
                ((z - c.start[2]) * c.shape[1] + y - c.start[1]) * c.shape[0] +
                lo[0] -
                c.start[0];
              const to =
                ((z - start[2]) * shape[1] + y - start[1]) * shape[0] +
                lo[0] -
                start[0];
              out.set(words.subarray(from, from + hi[0] - lo[0]), to);
            }
        }
      },
    );
    const results = await Promise.allSettled(tasks);
    for (const result of results)
      if (result.status === 'rejected') throw result.reason;
    return out;
  }
  async materialize(
    cancelled = () => false,
    verifyWholeHash = true,
  ): Promise<Int16Array | Uint16Array> {
    const dims = this.manifest.volume.dimensions;
    const out =
      this.manifest.volume.dtype === 'int16'
        ? new Int16Array(dims.reduce((a, b) => a * b, 1))
        : new Uint16Array(dims.reduce((a, b) => a * b, 1));
    for (const c of this.manifest.volume.chunks) {
      if (cancelled()) throw new DOMException('Cancelled', 'AbortError');
      const words = await this.chunk(c);
      let from = 0;
      for (let z = 0; z < c.shape[2]; z++)
        for (let y = 0; y < c.shape[1]; y++) {
          const to =
            ((z + c.start[2]) * dims[1] + y + c.start[1]) * dims[0] +
            c.start[0];
          out.set(words.subarray(from, from + c.shape[0]), to);
          from += c.shape[0];
        }
    }
    if (verifyWholeHash && (await sha256(out)) !== this.manifest.volume.sha256)
      throw new Error('Complete native volume checksum mismatch.');
    return out;
  }
}
export async function openChunkedReader(
  descriptor: PackageSourceDescriptor,
  cacheBytes = 64 * 1024 * 1024,
): Promise<ChunkedReader> {
  let readEntry: (name: string, expected?: number) => Promise<Uint8Array>;
  let source: Pick<ByteSource, 'bytesRead'>;
  if ('files' in descriptor) {
    source = { bytesRead: 0 };
    readEntry = async (name, expected) => {
      const file = descriptor.files[name];
      if (
        !file ||
        (expected !== undefined && file.size !== expected) ||
        (expected === undefined && file.size > 2 * 1024 * 1024)
      )
        throw new Error(`Missing or invalid package file ${name}.`);
      source.bytesRead += file.size;
      return new Uint8Array(await file.arrayBuffer());
    };
  } else {
    const bytes =
      'url' in descriptor
        ? await httpSource(descriptor.url)
        : blobSource(descriptor.blob);
    source = bytes;
    const index = await readZipIndex(bytes);
    const entries = new Map(index.map((e) => [e.name, e]));
    if (entries.size !== index.length)
      throw new Error('Duplicate ZIP entries in scan package.');
    readEntry = async (name, expected) => {
      const entry = entries.get(name);
      if (
        !entry ||
        (expected !== undefined && entry.size !== expected) ||
        (expected === undefined && entry.size > 2 * 1024 * 1024)
      )
        throw new Error(`Missing or invalid package entry ${name}.`);
      if (
        name.endsWith('.zst') &&
        (entry.method !== 0 || entry.size !== entry.compressedSize)
      )
        throw new Error(
          'Zstd chunks must be stored without outer ZIP compression.',
        );
      return readZipEntry(bytes, entry);
    };
  }
  const manifest = parseChunkedManifest(
    new TextDecoder().decode(await readEntry('cbct-scan.json')),
  );
  return new ChunkedReader(manifest, readEntry, source, cacheBytes);
}
