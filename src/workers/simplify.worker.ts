/// <reference lib="webworker" />
import {
  simplifyClosedStl,
  type SimplifyClosedOptions,
} from '../lib/surface/simplifyClosed';

export interface SimplifyRequest {
  stl: Uint8Array;
  options: Omit<SimplifyClosedOptions, 'onProgress'>;
}

export type SimplifyResponse =
  | { type: 'progress'; fraction: number }
  | { type: 'result'; stl: Uint8Array }
  | { type: 'error'; message: string };

// Simplifying a whole-arch model takes seconds; it runs here so the page
// stays responsive.
self.onmessage = (event: MessageEvent<SimplifyRequest>) => {
  const scope = self as DedicatedWorkerGlobalScope;
  try {
    const { stl, options } = event.data;
    const out = simplifyClosedStl(stl, {
      ...options,
      onProgress: (fraction) =>
        scope.postMessage({
          type: 'progress',
          fraction,
        } satisfies SimplifyResponse),
    });
    scope.postMessage({ type: 'result', stl: out } satisfies SimplifyResponse, [
      out.buffer,
    ]);
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    } satisfies SimplifyResponse);
  }
};
