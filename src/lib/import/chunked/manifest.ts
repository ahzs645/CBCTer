import {
  VolumeAxis,
  type Vec3,
  type SliceWindowLevel,
  type PatientAxes,
} from '../../../types';
import type { NativeVoxelMetadata } from '../../volume/native';
export interface ChunkInfo {
  file: string;
  start: Vec3;
  shape: Vec3;
  bytes: number;
  sha256: string;
}
export interface ChunkedManifest {
  format: 'cbcter-scan';
  version: 2;
  name: string;
  createdAt: string;
  generator: string;
  source: { format: string; formatLabel: string };
  extensions?: {
    analysis?: { version: 1; manifest: 'analysis/manifest.json' };
  };
  volume: NativeVoxelMetadata & {
    byteOrder: 'little-endian';
    layout: 'x-fastest';
    blockSize: Vec3;
    codec: 'zstd';
    filter: 'x-delta-byte-shuffle';
    sha256: string;
    chunks: ChunkInfo[];
  };
  preview: {
    file: string;
    dimensions: Vec3;
    spacing: Vec3;
    dtype: 'int16';
    encoding: 'raw';
    sha256: string;
    sampling: 'nearest';
    step: 2;
  };
  display: SliceWindowLevel;
  scalarRange: [number, number];
  orientation: { nativeAxis: VolumeAxis; patientAxes?: PatientAxes };
}
const vec = (v: unknown): v is Vec3 =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((n) => typeof n === 'number' && Number.isFinite(n));
const positiveDimensions = (v: unknown): v is Vec3 =>
  vec(v) && v.every((n) => Number.isInteger(n) && n > 0);
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function blockDescriptors(
  dimensions: Vec3,
  size: Vec3 = [64, 64, 64],
): Array<{ start: Vec3; shape: Vec3 }> {
  const out: Array<{ start: Vec3; shape: Vec3 }> = [];
  for (let z = 0; z < dimensions[2]; z += size[2])
    for (let y = 0; y < dimensions[1]; y += size[1])
      for (let x = 0; x < dimensions[0]; x += size[0]) {
        out.push({
          start: [x, y, z],
          shape: [
            Math.min(size[0], dimensions[0] - x),
            Math.min(size[1], dimensions[1] - y),
            Math.min(size[2], dimensions[2] - z),
          ],
        });
      }
  return out;
}
export function parseChunkedManifest(text: string): ChunkedManifest {
  const m = JSON.parse(text) as ChunkedManifest;
  const v = m?.volume;
  const p = m?.preview;
  if (
    m.extensions?.analysis &&
    (m.extensions.analysis.version !== 1 ||
      m.extensions.analysis.manifest !== 'analysis/manifest.json')
  )
    throw new Error('Unsupported analysis extension.');
  if (m?.format !== 'cbcter-scan' || m.version !== 2)
    throw new Error('Unsupported chunked scan package.');
  if (
    typeof m.name !== 'string' ||
    m.name.length > 1024 ||
    typeof m.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(m.createdAt)) ||
    typeof m.generator !== 'string' ||
    !m.source ||
    typeof m.source.format !== 'string' ||
    typeof m.source.formatLabel !== 'string'
  )
    throw new Error('Invalid package identity metadata.');
  if (
    !v ||
    !positiveDimensions(v.dimensions) ||
    v.dimensions.some((n) => n > 4096) ||
    v.dimensions.reduce((a, b) => a * b, 1) > 536870912 ||
    !vec(v.spacing) ||
    v.spacing.some((n) => n <= 0) ||
    !vec(v.origin) ||
    !Array.isArray(v.direction) ||
    v.direction.length !== 3 ||
    !v.direction.every(vec) ||
    !['LPS', 'vendor', 'unknown'].includes(v.coordinateSystem) ||
    !['native', 'processed'].includes(v.representation) ||
    !['int16', 'uint16'].includes(v.dtype) ||
    !Number.isInteger(v.bitsStored) ||
    v.bitsStored < 1 ||
    v.bitsStored > 16 ||
    (v.highBit != null &&
      (!Number.isInteger(v.highBit) ||
        v.highBit < v.bitsStored - 1 ||
        v.highBit > 15)) ||
    (v.paddingValue !== null &&
      (!Number.isInteger(v.paddingValue) ||
        v.paddingValue < (v.dtype === 'int16' ? -32768 : 0) ||
        v.paddingValue > (v.dtype === 'int16' ? 32767 : 65535))) ||
    v.byteOrder !== 'little-endian' ||
    v.layout !== 'x-fastest' ||
    v.codec !== 'zstd' ||
    v.filter !== 'x-delta-byte-shuffle' ||
    !vec(v.blockSize) ||
    v.blockSize.some((n) => n !== 64) ||
    !hash(v.sha256) ||
    !v.calibration ||
    !Number.isFinite(v.calibration.divisor) ||
    v.calibration.divisor <= 0 ||
    !Number.isFinite(v.calibration.slope) ||
    !Number.isFinite(v.calibration.intercept)
  )
    throw new Error('Invalid native volume metadata.');
  // Unit and orthogonal axes: geometry must describe a regular voxel grid.
  for (let i = 0; i < 3; i++) {
    if (Math.abs(Math.hypot(...v.direction[i]) - 1) > 1e-4)
      throw new Error('Invalid voxel direction.');
    for (let j = 0; j < i; j++)
      if (
        Math.abs(
          v.direction[i].reduce((s, n, k) => s + n * v.direction[j][k], 0),
        ) > 1e-4
      )
        throw new Error('Non-orthogonal voxel directions.');
  }
  if (
    !m.display ||
    !Number.isFinite(m.display.window) ||
    m.display.window <= 0 ||
    !Number.isFinite(m.display.level) ||
    !Array.isArray(m.scalarRange) ||
    m.scalarRange.length !== 2 ||
    !m.scalarRange.every(Number.isFinite) ||
    m.scalarRange[0] > m.scalarRange[1] ||
    !m.orientation ||
    !Object.values(VolumeAxis).includes(m.orientation.nativeAxis)
  )
    throw new Error('Invalid display metadata.');
  if (
    m.orientation.patientAxes &&
    !['left', 'anterior', 'superior'].every((key) =>
      vec(m.orientation.patientAxes![key as keyof PatientAxes]),
    )
  )
    throw new Error('Invalid patient axes.');
  const expected = blockDescriptors(v.dimensions);
  if (
    !Array.isArray(v.chunks) ||
    expected.length > 4096 ||
    v.chunks.length !== expected.length
  )
    throw new Error('Missing or excessive chunk descriptors.');
  const files = new Set<string>();
  v.chunks.forEach((c, i) => {
    if (
      c.file !== `chunks/${i}.zst` ||
      files.has(c.file) ||
      !vec(c.start) ||
      !vec(c.shape) ||
      c.start.some((n, k) => n !== expected[i].start[k]) ||
      c.shape.some((n, k) => n !== expected[i].shape[k]) ||
      !hash(c.sha256) ||
      !Number.isSafeInteger(c.bytes) ||
      c.bytes < 1 ||
      c.bytes > 1024 * 1024
    )
      throw new Error('Invalid or incomplete chunk coverage.');
    files.add(c.file);
  });
  if (
    !p ||
    p.file !== 'preview.i16' ||
    p.dtype !== 'int16' ||
    p.encoding !== 'raw' ||
    p.sampling !== 'nearest' ||
    p.step !== 2 ||
    !positiveDimensions(p.dimensions) ||
    p.dimensions.some((n, k) => n !== Math.ceil(v.dimensions[k] / 2)) ||
    !vec(p.spacing) ||
    p.spacing.some((n, k) => Math.abs(n - v.spacing[k] * 2) > 1e-6) ||
    !hash(p.sha256)
  )
    throw new Error('Invalid preview geometry.');
  return m;
}
