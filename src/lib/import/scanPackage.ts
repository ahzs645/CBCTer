import type {
  LoadedVolume,
  ParsedVolumeMeta,
  PatientAxes,
  SliceWindowLevel,
  Vec3,
} from '../../types';
import { VolumeAxis } from '../../types';
import {
  buildScalarHistogram,
  resolveScalarRange,
} from '../../workers/volume/scalars';

/**
 * CBCTer scan package (`*.cbct.zip`): a slim, vendor-neutral container for a
 * reconstructed CBCT volume. A vendor export disc carries viewers,
 * installers, raw projection images and patient metadata next to the one
 * volume the app needs; the package keeps only:
 *
 *   cbct-scan.json   manifest (geometry, value range, display window, orientation)
 *   volume.i16       voxels: Int16, x fastest, then y, then z (z runs
 *                    inferior → superior), exactly the app's layout. Stored
 *                    byte-shuffled (all low bytes, then all high bytes),
 *                    which deflates ~15–20% smaller than interleaved
 *                    little-endian on noisy CBCT data
 *   volume-half.i16  optional phone level: the same scan averaged 2×2×2
 *                    (1/8 of the data), listed in the manifest's `levels`
 *   preview.png      optional axial thumbnail at the crosshair
 *
 * One package can therefore carry full resolution for desktops and a light
 * level for phones; the importer reads only the level it opens (see
 * `chooseScanPackageLevel` and the random-access reader in `zipIndex.ts`).
 *
 * No patient name, IDs, dates of birth, file paths or vendor headers are
 * written. Packages open directly in the app (folder or ZIP import) without
 * the per-vendor parsers.
 */

export const SCAN_PACKAGE_FORMAT = 'cbcter-scan';
export const SCAN_PACKAGE_VERSION = 1;
export const SCAN_PACKAGE_MANIFEST = 'cbct-scan.json';
export const SCAN_PACKAGE_VOLUME = 'volume.i16';
export const SCAN_PACKAGE_HALF_VOLUME = 'volume-half.i16';
export const SCAN_PACKAGE_PREVIEW = 'preview.png';
export const SCAN_PACKAGE_EXTENSION = '.cbct.zip';
/** OneVolume marks voxels outside the reconstructed cylinder with this value. */
export const SCAN_PACKAGE_PADDING = -32768;

export type ScanPackageResolution = 'full' | 'half';
/** What a package carries: both levels (default), or just one. */
export type ScanPackageContents = 'full+half' | 'full' | 'half';
/** Which level to open: `auto` = phone level on light devices, else full. */
export type ScanPackageLevelPreference = 'auto' | ScanPackageResolution;
/**
 * `byte-shuffle`: the N low bytes of all voxels, then the N high bytes.
 * `raw`: plain interleaved little-endian Int16.
 */
export type ScanPackageEncoding = 'byte-shuffle' | 'raw';

export function shuffleInt16Bytes(voxels: Int16Array): Uint8Array {
  const bytes = new Uint8Array(voxels.buffer, voxels.byteOffset, voxels.byteLength);
  const count = voxels.length;
  const out = new Uint8Array(count * 2);
  for (let index = 0; index < count; index += 1) {
    out[index] = bytes[index * 2];
    out[count + index] = bytes[index * 2 + 1];
  }
  return out;
}

export function unshuffleInt16Bytes(bytes: Uint8Array): Int16Array {
  const count = bytes.length / 2;
  const out = new Uint8Array(bytes.length);
  for (let index = 0; index < count; index += 1) {
    out[index * 2] = bytes[index];
    out[index * 2 + 1] = bytes[count + index];
  }
  return new Int16Array(out.buffer);
}

export interface ScanPackageManifest {
  format: typeof SCAN_PACKAGE_FORMAT;
  version: number;
  name: string;
  createdAt: string;
  generator: string;
  source: {
    format: string;
    formatLabel: string;
  };
  volume: {
    file: string;
    dtype: 'int16';
    byteOrder: 'little-endian';
    encoding: ScanPackageEncoding;
    layout: 'x-fastest';
    dimensions: Vec3;
    spacing: Vec3;
    scalarRange: [number, number];
    paddingValue: number | null;
  };
  display: SliceWindowLevel;
  orientation: {
    nativeAxis: VolumeAxis;
    patientAxes?: PatientAxes;
  };
  /** Resolution of the primary `volume`. */
  resolution: ScanPackageResolution;
  /** Additional levels of the same scan (version 1 readers ignore them). */
  levels?: ScanPackageLevel[];
}

