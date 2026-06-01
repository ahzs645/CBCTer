/**
 * Multi-class DentalSegmentator (nnU-Net) inference orchestration, built from
 * the preprocessing kit. The actual model call is injected (`runPatch`) so this
 * whole pipeline is unit-testable with a mock and the ONNX/WebGPU worker stays a
 * thin adapter (`src/workers/dentalSeg.worker.ts`).
 *
 * Flow (mirrors nnU-Net's sliding-window predictor):
 *   resample → CTNormalize → reflect-pad → sliding-window patches →
 *   per-voxel softmax averaged across overlaps → argmax → crop → resample back →
 *   per-class small-component cleanup.
 *
 * ⚠️ The model `spacing` is in nnU-Net plans axis order; for scans whose voxel
 * axis order differs you must reorder before calling. See
 * `docs/source-repos/PORTING-nnunet-dentalsegmentator.md`. This module is
 * compile- and unit-tested with a mock model; end-to-end accuracy with the real
 * 123 MB weights still needs in-browser (WebGPU) validation.
 */
import type { Vec3 } from '../../types';
import {
  ctNormalize,
  type CtNormalizationParams,
} from '../volume/intensityNormalization';
import { resampleLabelmap, resampleVolume } from '../volume/resample';
import {
  DENTAL_SEGMENTATOR_CANAL_LABEL,
  DENTAL_SEGMENTATOR_CLASS_COUNT,
  DENTAL_SEGMENTATOR_NORMALIZATION,
  DENTAL_SEGMENTATOR_PATCH_SIZE,
  DENTAL_SEGMENTATOR_SPACING,
} from './dentalSegmentator';
import { removeSmallComponentsPerLabel } from './maskOperations';

/** Mirror-pad index (reflect-101), matching the tooth worker. */
export function reflectIndex(i: number, n: number): number {
  if (n === 1) return 0;
  const period = 2 * (n - 1);
  let m = ((i % period) + period) % period;
  if (m >= n) m = period - m;
  return m;
}

/** Patch start offsets along one axis for a given window size and overlap. */
export function windowStarts(size: number, window: number, overlap: number): number[] {
  if (size <= window) return [0];
  const interval = Math.max(1, Math.floor(window * (1 - overlap)));
  const count = Math.ceil((size - window) / interval) + 1;
  const starts: number[] = [];
  for (let k = 0; k < count; k += 1) starts.push(Math.min(k * interval, size - window));
  return starts;
}

/**
 * Runs one patch through the model. Receives a `[d, h, w]` Float32 patch and
 * must resolve to logits laid out channel-major as `[classCount, d, h, w]`
 * (i.e. the flattened ONNX output `[1, C, d, h, w]`).
 */
export type DentalSegPatchRunner = (
  patch: Float32Array,
  patchDims: [number, number, number],
) => Promise<Float32Array>;

export interface DentalSegOptions {
  /** Target spacing `[x, y, z]`; default DentalSegmentator plans spacing. */
  modelSpacing?: Vec3;
  /** Sliding-window patch `[d, h, w]`; default plans patch size. */
  patchSize?: [number, number, number];
  /** Number of output channels incl. background; default 6. */
  classCount?: number;
  normalization?: CtNormalizationParams;
  /** Window overlap fraction 0..1; default 0.5. */
  overlap?: number;
  /** Drop components below this physical volume (mm³) per class; 0 disables. */
  minComponentMm3?: number;
  /** Label excluded from cleanup (thin canal); default 5. */
  canalLabel?: number;
  onProgress?: (completed: number, total: number) => void;
}

export interface DentalSegResult {
  /** Multi-class labelmap on the source grid. */
  labelmap: Uint16Array;
  /** `[depth, height, width]` of the source grid. */
  dims: [number, number, number];
  /** Source spacing `[x, y, z]`. */
  spacing: Vec3;
}

