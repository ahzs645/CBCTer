/// <reference types="node" />
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  ScanFolderSourceKind,
  type ScanFolderSource,
  type LoadedVolume,
} from '../../types';
import { parseDicomFolder } from './adapters/dicom/parser';
import { parseOneVolumeFolder } from './adapters/onevolume/parser';
import { assembleDicomVolume } from '../../workers/volume/assemble/dicom';
import { assembleOneVolumeVolume } from '../../workers/volume/assemble/onevolume';
import { buildChunkedPackage } from './chunked/package';
import { openChunkedReader } from './chunked/reader';
const root = process.env.CBCTER_BENCHMARK_ROOT;
const output = process.env.CBCTER_VALIDATION_OUT;
const hash = (words: Int16Array | Uint16Array) =>
  createHash('sha256')
    .update(new Uint8Array(words.buffer, words.byteOffset, words.byteLength))
    .digest('hex');
function entry(path: string, name: string) {
  return {
    name,
    relativePath: name,
    file: new File([readFileSync(path)], name),
  };
}
async function verify(name: string, volume: LoadedVolume, expected: string) {
  expect(volume.native).toBeDefined();
  expect(hash(volume.native!.voxels)).toBe(expected);
  const started = performance.now();
  const packed = await buildChunkedPackage(volume, {
    name: `CBCT validation ${name}`,
    windowLevel: volume.meta.initialWindowLevel,
  });
  const encodeMs = performance.now() - started;
  const reader = await openChunkedReader({ blob: packed.blob });
  const roiReader = await openChunkedReader({ blob: packed.blob });
  const start = volume.native!.metadata.dimensions.map(
      (n) => Math.floor(n / 2) - 23,
    ) as [number, number, number],
    shape: [number, number, number] = [64, 64, 64];
  const before = roiReader.stats().bytesRead,
    roiStart = performance.now();
  const region = await roiReader.region(start, shape),
    roiMs = performance.now() - roiStart;
  const original = volume.native!.voxels,
    dims = volume.native!.metadata.dimensions;
  const reference =
    original instanceof Int16Array
      ? new Int16Array(64 ** 3)
      : new Uint16Array(64 ** 3);
  let target = 0;
  for (let z = 0; z < 64; z++)
    for (let y = 0; y < 64; y++) {
      const from =
        ((z + start[2]) * dims[1] + y + start[1]) * dims[0] + start[0];
      reference.set(original.subarray(from, from + 64), target);
      target += 64;
    }
  expect(hash(region)).toBe(hash(reference));
  const roiBytes = roiReader.stats().bytesRead - before;
  expect(roiBytes).toBeLessThan(packed.blob.size * 0.1);
  const t = performance.now();
  expect(hash(await reader.materialize())).toBe(expected);
  const result = {
    name,
    dimensions: packed.manifest.volume.dimensions,
    nativeBytes: volume.native!.voxels.byteLength,
    packageBytes: packed.blob.size,
    chunks: packed.manifest.volume.chunks.length,
    encodeMs,
    roiMs,
    roiBytes,
    decodeMs: performance.now() - t,
    sha256: expected,
  };
  if (output) {
    mkdirSync(output, { recursive: true });
    writeFileSync(
      `${output}/${name}.cbct.zip`,
      new Uint8Array(await packed.blob.arrayBuffer()),
    );
    writeFileSync(`${output}/${name}.json`, JSON.stringify(result, null, 2));
  }
}
describe.skipIf(!root)('authorized native examples', () => {
  it('imports and round-trips all 512 native Sidexis slices through the actual v2 writer/reader', async () => {
    vi.stubGlobal('postMessage', () => {});
    try {
      const source: ScanFolderSource = {
        kind: ScanFolderSourceKind.FileList,
        label: 'native Sidexis',
        entries: readdirSync(`${root}/vendor/sidexis-ct3`).map((name) =>
          entry(`${root}/vendor/sidexis-ct3/${name}`, `${name}.dcm`),
        ),
      };
      const parsed = await parseDicomFolder(source);
      expect(parsed.meta.dimensions).toEqual([512, 512, 512]);
      expect(parsed.meta.sliceFiles).toHaveLength(512);
      const files = await Promise.all(
        source.entries.map(async (e) => ({
          name: e.name,
          path: e.relativePath!,
          buffer: await e.file.arrayBuffer(),
        })),
      );
      const loaded = await assembleDicomVolume({ meta: parsed.meta, files });
      expect(loaded.native!.metadata.calibration).toEqual({
        divisor: 1,
        slope: 1,
        intercept: -1024,
      });
      expect(loaded.native!.metadata.bitsStored).toBe(12);
      await verify(
        'sidexis',
        loaded,
        'e5c022d44347e61b1e090b0275c179c060f947b1b55549fbcdf4635d1a5ad9f3',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  }, 120000);
  it('preserves every native OneVolume bound and raw word independently of display cropping', async () => {
    vi.stubGlobal('postMessage', () => {});
    try {
      const source: ScanFolderSource = {
        kind: ScanFolderSourceKind.FileList,
        label: 'native OneVolume',
        entries: [
          entry(`${root}/vendor/onevolume.vol`, 'CT_0.vol'),
          entry(`${root}/vendor/constants.xml`, 'Constants1100.xml'),
        ],
      };
      const parsed = await parseOneVolumeFolder(source);
      const files = await Promise.all(
        source.entries.map(async (e) => ({
          name: e.name,
          path: e.relativePath!,
          buffer: await e.file.arrayBuffer(),
        })),
      );
      const loaded = await assembleOneVolumeVolume({
        meta: parsed.meta,
        files,
      });
      expect(loaded.native!.metadata.dimensions).toEqual([341, 341, 344]);
      expect(loaded.native!.metadata.calibration).toEqual({
        divisor: 1000,
        slope: 190,
        intercept: -400,
      });
      await verify(
        'onevolume',
        loaded,
        '3d833e4447700727d435f3c7d751ac826721e73378c9a7dd2a3bb1666a383c1e',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  }, 120000);
});
