import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScanFolderSourceKind, type LoadedVolume, type Vec3, VolumeAxis } from '../../types';
import { scanPackageFormatAdapter } from './adapters/package';
import { expandArchiveEntries } from './archive';
import { importDataSources, scanFolderDataSource } from './dataSource';
import {
  anonymousScanName,
  buildScanPackageFiles,
  chooseScanPackageLevel,
  SCAN_PACKAGE_HALF_VOLUME,
  downsampleVolumeHalf,
  parseScanPackageManifest,
  SCAN_PACKAGE_MANIFEST,
  SCAN_PACKAGE_PADDING,
  scanPackageFileName,
  shuffleInt16Bytes,
  unshuffleInt16Bytes,
} from './scanPackage';

function makeVolume(dimensions: Vec3, fill: (x: number, y: number, z: number) => number): LoadedVolume {
  const [w, h, d] = dimensions;
  const voxels = new Int16Array(w * h * d);
  for (let z = 0; z < d; z += 1)
    for (let y = 0; y < h; y += 1)
      for (let x = 0; x < w; x += 1) voxels[(z * h + y) * w + x] = fill(x, y, z);
  return {
    voxels,
    histogram: new Uint32Array(0),
    meta: {
      format: 'onevolume',
      formatLabel: 'OneVolume CT',
      scanId: 'CT_20260414110156',
      dimensions,
      spacing: [0.125, 0.125, 0.125],
      scalarRange: [-1000, 3000],
      initialWindowLevel: { window: 4000, level: 1000 },
      sliceCount: d,
      bytesPerVoxel: 2,
      headerFileName: 'Jane Doe/CT_0.vol',
      slicePrefix: 'private/path',
      sliceFiles: ['private/path/CT_0.vol'],
      nativeAxis: VolumeAxis.Axial,
    },
  };
}