export async function runDentalSegmentation(
  data: ArrayLike<number>,
  dims: [number, number, number],
  spacing: Vec3,
  runPatch: DentalSegPatchRunner,
  options: DentalSegOptions = {},
): Promise<DentalSegResult> {
  const patch = options.patchSize ?? DENTAL_SEGMENTATOR_PATCH_SIZE;
  const modelSpacing = options.modelSpacing ?? DENTAL_SEGMENTATOR_SPACING;
  const classCount = options.classCount ?? DENTAL_SEGMENTATOR_CLASS_COUNT;
  const norm = options.normalization ?? DENTAL_SEGMENTATOR_NORMALIZATION;
  const overlap = options.overlap ?? 0.5;
  const canalLabel = options.canalLabel ?? DENTAL_SEGMENTATOR_CANAL_LABEL;

  // 1–2. Resample to model spacing and CT-normalize.
  const resampled = resampleVolume(data, dims, spacing, modelSpacing, 'linear');
  const normalized = ctNormalize(resampled.data, norm);
  const [rd, rh, rw] = resampled.dims;

  // 3. Reflect-pad (centered) so every axis is at least the patch size.
  const [patchD, patchH, patchW] = patch;
  const pd = Math.max(patchD, rd);
  const ph = Math.max(patchH, rh);
  const pw = Math.max(patchW, rw);
  const offZ = Math.floor((pd - rd) / 2);
  const offY = Math.floor((ph - rh) / 2);
  const offX = Math.floor((pw - rw) / 2);

  const padded = new Float32Array(pd * ph * pw);
  for (let z = 0; z < pd; z += 1) {
    const sz = reflectIndex(z - offZ, rd);
    for (let y = 0; y < ph; y += 1) {
      const sy = reflectIndex(y - offY, rh);
      const srcRow = (sz * rh + sy) * rw;
      const dstRow = (z * ph + y) * pw;
      for (let x = 0; x < pw; x += 1) {
        padded[dstRow + x] = normalized[srcRow + reflectIndex(x - offX, rw)];
      }
    }
  }

  // 4. Sliding-window inference. Memory-light: instead of a full C-channel
  // accumulator (which OOMs on full-resolution CBCT), keep only the best
  // (argmax) class and its softmax probability per voxel; overlapping windows
  // keep the higher-confidence label. Saves ~(C-1)× the accumulator memory.
  const voxelsPerClass = pd * ph * pw;
  const bestProb = new Float32Array(voxelsPerClass);
  const bestLabel = new Uint8Array(voxelsPerClass);
  const startsZ = windowStarts(pd, patchD, overlap);
  const startsY = windowStarts(ph, patchH, overlap);
  const startsX = windowStarts(pw, patchW, overlap);
  const total = startsZ.length * startsY.length * startsX.length;
  const patchVoxels = patchD * patchH * patchW;
  const patchData = new Float32Array(patchVoxels);
  let done = 0;

  for (const z0 of startsZ) {
    for (const y0 of startsY) {
      for (const x0 of startsX) {
        let p = 0;
        for (let z = 0; z < patchD; z += 1) {
          for (let y = 0; y < patchH; y += 1) {
            const base = ((z0 + z) * ph + (y0 + y)) * pw + x0;
            for (let x = 0; x < patchW; x += 1) {
              patchData[p] = padded[base + x];
              p += 1;
            }
          }
        }

        const logits = await runPatch(patchData, patch);

        let local = 0;
        for (let z = 0; z < patchD; z += 1) {
          for (let y = 0; y < patchH; y += 1) {
            const base = ((z0 + z) * ph + (y0 + y)) * pw + x0;
            for (let x = 0; x < patchW; x += 1) {
              const paddedIndex = base + x;
              // argmax class and its softmax probability at this voxel
              let maxLogit = -Infinity;
              let argmax = 0;
              for (let c = 0; c < classCount; c += 1) {
                const l = logits[c * patchVoxels + local];
                if (l > maxLogit) {
                  maxLogit = l;
                  argmax = c;
                }
              }
              let sumExp = 0;
              for (let c = 0; c < classCount; c += 1) {
                sumExp += Math.exp(logits[c * patchVoxels + local] - maxLogit);
              }
              const prob = 1 / sumExp; // softmax of the argmax class
              if (prob > bestProb[paddedIndex]) {
                bestProb[paddedIndex] = prob;
                bestLabel[paddedIndex] = argmax;
              }
              local += 1;
            }
          }
        }

        done += 1;
        options.onProgress?.(done, total);
      }
    }
  }

  // 5–6. Crop the padding back to the resampled grid.
  const modelLabels = new Uint16Array(rd * rh * rw);
  let out = 0;
  for (let z = 0; z < rd; z += 1) {
    for (let y = 0; y < rh; y += 1) {
      const base = ((z + offZ) * ph + (y + offY)) * pw + offX;
      for (let x = 0; x < rw; x += 1) {
        modelLabels[out] = bestLabel[base + x];
        out += 1;
      }
    }
  }

  // 7. Resample the labelmap back to the EXACT source grid (nearest). Passing
  // the original dims avoids ±1-voxel rounding that would misalign overlays.
  const back = resampleLabelmap(
    modelLabels,
    resampled.dims,
    modelSpacing,
    spacing,
    dims,
  );

  // 8. Optional per-class small-component cleanup (skip the thin canal).
  let labelmap: Uint16Array = back.data;
  if (options.minComponentMm3 && options.minComponentMm3 > 0) {
    labelmap = removeSmallComponentsPerLabel(
      labelmap,
      back.dims,
      spacing,
      options.minComponentMm3,
      { skipLabels: [canalLabel] },
    );
  }

  return { labelmap, dims: back.dims, spacing };
}
