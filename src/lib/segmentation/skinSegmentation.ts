/**
 * Programmatic entry point for AMASSS face/skin segmentation: spawns the worker
 * over the whole loaded volume and resolves a binary soft-tissue mask, ready to
 * turn into a 3-D face surface.
 */
import type { LoadedVolume, Vec3 } from '../../types';
import type {
  SkinSegRequest,
  SkinSegResponse,
} from '../../workers/amasssSkin.worker';

export interface SkinSegmentationResult {
  mask: Uint8Array;
  dims: [number, number, number];
  spacing: Vec3;
  voxelCount: number;
}

export interface SkinSegmentationProgress {
  completed: number;
  total: number;
}

export function segmentFaceSkin(
  volume: LoadedVolume,
  onProgress?: (progress: SkinSegmentationProgress) => void,
): Promise<SkinSegmentationResult> {
  const [width, height, depth] = volume.meta.dimensions;
  const copy = volume.voxels.slice();

  return new Promise<SkinSegmentationResult>((resolve, reject) => {
    const worker = new Worker(
      new URL('../../workers/amasssSkin.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (event: MessageEvent<SkinSegResponse>) => {
      const data = event.data;
      if (data.type === 'progress') {
        onProgress?.({ completed: data.completed, total: data.total });
        return;
      }
      if (data.type === 'result') {
        worker.terminate();
        resolve({
          mask: new Uint8Array(data.mask),
          dims: data.dims,
          spacing: data.spacing,
          voxelCount: data.voxelCount,
        });
        return;
      }
      worker.terminate();
      reject(new Error(data.message));
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Face segmentation worker failed.'));
    };

    const request: SkinSegRequest = {
      data: copy.buffer as ArrayBuffer,
      dims: [depth, height, width],
      spacing: volume.meta.spacing,
    };
    worker.postMessage(request, [request.data]);
  });
}
