import type { Vec3 } from '../../types';

/** Raw stored words in the same canonical x-fastest layout as their geometry. */
export interface NativeVoxelMetadata {
  dimensions: Vec3;
  spacing: Vec3;
  dtype: 'int16' | 'uint16';
  bitsStored: number;
  /** DICOM stored sample position; omitted when all 16 source bits are values. */
  highBit?: number;
  paddingValue: number | null;
  origin: Vec3;
  /** Unit directions of voxel x/y/z in the declared coordinate system. */
  direction: [Vec3, Vec3, Vec3];
  coordinateSystem: 'LPS' | 'vendor' | 'unknown';
  representation: 'native' | 'processed';
  /** Preserve the original evaluation order: (raw / divisor) * slope + intercept. */
  calibration: { divisor: number; slope: number; intercept: number };
}
export interface NativeVoxelVolume {
  voxels: Int16Array | Uint16Array;
  metadata: NativeVoxelMetadata;
}
export function displaySample(raw: number, meta: NativeVoxelMetadata): number {
  if (meta.paddingValue != null && raw === meta.paddingValue) return -32768;
  if (meta.highBit != null) {
    const shift = meta.highBit - meta.bitsStored + 1;
    const mask = 2 ** meta.bitsStored - 1;
    raw = (raw >>> shift) & mask;
    if (meta.dtype === 'int16' && raw >= 2 ** (meta.bitsStored - 1))
      raw -= 2 ** meta.bitsStored;
  }
  const { divisor, slope, intercept } = meta.calibration;
  // View/analysis arrays are derived Int16; native words are never rescaled.
  return Math.max(
    -32767,
    Math.min(32767, Math.round((raw / divisor) * slope + intercept)),
  );
}
export function displayVoxels(
  raw: Int16Array | Uint16Array,
  meta: NativeVoxelMetadata,
): Int16Array {
  const out = new Int16Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = displaySample(raw[i], meta);
  return out;
}
