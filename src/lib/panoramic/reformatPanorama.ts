import type { LoadedVolume } from '../../types';
import { clamp } from '../volume/math';
import type {
  PanoramicResponse,
  PanoramicRequest,
} from '../../workers/panoramic.worker';
import type { ArchCurve, PanoramicOptions, PanoramicResult } from './types';
import { dims } from './types';

/**
 * Run curved planar reformation in a worker. Only the contiguous z-slab that
 * the panorama covers is copied across — the shared volume buffer is never
 * detached, so the rest of the app keeps reading it safely.
 */
export function reformatPanorama(
  volume: LoadedVolume,
  curve: ArchCurve,
  options: PanoramicOptions,
  onProgress?: (fraction: number) => void,
): Promise<PanoramicResult> {
  const { width, height, depth } = dims(volume.meta.dimensions);
  const sliceStride = width * height;
  const z0 = clamp(Math.round(Math.min(options.zMin, options.zMax)), 0, depth - 1);
  const z1 = clamp(Math.round(Math.max(options.zMin, options.zMax)), 0, depth - 1);
  const slabDepth = z1 - z0 + 1;

  // Contiguous copy of slices [z0, z1]; control points stay in full-volume XY.
  const slab = volume.voxels.slice(z0 * sliceStride, (z1 + 1) * sliceStride);

  return new Promise<PanoramicResult>((resolve, reject) => {
    const worker = new Worker(
      new URL('../../workers/panoramic.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (event: MessageEvent<PanoramicResponse>) => {
      const data = event.data;
      if (data.type === 'progress') {
        onProgress?.(data.fraction);
        return;
      }
      if (data.type === 'result') {
        worker.terminate();
        resolve({
          data: new Uint8ClampedArray(data.data),
          width: data.width,
          height: data.height,
          mmPerPixelX: data.mmPerPixelX,
          mmPerPixelY: data.mmPerPixelY,
        });
        return;
      }
      worker.terminate();
      reject(new Error(data.message));
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Panoramic worker failed.'));
    };

    const request: PanoramicRequest = {
      voxels: slab.buffer as ArrayBuffer,
      dims: [width, height, slabDepth],
      spacing: volume.meta.spacing,
      controlPoints: curve.controlPoints,
      archStepMm: options.archStepMm,
      depthMm: options.depthMm,
      depthStepMm: options.depthStepMm,
      projection: options.projection,
      window: options.window,
      level: options.level,
    };
    worker.postMessage(request, [request.voxels]);
  });
}
