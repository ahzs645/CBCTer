/// <reference lib="webworker" />
import {
  compareTeeth,
  type CompareOptions,
  type ScanComparison,
  type ToothCloud,
} from '../lib/dental/compareScans';

export interface CompareRequest {
  before: ToothCloud[];
  after: ToothCloud[];
  options: CompareOptions;
}

export type CompareResponse =
  | { type: 'result'; comparison: ScanComparison }
  | { type: 'error'; message: string };

// Registering every tooth of two scans takes a few seconds; it runs here so
// the page stays responsive.
self.onmessage = (event: MessageEvent<CompareRequest>) => {
  const scope = self as DedicatedWorkerGlobalScope;
  try {
    const { before, after, options } = event.data;
    const comparison = compareTeeth(before, after, options);
    scope.postMessage({ type: 'result', comparison } satisfies CompareResponse);
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    } satisfies CompareResponse);
  }
};
