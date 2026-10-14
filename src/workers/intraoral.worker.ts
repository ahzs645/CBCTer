/// <reference lib="webworker" />
import { alignIntraoral, type IntraoralFit } from '../lib/ios/fuseIntraoral';

export interface IntraoralRequest {
  bytes: Uint8Array;
  name: string;
  archTarget: Float32Array;
  keepTarget: Float32Array;
}

export type IntraoralResponse =
  | { type: 'result'; fit: IntraoralFit }
  | { type: 'error'; message: string };

// Parsing and aligning a large intraoral scan takes seconds; it runs here so
// the page stays responsive.
self.onmessage = (event: MessageEvent<IntraoralRequest>) => {
  const scope = self as DedicatedWorkerGlobalScope;
  try {
    const { bytes, name, archTarget, keepTarget } = event.data;
    const fit = alignIntraoral(bytes, name, archTarget, keepTarget);
    scope.postMessage({ type: 'result', fit } satisfies IntraoralResponse, [
      fit.crowns.positions.buffer,
      fit.crowns.indices.buffer,
    ]);
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    } satisfies IntraoralResponse);
  }
};
