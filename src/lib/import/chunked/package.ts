import { zipSync, type Zippable } from 'fflate';
import { VolumeAxis, type LoadedVolume, type Vec3 } from '../../../types';
import { displaySample, type NativeVoxelVolume } from '../../volume/native';
import type { ScanPackageOptions } from '../scanPackage';
import { encodeChunk, sha256 } from './codec';
import {
  blockDescriptors,
  parseChunkedManifest,
  type ChunkedManifest,
} from './manifest';
export async function buildChunkedPackage(
  volume: Pick<LoadedVolume, 'voxels' | 'meta' | 'native'>,
  options: ScanPackageOptions,
): Promise<{ blob: Blob; manifest: ChunkedManifest }> {
  if (options.contents === 'half')
    throw new Error(
      'A streamable package includes the full volume and a preview. Use classic format for a preview-only export.',
    );
  const native: NativeVoxelVolume = volume.native ?? {
    voxels: volume.voxels,
    metadata: {
      dimensions: volume.meta.dimensions,
      spacing: volume.meta.spacing,
      dtype: 'int16',
      bitsStored: 16,
      paddingValue: volume.voxels.includes(-32768) ? -32768 : null,
      origin: [0, 0, 0],
      direction: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      coordinateSystem: 'unknown',
      representation: 'processed',
      calibration: { divisor: 1, slope: 1, intercept: 0 },
    },
  };
  const { metadata: m, voxels } = native;
  const [w, h, d] = m.dimensions;
  if (voxels.length !== w * h * d)
    throw new Error('Native voxel count does not match source geometry.');
  if ((m.dtype === 'int16') !== voxels instanceof Int16Array)
    throw new Error('Native voxel type does not match metadata.');
  let displayMin = Infinity,
    displayMax = -Infinity;
  const files: Zippable = {};
  const chunks: ChunkedManifest['volume']['chunks'] = [];
  for (const { start, shape } of blockDescriptors(m.dimensions)) {
    const words =
      m.dtype === 'int16'
        ? new Int16Array(shape[0] * shape[1] * shape[2])
        : new Uint16Array(shape[0] * shape[1] * shape[2]);
    let out = 0;
    for (let z = 0; z < shape[2]; z++)
      for (let y = 0; y < shape[1]; y++) {
        const from = ((z + start[2]) * h + y + start[1]) * w + start[0];
        words.set(voxels.subarray(from, from + shape[0]), out);
        out += shape[0];
      }
    for (const raw of words) {
      const value = displaySample(raw, m);
      if (value !== -32768) {
        displayMin = Math.min(displayMin, value);
        displayMax = Math.max(displayMax, value);
      }
    }
    const encoded = await encodeChunk(words, shape[0]);
    const file = `chunks/${chunks.length}.zst`;
    // Already-compressed Zstd streams are ZIP-stored for independent reads.
    files[file] = [encoded, { level: 0 }];
    chunks.push({
      file,
      start,
      shape,
      bytes: encoded.length,
      sha256: await sha256(words),
    });
  }
  const dimensions = m.dimensions.map((n) => Math.ceil(n / 2)) as Vec3;
  const preview = new Int16Array(dimensions[0] * dimensions[1] * dimensions[2]);
  for (let z = 0; z < dimensions[2]; z++)
    for (let y = 0; y < dimensions[1]; y++)
      for (let x = 0; x < dimensions[0]; x++) {
        preview[(z * dimensions[1] + y) * dimensions[0] + x] = displaySample(
          voxels[(2 * z * h + 2 * y) * w + 2 * x],
          m,
        );
      }
  const manifest: ChunkedManifest = {
    format: 'cbcter-scan',
    version: 2,
    name: options.name,
    createdAt: (options.createdAt ?? new Date()).toISOString(),
    generator: 'CBCTer',
    source: {
      format: volume.meta.format,
      formatLabel: volume.meta.formatLabel,
    },
    volume: {
      ...m,
      byteOrder: 'little-endian',
      layout: 'x-fastest',
      blockSize: [64, 64, 64],
      codec: 'zstd',
      filter: 'x-delta-byte-shuffle',
      sha256: await sha256(voxels),
      chunks,
    },
    preview: {
      file: 'preview.i16',
      dimensions,
      spacing: m.spacing.map((n) => 2 * n) as Vec3,
      dtype: 'int16',
      encoding: 'raw',
      sha256: await sha256(preview),
      sampling: 'nearest',
      step: 2,
    },
    display: options.windowLevel,
    scalarRange: Number.isFinite(displayMin)
      ? [displayMin, displayMax]
      : volume.meta.scalarRange,
    orientation: {
      nativeAxis: volume.meta.nativeAxis ?? VolumeAxis.Axial,
      ...(volume.meta.patientAxes
        ? { patientAxes: volume.meta.patientAxes }
        : {}),
    },
  };
  parseChunkedManifest(JSON.stringify(manifest));
  files['preview.i16'] = [new Uint8Array(preview.buffer), { level: 6 }];
  if (options.previewPng)
    files['preview.png'] = [options.previewPng, { level: 0 }];
  files['cbct-scan.json'] = [
    new TextEncoder().encode(JSON.stringify(manifest)),
    { level: 6 },
  ];
  const data = zipSync(files, { level: 0 });
  return {
    blob: new Blob([data as Uint8Array<ArrayBuffer>], {
      type: 'application/zip',
    }),
    manifest,
  };
}