export interface ScanPackageLevel {
  id: ScanPackageResolution;
  file: string;
  encoding: ScanPackageEncoding;
  dimensions: Vec3;
  spacing: Vec3;
  scalarRange: [number, number];
}

/** A level as the importer sees it, whether primary or additional. */
export interface ResolvedScanPackageLevel extends ScanPackageLevel {
  paddingValue: number | null;
  primary: boolean;
}

export interface ScanPackageOptions {
  name: string;
  windowLevel: SliceWindowLevel;
  contents?: ScanPackageContents;
  createdAt?: Date;
  previewPng?: Uint8Array;
  storage?: 'classic' | 'streamable';
}

/**
 * A package name that cannot leak a patient name: keep vendor scan IDs of
 * the `CT_<digits>` form, otherwise fall back to a dated generic name.
 */
export function anonymousScanName(scanId: string, date = new Date()): string {
  const trimmed = scanId.trim();
  if (/^CT_\d{8,}$/.test(trimmed)) return trimmed;
  const stamp = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `CBCT_${stamp}`;
}

export function scanPackageFileName(name: string): string {
  const safe = name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'cbct';
  return `${safe}${SCAN_PACKAGE_EXTENSION}`;
}

/**
 * Halve every dimension by averaging 2×2×2 blocks (phone-friendly packages,
 * 1/8 of the data). Padding voxels are ignored in the average; a block that
 * is all padding stays padding.
 */
export function downsampleVolumeHalf(
  voxels: Int16Array,
  dimensions: Vec3,
  paddingValue: number | null = SCAN_PACKAGE_PADDING,
): { voxels: Int16Array; dimensions: Vec3 } {
  const [width, height, depth] = dimensions;
  const next: Vec3 = [
    Math.max(1, Math.floor(width / 2)),
    Math.max(1, Math.floor(height / 2)),
    Math.max(1, Math.floor(depth / 2)),
  ];
  const out = new Int16Array(next[0] * next[1] * next[2]);
  const plane = width * height;
  for (let z = 0; z < next[2]; z += 1) {
    for (let y = 0; y < next[1]; y += 1) {
      for (let x = 0; x < next[0]; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dz = 0; dz < 2; dz += 1) {
          const sz = Math.min(depth - 1, z * 2 + dz);
          for (let dy = 0; dy < 2; dy += 1) {
            const sy = Math.min(height - 1, y * 2 + dy);
            for (let dx = 0; dx < 2; dx += 1) {
              const sx = Math.min(width - 1, x * 2 + dx);
              const value = voxels[sz * plane + sy * width + sx];
              if (paddingValue != null && value === paddingValue) continue;
              sum += value;
              count += 1;
            }
          }
        }
        out[(z * next[1] + y) * next[0] + x] =
          count === 0 && paddingValue != null
            ? paddingValue
            : Math.round(sum / Math.max(1, count));
      }
    }
  }
  return { voxels: out, dimensions: next };
}

function hasPadding(voxels: Int16Array): boolean {
  // Padding sits outside the field of view, so it shows up in a sparse scan.
  const stride = Math.max(1, Math.floor(voxels.length / 200_000));
  for (let index = 0; index < voxels.length; index += stride) {
    if (voxels[index] === SCAN_PACKAGE_PADDING) return true;
  }
  return false;
}

/**
 * Build the package's files. Zipping is left to the caller (async in the
 * browser so the UI stays responsive, sync in tests).
 */
