import type {
  MaskWorkerRequest,
  MaskWorkerResponse,
} from '../../workers/mask.worker';

interface MaskWorkerBaseInput {
  mask: Uint8Array;
  dims: [number, number, number];
  connectivity?: 6 | 26;
  signal?: AbortSignal;
}

export interface SplitMaskWorkerComponent {
  label: number;
  mask: Uint8Array;
  voxels: number;
}

function runMaskWorker(
  request: Omit<MaskWorkerRequest, 'id'>,
  signal?: AbortSignal,
): Promise<MaskWorkerResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Mask operation canceled.', 'AbortError'));
      return;
    }
    const id = crypto.randomUUID();
    const worker = new Worker(
      new URL('../../workers/mask.worker.ts', import.meta.url),
      { type: 'module' },
    );
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Mask operation canceled.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<MaskWorkerResponse>) => {
      const response = event.data;
      if (response.id !== id) return;
      cleanup();
      if (response.type === 'error') {
        reject(new Error(response.message));
        return;
      }
      resolve(response);
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'Mask worker failed.'));
    };
    const workerRequest: MaskWorkerRequest = { id, ...request };
    worker.postMessage(workerRequest, [workerRequest.mask]);
  });
}

export async function keepLargestMaskComponentInWorker({
  mask,
  dims,
  connectivity,
  signal,
}: MaskWorkerBaseInput): Promise<{ mask: Uint8Array; voxels: number }> {
  const response = await runMaskWorker(
    {
      operation: 'keep-largest',
      mask: new Uint8Array(mask).buffer,
      dims,
      connectivity,
    },
    signal,
  );
  if (response.type !== 'keep-largest') {
    throw new Error('Unexpected mask worker response.');
  }
  return {
    mask: new Uint8Array(response.mask),
    voxels: response.voxels,
  };
}

export async function splitMaskComponentsInWorker({
  mask,
  dims,
  connectivity,
  signal,
  limit = 24,
}: MaskWorkerBaseInput & { limit?: number }): Promise<SplitMaskWorkerComponent[]> {
  const response = await runMaskWorker(
    {
      operation: 'split-components',
      mask: new Uint8Array(mask).buffer,
      dims,
      connectivity,
      limit,
    },
    signal,
  );
  if (response.type !== 'split-components') {
    throw new Error('Unexpected mask worker response.');
  }
  return response.components.map((component) => ({
    label: component.label,
    mask: new Uint8Array(component.mask),
    voxels: component.voxels,
  }));
}

