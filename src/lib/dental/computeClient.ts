import type { ComputeApi, ComputeMethod } from './computeApi';
import type {
  ComputeRequest,
  ComputeResponse,
} from '../../workers/dentalCompute.worker';

type Input<M extends ComputeMethod> = Parameters<ComputeApi[M]>[0];
type Output<M extends ComputeMethod> = Awaited<ReturnType<ComputeApi[M]>>;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

function failAll(message: string) {
  for (const { reject } of pending.values()) reject(new Error(message));
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(
    new URL('../../workers/dentalCompute.worker.ts', import.meta.url),
    { type: 'module' },
  );
  created.onmessage = (event: MessageEvent<ComputeResponse>) => {
    const reply = event.data;
    const waiting = pending.get(reply.id);
    if (!waiting) return;
    pending.delete(reply.id);
    if (reply.type === 'result') waiting.resolve(reply.result);
    else waiting.reject(new Error(reply.message));
  };
  // A crashed worker (often out of memory) fails what it was doing; the
  // next call starts a fresh one.
  created.onerror = (event) => {
    event.preventDefault?.();
    created.terminate();
    if (worker === created) worker = null;
    failAll(
      event.message ||
        'The calculation stopped, possibly for lack of memory. Try fewer teeth.',
    );
  };
  worker = created;
  return created;
}

/**
 * Run a dental computation off the main thread. Falls back to running it
 * here where workers are unavailable (tests, old browsers).
 */
export async function compute<M extends ComputeMethod>(
  method: M,
  input: Input<M>,
): Promise<Output<M>> {
  if (typeof Worker === 'undefined') {
    const { computeApi } = await import('./computeApi');
    const run = computeApi[method] as (input: Input<M>) => Output<M>;
    return run(input);
  }
  const id = nextId++;
  return new Promise<Output<M>>((resolve, reject) => {
    pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    getWorker().postMessage({ id, method, input } satisfies ComputeRequest);
  });
}

/** Stop the worker (and fail anything running), e.g. when a scan closes. */
export function stopCompute() {
  worker?.terminate();
  worker = null;
  failAll('Cancelled.');
}