export function buildScanPackageFiles(
  volume: Pick<LoadedVolume, 'voxels' | 'meta'>,
  options: ScanPackageOptions,
): { manifest: ScanPackageManifest; files: Record<string, Uint8Array> } {
  const contents = options.contents ?? 'full+half';
  const paddingValue = hasPadding(volume.voxels) ? SCAN_PACKAGE_PADDING : null;
  const full = { voxels: volume.voxels, dimensions: volume.meta.dimensions };
  const half =
    contents === 'full'
      ? null
      : downsampleVolumeHalf(volume.voxels, volume.meta.dimensions, paddingValue);
  const describe = (
    id: ScanPackageResolution,
    file: string,
    level: { voxels: Int16Array; dimensions: Vec3 },
  ): ScanPackageLevel => ({
    id,
    file,
    encoding: 'byte-shuffle',
    dimensions: level.dimensions,
    spacing: volume.meta.spacing.map((value) => value * (id === 'half' ? 2 : 1)) as Vec3,
    scalarRange: resolveScalarRange(
      level.voxels,
      volume.meta.scalarRange,
      paddingValue ?? undefined,
    ),
  });

  const primaryIsHalf = contents === 'half';
  const primarySource = primaryIsHalf && half ? half : full;
  const primary = describe(primaryIsHalf ? 'half' : 'full', SCAN_PACKAGE_VOLUME, primarySource);
  const extra =
    contents === 'full+half' && half
      ? [describe('half', SCAN_PACKAGE_HALF_VOLUME, half)]
      : [];

  const manifest: ScanPackageManifest = {
    format: SCAN_PACKAGE_FORMAT,
    version: SCAN_PACKAGE_VERSION,
    name: options.name,
    createdAt: (options.createdAt ?? new Date()).toISOString(),
    generator: 'CBCTer',
    source: {
      format: volume.meta.format,
      formatLabel: volume.meta.formatLabel,
    },
    volume: {
      file: primary.file,
      dtype: 'int16',
      byteOrder: 'little-endian',
      encoding: primary.encoding,
      layout: 'x-fastest',
      dimensions: primary.dimensions,
      spacing: primary.spacing,
      scalarRange: primary.scalarRange,
      paddingValue,
    },
    display: {
      window: Math.round(options.windowLevel.window),
      level: Math.round(options.windowLevel.level),
    },
    orientation: {
      nativeAxis: volume.meta.nativeAxis ?? VolumeAxis.Axial,
      ...(volume.meta.patientAxes ? { patientAxes: volume.meta.patientAxes } : {}),
    },
    resolution: primary.id,
    ...(extra.length ? { levels: extra } : {}),
  };

  // Int16Array is little-endian on every platform browsers run on.
  const files: Record<string, Uint8Array> = {
    [SCAN_PACKAGE_MANIFEST]: new TextEncoder().encode(
      `${JSON.stringify(manifest, null, 2)}\n`,
    ),
    [SCAN_PACKAGE_VOLUME]: shuffleInt16Bytes(primarySource.voxels),
  };
  if (extra.length && half) files[SCAN_PACKAGE_HALF_VOLUME] = shuffleInt16Bytes(half.voxels);
  if (options.previewPng) files[SCAN_PACKAGE_PREVIEW] = options.previewPng;
  return { manifest, files };
}

function isVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}

export function parseScanPackageManifest(text: string): ScanPackageManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The scan package manifest is not valid JSON.');
  }
  const manifest = parsed as Partial<ScanPackageManifest>;
  if (manifest?.format !== SCAN_PACKAGE_FORMAT) {
    throw new Error('Not a CBCTer scan package (unexpected manifest format).');
  }
  if (typeof manifest.version !== 'number' || manifest.version > SCAN_PACKAGE_VERSION) {
    throw new Error(
      `Scan package version ${String(manifest.version)} is newer than this app supports.`,
    );
  }
  const volume = manifest.volume;
  if (
    !volume ||
    volume.dtype !== 'int16' ||
    volume.byteOrder !== 'little-endian' ||
    !isVec3(volume.dimensions) ||
    !isVec3(volume.spacing) ||
    volume.dimensions.some((size) => size < 1 || !Number.isInteger(size)) ||
    volume.spacing.some((size) => size <= 0) ||
    (volume.encoding != null && volume.encoding !== 'byte-shuffle' && volume.encoding !== 'raw')
  ) {
    throw new Error('The scan package manifest has invalid volume geometry.');
  }
  for (const level of manifest.levels ?? []) {
    if (
      (level.id !== 'full' && level.id !== 'half') ||
      typeof level.file !== 'string' ||
      !isVec3(level.dimensions) ||
      !isVec3(level.spacing) ||
      level.dimensions.some((size) => size < 1 || !Number.isInteger(size)) ||
      level.spacing.some((size) => size <= 0)
    ) {
      throw new Error('The scan package manifest has an invalid resolution level.');
    }
  }
  return manifest as ScanPackageManifest;
}

