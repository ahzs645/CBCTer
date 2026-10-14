import type { SimplifyClosedOptions } from './simplifyClosed';
import type { SimplifyResponse } from '../../workers/simplify.worker';

/**
 * Simplify a closed binary STL in a worker (see simplifyClosed.ts). When `stl`
 * spans its whole buffer that buffer is transferred (and detached here); pass
 * a copy to keep using it.
 */
export function simplifyInWorker(
  stl: Uint8Array,
  options: SimplifyClosedOptions = {},
): Promise<Uint8Array> {
  const { onProgress, ...rest } = options;
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../../workers/simplify.worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (event: MessageEvent<SimplifyResponse>) => {
      const data = event.data;
      if (data.type === 'progress') {
        onProgress?.(data.fraction);
        return;
      }
      worker.terminate();
      if (data.type === 'result') resolve(data.stl);
      else reject(new Error(data.message));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Simplification worker failed.'));
    };
    // A view into a larger buffer is copied so only its bytes move.
    const owned =
      stl.byteOffset === 0 && stl.byteLength === stl.buffer.byteLength
        ? stl
        : stl.slice();
    worker.postMessage({ stl: owned, options: rest }, [owned.buffer]);
  });
}
