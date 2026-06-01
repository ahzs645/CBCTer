/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web';
import type { Vec3 } from '../types';
import {
  runDentalSegmentation,
  type DentalSegPatchRunner,
} from '../lib/segmentation/dentalSegInference';

/**
 * DentalSegmentator (nnU-Net) multi-class inference worker. Thin adapter: it
 * owns the ONNX session and feeds patches to the testable orchestration in
 * `dentalSegInference.ts`. Regenerate the model with
 * `npm run segment:export-dentalseg`.
 *
 * EP choice: the model runs on the **wasm** EP, not WebGPU. onnxruntime-web's
 * WebGPU EP cannot execute 3D `ConvTranspose` (the U-Net decoder upsampling) and
 * hard-errors rather than falling back. Validated on real CBCT: wasm output
 * matches the CPU reference (~0.003%). Speed comes from multi-threading, which
 * needs cross-origin isolation (COOP/COEP — set in vite.config.ts); with threads
 * a full volume is ~1 min (~7 s/patch), vs several minutes single-threaded.
 */
const BASE = import.meta.env.BASE_URL;
ort.env.wasm.wasmPaths = `${BASE}ort/`;
ort.env.wasm.numThreads =
  self.crossOriginIsolated && navigator.hardwareConcurrency
    ? Math.min(navigator.hardwareConcurrency, 16)
    : 1;

export interface DentalSegRequest {
  /** Source volume voxels (Float32 or Int16 reinterpreted) in [D, H, W] order. */
  data: ArrayBuffer;
  dims: [number, number, number];
  /** Source spacing [x, y, z] mm. */
  spacing: Vec3;
  /** Optional per-class small-component cleanup threshold (mm³). */
  minComponentMm3?: number;
}

export type DentalSegResponse =
  | { type: 'progress'; completed: number; total: number }
  | {
      type: 'result';
      labelmap: ArrayBuffer;
      dims: [number, number, number];
      spacing: Vec3;
    }
  | { type: 'error'; message: string };

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(
      `${BASE}models/dentalsegmentator.onnx`,
      { executionProviders: ['wasm'] },
    );
  }
  return sessionPromise;
}

async function segment(request: DentalSegRequest): Promise<DentalSegResponse> {
  const session = await getSession();
  const source = new Float32Array(request.data);

  const runPatch: DentalSegPatchRunner = async (patch, [d, h, w]) => {
    const tensor = new ort.Tensor('float32', patch.slice(), [1, 1, d, h, w]);
    const output = await session.run({ input: tensor });
    return output.logits.data as Float32Array;
  };

  const result = await runDentalSegmentation(
    source,
    request.dims,
    request.spacing,
    runPatch,
    {
      minComponentMm3: request.minComponentMm3,
      onProgress: (completed, total) =>
        self.postMessage({ type: 'progress', completed, total }),
    },
  );

  return {
    type: 'result',
    labelmap: result.labelmap.buffer as ArrayBuffer,
    dims: result.dims,
    spacing: result.spacing,
  };
}

self.onmessage = async (event: MessageEvent<DentalSegRequest>) => {
  try {
    const response = await segment(event.data);
    const transfer = response.type === 'result' ? [response.labelmap] : [];
    self.postMessage(response, transfer);
  } catch (error) {
    self.postMessage({
      type: 'error',
      message:
        error instanceof Error ? error.message : 'Dental segmentation failed.',
    } satisfies DentalSegResponse);
  }
};
