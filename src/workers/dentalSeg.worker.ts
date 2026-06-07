/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web';
import type { Vec3 } from '../types';
import {
  runDentalSegmentation,
  type DentalSegPatchRunner,
} from '../lib/segmentation/dentalSegInference';
import { modelUrl } from '../lib/segmentation/modelUrl';
import {
  DEFAULT_DENTAL_SEG_VARIANT,
  getDentalSegVariant,
  type DentalSegVariantId,
} from '../lib/segmentation/dentalSegVariants';

/**
 * DentalSegmentator (nnU-Net) multi-class inference worker. Thin adapter: it
 * owns the ONNX session and feeds patches to the testable orchestration in
 * `dentalSegInference.ts`. Regenerate the model with
 * `npm run segment:export-dentalseg`.
 *
 * EP choice (measured on real CBCT, ~7 s/patch target):
 * - Cross-origin isolated → multi-threaded **wasm** is fastest (~7 s/patch →
 *   ~1 min/volume). Needs SharedArrayBuffer (COOP/COEP — set in vite.config.ts).
 * - Not isolated → fall back to **WebGPU** (~18 s/patch), which still crushes
 *   single-threaded wasm (minutes/patch). This only works because the model's 3D
 *   `ConvTranspose` nodes were rewritten to Conv + pixel-shuffle
 *   (`scripts/rewrite_convtranspose_webgpu.py`) — ORT-web's WebGPU EP can't run
 *   3D ConvTranspose directly. Both paths match the CPU reference (~1e-5).
 */
const BASE = import.meta.env.BASE_URL;
ort.env.wasm.wasmPaths = `${BASE}ort/`;
const threaded =
  self.crossOriginIsolated && (navigator.hardwareConcurrency ?? 1) > 1;
ort.env.wasm.numThreads = threaded
  ? Math.min(navigator.hardwareConcurrency, 16)
  : 1;
const executionProviders: ('wasm' | 'webgpu')[] = threaded
  ? ['wasm']
  : ['webgpu', 'wasm'];

export interface DentalSegRequest {
  /** Source volume voxels (Float32 or Int16 reinterpreted) in [D, H, W] order. */
  data: ArrayBuffer;
  dims: [number, number, number];
  /** Source spacing [x, y, z] mm. */
  spacing: Vec3;
  /** Optional per-class small-component cleanup threshold (mm³). */
  minComponentMm3?: number;
  /** Which DentalSegmentator model to run. Defaults to the base "full" model. */
  variant?: DentalSegVariantId;
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

// One ONNX session per model file (variants share the worker but not weights).
const sessions = new Map<string, Promise<ort.InferenceSession>>();

function getSession(modelFile: string): Promise<ort.InferenceSession> {
  let session = sessions.get(modelFile);
  if (!session) {
    session = ort.InferenceSession.create(modelUrl(modelFile), {
      executionProviders,
    });
    sessions.set(modelFile, session);
  }
  return session;
}

async function segment(request: DentalSegRequest): Promise<DentalSegResponse> {
  const variant = getDentalSegVariant(
    request.variant ?? DEFAULT_DENTAL_SEG_VARIANT,
  );
  const session = await getSession(variant.modelFile);
  // Int16 HU voxels (half the transfer/memory of Float32); resampled to Float32
  // at the much smaller model grid inside runDentalSegmentation.
  const source = new Int16Array(request.data);

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
      modelSpacing: variant.spacing,
      patchSize: variant.patchSize,
      classCount: variant.classCount,
      normalization: variant.normalization,
      canalLabel: variant.canalLabel,
      // No window overlap: ~8 full-res patches instead of ~18, validated correct
      // on real CBCT, and keeps memory/time in check for full-volume inference.
      overlap: 0,
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
