import type {
  SurfaceWorkerRequest,
  SurfaceWorkerResponse,
} from '../../workers/surface.worker';
import type { SurfaceGenerationQuality } from './concepts';
import type { Vec3 } from '../../types';

export interface GeneratedSurface {
  blob: Blob;
  areaMm2: number;
  volumeMm3: number;
  triangleCount: number;
  voxelCount: number;
}

interface GenerateSurfaceInput {
  mask: Uint8Array;
  dims: [number, number, number];
  spacing: Vec3;
  quality: SurfaceGenerationQuality;
  onProgress?: (phase: 'preprocess' | 'mesh' | 'metrics') => void;
  signal?: AbortSignal;
}

export function generateSurfaceInWorker({
  mask,
  dims,
  spacing,
  quality,
  onProgress,
  signal,
}: GenerateSurfaceInput): Promise<GeneratedSurface> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Surface generation canceled.', 'AbortError'));
      return;
    }
    const id = crypto.randomUUID();
    const worker = new Worker(
      new URL('../../workers/surface.worker.ts', import.meta.url),
      { type: 'module' },
    );
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Surface generation canceled.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<SurfaceWorkerResponse>) => {
      const response = event.data;
      if (response.id !== id) return;
      if (response.type === 'progress') {
        onProgress?.(response.phase);
        return;
      }
      cleanup();
      if (response.type === 'error') {
        reject(new Error(response.message));
        return;
      }
      resolve({
        blob: new Blob([response.stl], { type: 'model/stl' }),
        areaMm2: response.areaMm2,
        volumeMm3: response.volumeMm3,
        triangleCount: response.triangleCount,
        voxelCount: response.voxelCount,
      });
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'Surface worker failed.'));
    };
    const request: SurfaceWorkerRequest = {
      id,
      mask: new Uint8Array(mask).buffer,
      dims,
      spacing,
      quality,
    };
    worker.postMessage(request, [request.mask]);
  });
}
