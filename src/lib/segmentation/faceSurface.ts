import type { LoadedVolume } from '../../types';
import { thresholdVolume } from './maskOperations';

/**
 * HU cutoff separating air from soft tissue for the 3-D face surface.
 *
 * The face is just the outer skin↔air boundary, so a threshold is far more
 * robust than an ML segmenter: air sits well below this value on every CBCT we
 * have seen (HU-calibrated scanners put it near -1000, uncalibrated ones near
 * -600), while fat/skin/muscle sit above it. Anything denser than air becomes
 * foreground; its outer shell is the face. -400 leaves a safe margin above the
 * noisiest air we have measured (~-577) and below the lowest soft tissue.
 */
export const FACE_SOFT_TISSUE_HU = -400;

/** Tan tint for the rendered face surface. */
export const FACE_SURFACE_COLOR = '#e8b48c';

export interface SoftTissueMask {
  /** Binary mask, z-major `[depth, height, width]` (matches the voxel layout). */
  mask: Uint8Array;
  dims: [number, number, number];
}

/**
 * Threshold the loaded volume into a binary soft-tissue mask (everything denser
 * than air). The mask's outer boundary is the face/skin surface; pass it through
 * largest-component + hole-fill + meshing to turn it into a clean 3-D face.
 */
export function softTissueMask(
  volume: LoadedVolume,
  threshold: number = FACE_SOFT_TISSUE_HU,
): SoftTissueMask {
  const { dimensions } = volume.meta;
  const dims: [number, number, number] = [
    dimensions[2],
    dimensions[1],
    dimensions[0],
  ];
  // thresholdVolume keeps [min, max]; 32767 is the Int16 ceiling (all of bone).
  const mask = thresholdVolume(volume.voxels, [threshold, 32767]);
  return { mask, dims };
}
