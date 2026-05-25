import { gunzipSync } from 'fflate';
import { prepareVolumeFor3D } from '../lib/volume';
import type { LoadedVolume, PreparedVolumeFor3D, Vec3 } from '../types';
import { VolumeAxis } from '../types';

export interface LoadedNifti {
  volume: LoadedVolume;
  prepared3D: PreparedVolumeFor3D;
  label: string;
}

// NIfTI-1 datatype codes.
const DT_UINT8 = 2;
const DT_INT16 = 4;
const DT_INT32 = 8;
const DT_FLOAT32 = 16;
const DT_FLOAT64 = 64;
const DT_INT8 = 256;
const DT_UINT16 = 512;
const DT_UINT32 = 768;

function clampInt16(value: number): number {
  const rounded = Math.round(value);
  if (rounded < -32768) return -32768;
  if (rounded > 32767) return 32767;
  return rounded;
}

function makeReader(
  datatype: number,
  view: DataView,
  little: boolean,
): (offset: number) => number {
  switch (datatype) {
    case DT_UINT8:
      return (o) => view.getUint8(o);
    case DT_INT8:
      return (o) => view.getInt8(o);
    case DT_INT16:
      return (o) => view.getInt16(o, little);
    case DT_UINT16:
      return (o) => view.getUint16(o, little);
    case DT_INT32:
      return (o) => view.getInt32(o, little);
    case DT_UINT32:
      return (o) => view.getUint32(o, little);
    case DT_FLOAT32:
      return (o) => view.getFloat32(o, little);
    case DT_FLOAT64:
      return (o) => view.getFloat64(o, little);
    default:
      throw new Error(`Unsupported NIfTI datatype ${datatype}.`);
  }
}

/**
 * Parse a NIfTI-1 file (.nii or gzipped .nii.gz) into a LoadedVolume +
 * 3D preview, fully client-side. Voxel ordering (x fastest) matches the
 * app's z*W*H + y*W + x convention.
 */
export async function loadNifti(file: File): Promise<LoadedNifti> {
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (
    file.name.toLowerCase().endsWith('.gz') ||
    (bytes[0] === 0x1f && bytes[1] === 0x8b)
  ) {
    bytes = gunzipSync(bytes);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let little = true;
  if (view.getInt32(0, true) !== 348) {
    little = false;
    if (view.getInt32(0, false) !== 348) {
      throw new Error('Not a NIfTI-1 file (bad header size).');
    }
  }

  const nx = view.getInt16(42, little);
  const ny = view.getInt16(44, little);
  const nz = Math.max(1, view.getInt16(46, little));
  const datatype = view.getInt16(70, little);
  const bitpix = view.getInt16(72, little);
  const sx = view.getFloat32(80, little) || 1;
  const sy = view.getFloat32(84, little) || 1;
  const sz = view.getFloat32(88, little) || 1;
  const voxOffset = Math.round(view.getFloat32(108, little)) || 352;
  let slope = view.getFloat32(112, little);
  const intercept = view.getFloat32(116, little) || 0;
  if (!Number.isFinite(slope) || slope === 0) slope = 1;

  if (nx <= 0 || ny <= 0) {
    throw new Error('NIfTI file has no spatial dimensions.');
  }

  const count = nx * ny * nz;
  const voxels = new Int16Array(count);
  const apply = (value: number) => clampInt16(value * slope + intercept);

  // Fast path: little-endian, aligned typed-array view over the payload.
  const absStart = bytes.byteOffset + voxOffset;
  const step = bitpix / 8;
  const aligned = absStart % Math.max(1, step) === 0;
  let usedFastPath = false;
  if (little && aligned) {
    const ab = bytes.buffer;
    let src: ArrayLike<number> | null = null;
    if (datatype === DT_UINT8) src = new Uint8Array(ab, absStart, count);
    else if (datatype === DT_INT8) src = new Int8Array(ab, absStart, count);
    else if (datatype === DT_INT16) src = new Int16Array(ab, absStart, count);
    else if (datatype === DT_UINT16) src = new Uint16Array(ab, absStart, count);
    else if (datatype === DT_INT32) src = new Int32Array(ab, absStart, count);
    else if (datatype === DT_FLOAT32)
      src = new Float32Array(ab, absStart, count);
    else if (datatype === DT_FLOAT64)
      src = new Float64Array(ab, absStart, count);
    if (src) {
      for (let i = 0; i < count; i += 1) voxels[i] = apply(src[i]);
      usedFastPath = true;
    }
  }

  if (!usedFastPath) {
    const read = makeReader(datatype, view, little);
    for (let i = 0; i < count; i += 1) {
      voxels[i] = apply(read(voxOffset + i * step));
    }
  }

  let min = voxels[0] ?? 0;
  let max = voxels[0] ?? 0;
  for (let i = 1; i < count; i += 1) {
    const value = voxels[i];
    if (value < min) min = value;
    else if (value > max) max = value;
  }
  const span = Math.max(1, max - min);

  const dimensions: Vec3 = [nx, ny, nz];
  const spacing: Vec3 = [sx, sy, sz];
  const label = file.name.replace(/\.(nii\.gz|nii|gz)$/i, '') || 'NIfTI volume';

  const volume: LoadedVolume = {
    meta: {
      format: 'dicom',
      formatLabel: 'NIfTI',
      scanId: label,
      dimensions,
      spacing,
      scalarRange: [min, max],
      initialWindowLevel: { window: span, level: Math.round(min + span / 2) },
      sliceCount: nz,
      bytesPerVoxel: 2,
      headerFileName: file.name,
      slicePrefix: '',
      sliceFiles: [],
      nativeAxis: VolumeAxis.Axial,
      seriesChoices: [],
    },
    voxels,
    histogram: new Uint32Array(0),
  };

  return { volume, prepared3D: prepareVolumeFor3D(volume), label };
}
