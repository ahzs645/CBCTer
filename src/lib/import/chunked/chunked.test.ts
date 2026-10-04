import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { VolumeAxis, type LoadedVolume, type Vec3 } from '../../../types';
import { displayVoxels } from '../../volume/native';
import { buildChunkedPackage } from './package';
import { openChunkedReader } from './reader';
import { parseChunkedManifest } from './manifest';
import { sha256 } from './codec';
export function makeNativeVolume(
  dimensions: Vec3 = [129, 67, 65],
  unsigned = false,
): LoadedVolume {
  const words = unsigned
    ? new Uint16Array(dimensions.reduce((a, b) => a * b, 1))
    : new Int16Array(dimensions.reduce((a, b) => a * b, 1));
  for (let i = 0; i < words.length; i++) words[i] = i * 1837;
  const native = {
    voxels: words,
    metadata: {
      dimensions,
      spacing: [0.125, 0.16, 0.2] as Vec3,
      dtype: unsigned ? ('uint16' as const) : ('int16' as const),
      bitsStored: 16,
      paddingValue: unsigned ? null : -32768,
      origin: [-40, -50, 30] as Vec3,
      direction: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ] as [Vec3, Vec3, Vec3],
      coordinateSystem: 'LPS' as const,
      representation: 'native' as const,
      calibration: { divisor: 1, slope: 1, intercept: unsigned ? -32768 : 0 },
    },
  };
  return {
    native,
    voxels: displayVoxels(words, native.metadata),
    histogram: new Uint32Array(65536),
    meta: {
      dimensions,
      spacing: native.metadata.spacing,
      format: 'dicom',
      formatLabel: 'DICOM CT',
      scanId: 'test',
      scalarRange: [-32767, 32767],
      initialWindowLevel: { window: 3000, level: 600 },
      sliceCount: dimensions[2],
      bytesPerVoxel: 2,
      headerFileName: '',
      slicePrefix: '',
      sliceFiles: [],
      nativeAxis: VolumeAxis.Axial,
    },
  };
}
const options = { name: 'test', windowLevel: { window: 3000, level: 600 } };
describe('native chunked scan packages', () => {
  it.each([false, true])(
    'round-trips every signed/unsigned word, odd edges and physical geometry (%s)',
    async (unsigned) => {
      const volume = makeNativeVolume(undefined, unsigned);
      const packed = await buildChunkedPackage(volume, options);
      const reader = await openChunkedReader({ blob: packed.blob }, 512 * 1024);
      expect(reader.manifest.volume.origin).toEqual([-40, -50, 30]);
      expect(reader.manifest.volume.dtype).toBe(unsigned ? 'uint16' : 'int16');
      expect(reader.manifest.preview.dimensions).toEqual([65, 34, 33]);
      const restored = await reader.materialize();
      expect(await sha256(restored)).toBe(await sha256(volume.native!.voxels));
      const preview = await reader.preview();
      expect(preview[0]).toBe(volume.voxels[0]);
      expect(reader.stats().cacheBytes).toBeLessThanOrEqual(512 * 1024);
    },
  );
  it('reads an unaligned region across block boundaries without loading the full array', async () => {
    const volume = makeNativeVolume([193, 129, 129]);
    const packed = await buildChunkedPackage(volume, options);
    const r = await openChunkedReader({ blob: packed.blob }, 2 * 512 * 1024);
    const before = r.stats().bytesRead;
    const start: Vec3 = [61, 62, 63],
      shape: Vec3 = [8, 7, 6];
    const out = await r.region(start, shape);
    let i = 0;
    for (let z = 0; z < shape[2]; z++)
      for (let y = 0; y < shape[1]; y++)
        for (let x = 0; x < shape[0]; x++)
          expect(out[i++]).toBe(
            volume.native!.voxels[((z + 63) * 129 + y + 62) * 193 + x + 61],
          );
    expect(r.stats().decodedChunks).toBe(8);
    expect(r.stats().bytesRead - before).toBeLessThan(packed.blob.size);
    expect(r.stats().cacheBytes).toBeLessThanOrEqual(r.cacheLimitBytes);
    const count = r.stats().decodedChunks;
    await r.region([128, 128, 128], [1, 1, 1]);
    await r.region([128, 128, 128], [1, 1, 1]);
    expect(r.stats().decodedChunks).toBe(count + 1);
    expect(r.stats().cacheHits).toBeGreaterThan(0);
  });
  it('rejects missing coverage, invalid calibration, changed raw hashes and truncated ZIP data', async () => {
    const packed = await buildChunkedPackage(
      makeNativeVolume([9, 7, 5]),
      options,
    );
    const badIdentity = { ...packed.manifest, name: { unexpected: 'object' } };
    expect(() => parseChunkedManifest(JSON.stringify(badIdentity))).toThrow(
      /identity/,
    );
    const missing = structuredClone(packed.manifest);
    missing.volume.chunks = [];
    expect(() => parseChunkedManifest(JSON.stringify(missing))).toThrow(
      /coverage|descriptors/,
    );
    const bad = structuredClone(packed.manifest);
    bad.volume.calibration.divisor = 0;
    expect(() => parseChunkedManifest(JSON.stringify(bad))).toThrow(/metadata/);
    const files = unzipSync(new Uint8Array(await packed.blob.arrayBuffer()));
    bad.volume.calibration.divisor = 1;
    bad.volume.chunks[0].sha256 = '0'.repeat(64);
    files['cbct-scan.json'] = new TextEncoder().encode(JSON.stringify(bad));
    const repacked = zipSync(
      Object.fromEntries(
        Object.entries(files).map(([n, b]) => [n, [b, { level: 0 }]]),
      ),
    );
    const reader = await openChunkedReader({
      blob: new Blob([repacked as Uint8Array<ArrayBuffer>]),
    });
    await expect(reader.region([0, 0, 0], [1, 1, 1])).rejects.toThrow(
      /checksum/,
    );
    await expect(
      openChunkedReader({ blob: packed.blob.slice(0, -12) }),
    ).rejects.toThrow();
  });
});
