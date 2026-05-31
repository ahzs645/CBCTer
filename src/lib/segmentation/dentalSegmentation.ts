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

export interface DentalAnatomyResult {
  /** Multi-class labelmap on the source grid, `[D, H, W]` order. */
  labelmap: Uint16Array;
  dims: [number, number, number];
  spacing: Vec3;
}

export interface DentalAnatomyProgress {
  completed: number;
  total: number;
}

export function segmentDentalAnatomy(
  volume: LoadedVolume,
  onProgress?: (progress: DentalAnatomyProgress) => void,
  options: { minComponentMm3?: number } = {},
): Promise<DentalAnatomyResult> {
  const [width, height, depth] = volume.meta.dimensions;
  // The worker normalizes; hand it a Float32 copy of the (already [D,H,W]) voxels.
  const float = Float32Array.from(volume.voxels);

  return new Promise<DentalAnatomyResult>((resolve, reject) => {
    const worker = new Worker(
      new URL('../../workers/dentalSeg.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (event: MessageEvent<DentalSegResponse>) => {
      const data = event.data;
      if (data.type === 'progress') {
        onProgress?.({ completed: data.completed, total: data.total });
        return;
      }
      if (data.type === 'result') {
        worker.terminate();
        resolve({
          labelmap: new Uint16Array(data.labelmap),
          dims: data.dims,
          spacing: data.spacing,
        });
        return;
      }
      worker.terminate();
      reject(new Error(data.message));
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(
        new Error(event.message || 'Dental segmentation worker failed.'),
      );
    };

    const request: DentalSegRequest = {
      data: float.buffer as ArrayBuffer,
      dims: [depth, height, width],
      spacing: volume.meta.spacing,
      minComponentMm3: options.minComponentMm3,
    };
    worker.postMessage(request, [request.data]);
  });
}
