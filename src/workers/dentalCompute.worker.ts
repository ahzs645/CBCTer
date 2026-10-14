/// <reference lib="webworker" />
import { computeApi, type ComputeMethod } from '../lib/dental/computeApi';

export interface ComputeRequest {
  id: number;
  method: ComputeMethod;
  input: unknown;
}

export type ComputeResponse =
  | { id: number; type: 'result'; result: unknown }
  | { id: number; type: 'error'; message: string };

/** Typed-array buffers in a result, so they move instead of being copied. */
function buffersOf(value: unknown, out: Set<ArrayBuffer>, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 3) return;
  if (ArrayBuffer.isView(value)) {
    if (value.buffer instanceof ArrayBuffer) out.add(value.buffer);
    return;
  }
  for (const item of Object.values(value)) buffersOf(item, out, depth + 1);
}

self.onmessage = async (event: MessageEvent<ComputeRequest>) => {
  const scope = self as DedicatedWorkerGlobalScope;
  const { id, method, input } = event.data;
  try {
    const run = computeApi[method] as (input: unknown) => unknown;
    const result = await run(input);
    const transfer = new Set<ArrayBuffer>();
    buffersOf(result, transfer);
    scope.postMessage(
      { id, type: 'result', result } satisfies ComputeResponse,
      [...transfer],
    );
  } catch (error) {
    scope.postMessage({
      id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    } satisfies ComputeResponse);
  }
};