export function listScanPackageLevels(
  manifest: ScanPackageManifest,
): ResolvedScanPackageLevel[] {
  const paddingValue = manifest.volume.paddingValue ?? null;
  return [
    {
      id: manifest.resolution ?? 'full',
      file: manifest.volume.file,
      encoding: manifest.volume.encoding ?? 'raw',
      dimensions: manifest.volume.dimensions,
      spacing: manifest.volume.spacing,
      scalarRange: manifest.volume.scalarRange,
      paddingValue,
      primary: true,
    },
    ...(manifest.levels ?? []).map((level) => ({
      ...level,
      paddingValue,
      primary: false,
    })),
  ];
}

/**
 * Phones and low-memory devices open the light level by default; desktops
 * open full resolution. An explicit preference wins when that level exists.
 */
export function chooseScanPackageLevel(
  manifest: ScanPackageManifest,
  preference: ScanPackageLevelPreference = 'auto',
  lightDevice = false,
): ResolvedScanPackageLevel {
  const levels = listScanPackageLevels(manifest);
  const wanted: ScanPackageResolution =
    preference === 'auto' ? (lightDevice ? 'half' : 'full') : preference;
  return (
    levels.find((level) => level.id === wanted) ??
    levels.find((level) => level.primary) ??
    levels[0]
  );
}

/** Browser heuristic for "open the phone level by default". */
export function isLightDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const narrow = window.matchMedia?.('(max-width: 767px)').matches ?? false;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return narrow || (typeof memory === 'number' && memory <= 4);
}

export function scanPackageToLoadedVolume(
  manifest: ScanPackageManifest,
  voxelBuffer: ArrayBuffer,
  headerFileName = SCAN_PACKAGE_MANIFEST,
  level: ResolvedScanPackageLevel = listScanPackageLevels(manifest)[0],
): LoadedVolume {
  const { dimensions, spacing, paddingValue } = level;
  const expectedBytes = dimensions[0] * dimensions[1] * dimensions[2] * 2;
  if (voxelBuffer.byteLength !== expectedBytes) {
    throw new Error(
      `The scan package volume has ${voxelBuffer.byteLength} bytes; expected ${expectedBytes} for ${dimensions.join(' × ')} Int16 voxels.`,
    );
  }
  const voxels =
    level.encoding === 'byte-shuffle'
      ? unshuffleInt16Bytes(new Uint8Array(voxelBuffer))
      : new Int16Array(voxelBuffer);
  const scalarRange = resolveScalarRange(
    voxels,
    level.scalarRange ?? [-1024, 3071],
    paddingValue ?? undefined,
  );
  const levels = listScanPackageLevels(manifest);
  const meta: ParsedVolumeMeta = {
    format: 'cbct-package',
    formatLabel: `CBCTer package · ${manifest.source?.formatLabel ?? 'CBCT'}`,
    scanId: manifest.name || 'CBCT',
    dimensions,
    spacing,
    scalarRange,
    initialWindowLevel: manifest.display ?? {
      window: Math.max(1, scalarRange[1] - scalarRange[0]),
      level: Math.round((scalarRange[0] + scalarRange[1]) / 2),
    },
    sliceCount: dimensions[2],
    bytesPerVoxel: 2,
    headerFileName,
    slicePrefix: '',
    sliceFiles: [],
    nativeAxis: manifest.orientation?.nativeAxis ?? VolumeAxis.Axial,
    ...(manifest.orientation?.patientAxes
      ? { patientAxes: manifest.orientation.patientAxes }
      : {}),
    packageLevel: level.id,
    packageLevels: levels.map((item) => ({
      id: item.id,
      dimensions: item.dimensions,
      spacing: item.spacing,
    })),
  };
  return {
    meta,
    voxels,
    histogram: buildScalarHistogram(voxels, scalarRange),
  };
}