async function importZip(bytes: Uint8Array, packageLevel?: 'auto' | 'full' | 'half') {
  const file = new File([bytes as Uint8Array<ArrayBuffer>], 'scan.cbct.zip', { type: 'application/zip' });
  const source = await expandArchiveEntries({
    kind: ScanFolderSourceKind.FileList,
    label: 'scan.cbct.zip',
    entries: [{ name: file.name, relativePath: file.name, file }],
  });
  expect(scanPackageFormatAdapter.matches(source)).toBe(true);
  return scanPackageFormatAdapter.parse(source, { packageLevel });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CBCTer scan package', () => {
  const volume = makeVolume([6, 5, 4], (x, y, z) =>
    x === 0 ? SCAN_PACKAGE_PADDING : x * 100 + y * 10 + z - 500,
  );

  it('round-trips voxels and geometry through zip and the import adapter', async () => {
    const { files, manifest } = buildScanPackageFiles(volume, {
      name: 'CT_20260414110156',
      windowLevel: { window: 2000, level: 400 },
      createdAt: new Date('2026-10-04T00:00:00Z'),
    });
    const parsed = await importZip(zipSync(files));
    const loaded = parsed.loaded!;
    expect(loaded.volume.meta.format).toBe('cbct-package');
    expect(loaded.volume.meta.dimensions).toEqual([6, 5, 4]);
    expect(loaded.volume.meta.spacing).toEqual([0.125, 0.125, 0.125]);
    expect(loaded.volume.meta.initialWindowLevel).toEqual({ window: 2000, level: 400 });
    expect(Array.from(loaded.volume.voxels)).toEqual(Array.from(volume.voxels));
    expect(manifest.volume.paddingValue).toBe(SCAN_PACKAGE_PADDING);
    // Padding is excluded from the value range.
    expect(loaded.volume.meta.scalarRange[0]).toBeGreaterThan(-1000);
    expect(loaded.prepared3D).toBeTruthy();
  });

  it('byte-shuffles voxels losslessly', () => {
    const values = Int16Array.from([0, 1, -1, 32767, -32768, 1234, -4321]);
    const shuffled = shuffleInt16Bytes(values);
    // Low bytes first, then high bytes.
    expect(Array.from(shuffled.slice(0, 3))).toEqual([0, 1, 255]);
    expect(Array.from(unshuffleInt16Bytes(shuffled))).toEqual(Array.from(values));
  });

  it('still reads unshuffled (raw) volumes', async () => {
    const { files, manifest } = buildScanPackageFiles(volume, {
      name: 'x',
      windowLevel: { window: 1, level: 0 },
      contents: 'full',
    });
    const rawManifest = { ...manifest, volume: { ...manifest.volume, encoding: 'raw' } };
    const parsed = await importZip(
      zipSync({
        ...files,
        [SCAN_PACKAGE_MANIFEST]: strToU8(JSON.stringify(rawManifest)),
        'volume.i16': new Uint8Array(volume.voxels.buffer.slice(0)),
      }),
    );
    expect(Array.from(parsed.loaded!.volume.voxels)).toEqual(Array.from(volume.voxels));
  });

  it('writes no source paths or vendor headers', () => {
    const { files } = buildScanPackageFiles(volume, {
      name: 'CT_20260414110156',
      windowLevel: { window: 2000, level: 400 },
    });
    expect(Object.keys(files).sort()).toEqual([
      SCAN_PACKAGE_MANIFEST,
      SCAN_PACKAGE_HALF_VOLUME,
      'volume.i16',
    ]);
    const text = new TextDecoder().decode(files[SCAN_PACKAGE_MANIFEST]);
    expect(text).not.toMatch(/Jane Doe|private|CT_0\.vol/);
  });

  it('halves resolution with padding-aware 2×2×2 averaging', () => {
    const { voxels, dimensions } = downsampleVolumeHalf(volume.voxels, [6, 5, 4]);
    expect(dimensions).toEqual([3, 2, 2]);
    // Block x∈{0,1}: x=0 is padding, so only the x=1 voxels are averaged.
    expect(voxels[0]).toBe(Math.round((100 + 110 + 101 + 111 - 2000) / 4));
    const { manifest } = buildScanPackageFiles(volume, {
      name: 'x',
      windowLevel: { window: 1, level: 0 },
      contents: 'half',
    });
    expect(manifest.volume.spacing).toEqual([0.25, 0.25, 0.25]);
    expect(manifest.resolution).toBe('half');
    expect(manifest.levels).toBeUndefined();
  });

  it('keeps all-padding blocks as padding', () => {
    const padded = new Int16Array(8).fill(SCAN_PACKAGE_PADDING);
    expect(downsampleVolumeHalf(padded, [2, 2, 2]).voxels[0]).toBe(SCAN_PACKAGE_PADDING);
  });

  it('rejects packages with the wrong size or format', async () => {
    const { files } = buildScanPackageFiles(volume, {
      name: 'x',
      windowLevel: { window: 1, level: 0 },
      contents: 'full',
    });
    await expect(
      importZip(zipSync({ ...files, 'volume.i16': new Uint8Array(10) })),
    ).rejects.toThrow(/expected 240/);
    expect(() => parseScanPackageManifest('{"format":"other"}')).toThrow(/Not a CBCTer/);
    expect(() => parseScanPackageManifest('nope')).toThrow(/not valid JSON/);
    expect(unzipSync(zipSync({ a: strToU8('x') })).a).toBeTruthy();
  });

  it('carries full resolution and a phone level in one package by default', async () => {
    const { files, manifest } = buildScanPackageFiles(volume, {
      name: 'CT_1',
      windowLevel: { window: 2000, level: 400 },
    });
    expect(manifest.resolution).toBe('full');
    expect(manifest.levels?.map((level) => [level.id, level.file, level.dimensions])).toEqual([
      ['half', SCAN_PACKAGE_HALF_VOLUME, [3, 2, 2]],
    ]);
    const zipped = zipSync(files);

    const full = (await importZip(zipped, 'full')).loaded!.volume;
    expect(full.meta.dimensions).toEqual([6, 5, 4]);
    expect(full.meta.packageLevel).toBe('full');
    expect(full.meta.packageLevels?.map((level) => level.id)).toEqual(['full', 'half']);
    expect(Array.from(full.voxels)).toEqual(Array.from(volume.voxels));

    const half = (await importZip(zipped, 'half')).loaded!.volume;
    expect(half.meta.dimensions).toEqual([3, 2, 2]);
    expect(half.meta.spacing).toEqual([0.25, 0.25, 0.25]);
    expect(half.meta.packageLevel).toBe('half');
    expect(Array.from(half.voxels)).toEqual(
      Array.from(downsampleVolumeHalf(volume.voxels, [6, 5, 4]).voxels),
    );
  });

  it('auto-selects the phone level on light devices only', () => {
    const { manifest } = buildScanPackageFiles(volume, {
      name: 'x',
      windowLevel: { window: 1, level: 0 },
    });
    expect(chooseScanPackageLevel(manifest, 'auto', false).id).toBe('full');
    expect(chooseScanPackageLevel(manifest, 'auto', true).id).toBe('half');
    expect(chooseScanPackageLevel(manifest, 'full', true).id).toBe('full');
    // A single-level package opens its only level whatever is asked.
    const fullOnly = buildScanPackageFiles(volume, {
      name: 'x',
      windowLevel: { window: 1, level: 0 },
      contents: 'full',
    }).manifest;
    expect(chooseScanPackageLevel(fullOnly, 'half', true).id).toBe('full');
  });

  it('reads only the requested level out of the zip', async () => {
    // A few MB of incompressible voxels, so the zip is far larger than the
    // fixed-size tail the reader scans for the central directory.
    let seed = 0x9e3779b9;
    const noisy = makeVolume([128, 128, 96], () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) % 4000) - 1000;
    });
    const { files } = buildScanPackageFiles(noisy, {
      name: 'x',
      windowLevel: { window: 1, level: 0 },
    });
    const zipped = zipSync(files, { level: 1 });
    let bytesRead = 0;
    const originalSlice = Blob.prototype.slice;
    vi.spyOn(Blob.prototype, 'slice').mockImplementation(function (
      this: Blob,
      start?: number,
      end?: number,
      type?: string,
    ) {
      const part = originalSlice.call(this, start, end, type);
      bytesRead += part.size;
      return part;
    });
    const half = (await importZip(zipped, 'half')).loaded!.volume;
    expect(half.meta.dimensions).toEqual([64, 64, 48]);
    // The full level (most of the zip) was never read.
    expect(bytesRead).toBeLessThan(zipped.length * 0.25);
  });

  it('keeps package zips zipped through the full import pipeline', async () => {
    const { files } = buildScanPackageFiles(volume, {
      name: 'x',
      windowLevel: { window: 1, level: 0 },
    });
    const file = new File([zipSync(files) as Uint8Array<ArrayBuffer>], 'scan.cbct.zip');
    const { source } = await importDataSources(
      scanFolderDataSource({
        kind: ScanFolderSourceKind.FileList,
        label: file.name,
        entries: [{ name: file.name, relativePath: file.name, file }],
      }),
    );
    expect(source.entries).toHaveLength(1);
    expect(source.entries[0].archiveKind).toBe('cbct-package');
    expect(scanPackageFormatAdapter.matches(source)).toBe(true);
  });

  it('never uses a free-text scan id as the file name', () => {
    expect(anonymousScanName('CT_20250826132733')).toBe('CT_20250826132733');
    expect(anonymousScanName('000778_Jane Doe_2026', new Date('2026-10-04T00:00:00Z'))).toBe(
      'CBCT_20261004',
    );
    expect(scanPackageFileName('CT_20250826132733')).toBe('CT_20250826132733.cbct.zip');
  });
});
