/**
 * Programmatic entry point for full-anatomy (DentalSegmentator) segmentation:
 * spawns the ONNX/WebGPU worker over the whole loaded volume and resolves a
 * multi-class labelmap. Mirrors `segmentToothROI` so the UI usage is familiar.
 */
import type { LoadedVolume, Vec3 } from '../../types';
import type {
  DentalSegRequest,
  DentalSegResponse,
} from '../../workers/dentalSeg.worker';
import {
  DEFAULT_DENTAL_SEG_VARIANT,
  type DentalSegVariantId,
} from './dentalSegVariants';

export interface DentalAnatomyResult {
  /** Multi-class labelmap on the source grid, `[D, H, W]` order. */
  labelmap: Uint16Array;
  dims: [number, number, number];
  spacing: Vec3;
  /** Which model produced this labelmap. */
  variant: DentalSegVariantId;
}

export interface DentalAnatomyProgress {
  completed: number;
  total: number;
}

export function segmentDentalAnatomy(
  volume: LoadedVolume,
  onProgress?: (progress: DentalAnatomyProgress) => void,
  options: {
    minComponentMm3?: number;
    signal?: AbortSignal;
    variant?: DentalSegVariantId;
  } = {},
): Promise<DentalAnatomyResult> {
  const variant = options.variant ?? DEFAULT_DENTAL_SEG_VARIANT;
  const [width, height, depth] = volume.meta.dimensions;
  // Hand the worker an Int16 copy of the (already [D,H,W]) voxels — half the
  // memory of a Float32 copy. Copy (not transfer) so the app keeps its volume.
  const copy = volume.voxels.slice();

  return new Promise<DentalAnatomyResult>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException('Dental segmentation canceled.', 'AbortError'));
      return;
    }

    const worker = new Worker(
      new URL('../../workers/dentalSeg.worker.ts', import.meta.url),
      { type: 'module' },
    );
    const cleanup = () => {
      options.signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Dental segmentation canceled.', 'AbortError'));
    };
    options.signal?.addEventListener('abort', abort, { once: true });

    worker.onmessage = (event: MessageEvent<DentalSegResponse>) => {
      const data = event.data;
      if (data.type === 'progress') {
        onProgress?.({ completed: data.completed, total: data.total });
        return;
      }
      if (data.type === 'result') {
        cleanup();
        resolve({
          labelmap: new Uint16Array(data.labelmap),
          dims: data.dims,
          spacing: data.spacing,
          variant,
        });
        return;
      }
      cleanup();
      reject(new Error(data.message));
    };

    worker.onerror = (event) => {
      cleanup();
      reject(
        new Error(event.message || 'Dental segmentation worker failed.'),
      );
    };

    const request: DentalSegRequest = {
      data: copy.buffer as ArrayBuffer,
      dims: [depth, height, width],
      spacing: volume.meta.spacing,
      minComponentMm3: options.minComponentMm3 ?? 60,
      variant,
    };
    worker.postMessage(request, [request.data]);
  });
}
