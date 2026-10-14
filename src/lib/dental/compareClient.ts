import type {
  CompareOptions,
  ScanComparison,
  ToothCloud,
} from './compareScans';
import type {
  CompareRequest,
  CompareResponse,
} from '../../workers/compare.worker';

/**
 * `compareTeeth` in a Web Worker. The point buffers are transferred, so the
 * caller's `points` arrays are unusable (detached) afterwards.
 */
export function compareInWorker(
  before: ToothCloud[],
  after: ToothCloud[],
  options: CompareOptions = {},
): Promise<ScanComparison> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../../workers/compare.worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (event: MessageEvent<CompareResponse>) => {
      worker.terminate();
      if (event.data.type === 'result') resolve(event.data.comparison);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Scan comparison worker failed.'));
    };
    const buffers = new Set<ArrayBuffer>();
    for (const t of [...before, ...after])
      if (t.points.buffer instanceof ArrayBuffer) buffers.add(t.points.buffer);
    worker.postMessage({ before, after, options } satisfies CompareRequest, [
      ...buffers,
    ]);
  });
}
