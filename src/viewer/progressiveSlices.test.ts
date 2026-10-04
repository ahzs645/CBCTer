import { describe, expect, it } from 'vitest';
import { VolumeAxis, type LoadedVolume, type Vec3 } from '../types';
import {
  extractAxialImage,
  extractCoronalImage,
  extractSagittalImage,
} from '../lib/volume';
import {
  displaySample,
  displayVoxels,
  type NativeVoxelMetadata,
} from '../lib/volume/native';
import { buildChunkedPackage } from '../lib/import/chunked/package';
import { openChunkedReader } from '../lib/import/chunked/reader';
import {
  planeRegion,
  renderNativePlane,
  renderPreviewPlane,
} from './progressiveSlices';
const dims: Vec3 = [9, 7, 5],
  cursor = { x: 3, y: 5, z: 3 },
  wl = { window: 4096, level: 1000 };
const m: NativeVoxelMetadata = {
  dimensions: dims,
  spacing: [0.125, 0.16, 0.2],
  dtype: 'uint16',
  bitsStored: 12,
  highBit: 11,
  paddingValue: 65535,
  origin: [-1, -2, -3],
  direction: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  coordinateSystem: 'LPS',
  representation: 'native',
  calibration: { divisor: 1, slope: 1, intercept: -1024 },
};
const raw = new Uint16Array(dims.reduce((a, b) => a * b, 1));
for (let i = 0; i < raw.length; i++) raw[i] = i * 13;
const volume: LoadedVolume = {
  voxels: displayVoxels(raw, m),
  native: { voxels: raw, metadata: m },
  histogram: new Uint32Array(),
  meta: {
    dimensions: dims,
    spacing: m.spacing,
    format: 'dicom',
    formatLabel: 'DICOM',
    scanId: '',
    scalarRange: [-1024, 3071],
    initialWindowLevel: wl,
    sliceCount: 5,
    bytesPerVoxel: 2,
    headerFileName: '',
    slicePrefix: '',
    sliceFiles: [],
  },
};
const extractors = {
  [VolumeAxis.Axial]: extractAxialImage,
  [VolumeAxis.Coronal]: extractCoronalImage,
  [VolumeAxis.Sagittal]: extractSagittalImage,
};
describe('progressive native planes', () => {
  it('renders all native planes exactly like the full dense renderer at odd indices', async () => {
    const packed = await buildChunkedPackage(volume, {
      name: 'planes',
      windowLevel: wl,
    });
    const reader = await openChunkedReader({ blob: packed.blob });
    for (const axis of Object.values(VolumeAxis)) {
      const { start, shape } = planeRegion(axis, cursor, dims);
      const words = await reader.region(start, shape);
      expect(renderNativePlane(axis, words, shape, m, wl)).toEqual(
        extractors[axis](volume, cursor, wl),
      );
    }
  });
  it('aligns preview pixels with the native grid including reversed Z and odd edges', async () => {
    const packed = await buildChunkedPackage(volume, {
      name: 'preview',
      windowLevel: wl,
    });
    const r = await openChunkedReader({ blob: packed.blob });
    const p = r.manifest.preview;
    const preview: LoadedVolume = {
      ...volume,
      voxels: await r.preview(),
      meta: { ...volume.meta, dimensions: p.dimensions, spacing: p.spacing },
    };
    for (const axis of Object.values(VolumeAxis)) {
      const image = renderPreviewPlane(axis, preview, cursor, dims, wl);
      expect(image.displayAspect).toBe(
        m.spacing[axis === VolumeAxis.Sagittal ? 1 : 0] /
          m.spacing[axis === VolumeAxis.Axial ? 1 : 2],
      );
      for (let y = 0; y < image.height; y++)
        for (let x = 0; x < image.width; x++) {
          const index =
            axis === VolumeAxis.Axial
              ? [x, y, cursor.z]
              : axis === VolumeAxis.Coronal
                ? [x, cursor.y, dims[2] - 1 - y]
                : [cursor.x, x, dims[2] - 1 - y];
          const sample = index.map((n) => 2 * Math.floor(n / 2));
          const v =
            volume.voxels[
              (sample[2] * dims[1] + sample[1]) * dims[0] + sample[0]
            ];
          expect(image.data[(y * image.width + x) * 4]).toBe(
            Math.round(
              Math.max(
                0,
                Math.min(1, (v - (wl.level - wl.window / 2)) / wl.window),
              ) * 255,
            ),
          );
        }
    }
  });
  it('interprets stored bit placement and signed samples without altering raw words', () => {
    expect(
      displaySample(0xf800, {
        ...m,
        dtype: 'int16',
        calibration: { divisor: 1, slope: 1, intercept: 0 },
      }),
    ).toBe(-2048);
    expect(
      displaySample(0xabc0, {
        ...m,
        highBit: 15,
        calibration: { divisor: 1, slope: 1, intercept: 0 },
      }),
    ).toBe(0xabc);
    expect(displaySample(65535, m)).toBe(-32768);
    expect(displaySample(4101, m)).toBe(-1019);
  });
});
