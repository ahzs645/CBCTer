/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web';
import type { Vec3 } from '../types';
import {
  AMASSS_SKIN_CLASS_COUNT,
  AMASSS_SKIN_LABEL,
  AMASSS_SKIN_MODEL_FILE,
  AMASSS_SKIN_NORMALIZATION,
  AMASSS_SKIN_PATCH,
  AMASSS_SKIN_SPACING,
} from '../lib/segmentation/amasssSkin';
import {
  runDentalSegmentation,
  type DentalSegPatchRunner,
} from '../lib/segmentation/dentalSegInference';
import { modelUrl } from '../lib/segmentation/modelUrl';

/**
 * AMASSS SKIN inference worker — reuses the generic nnU-Net orchestration and
 * returns a binary face/soft-tissue mask (which becomes the 3-D face surface).
 * Same adaptive EP + threading as the DentalSeg worker.
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

export interface SkinSegRequest {
  data: ArrayBuffer;
  dims: [number, number, number];
  spacing: Vec3;
}

export type SkinSegResponse =
  | { type: 'progress'; completed: number; total: number }
  | {
      type: 'result';
      mask: ArrayBuffer;
      dims: [number, number, number];
      spacing: Vec3;
      voxelCount: number;
    }
  | { type: 'error'; message: string };

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(
      modelUrl(AMASSS_SKIN_MODEL_FILE),
      { executionProviders },
    );
  }
  return sessionPromise;
}

async function segment(request: SkinSegRequest): Promise<SkinSegResponse> {
  const session = await getSession();
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
      modelSpacing: AMASSS_SKIN_SPACING,
      patchSize: AMASSS_SKIN_PATCH,
      classCount: AMASSS_SKIN_CLASS_COUNT,
      normalization: AMASSS_SKIN_NORMALIZATION,
      overlap: 0,
      onProgress: (completed, total) =>
        self.postMessage({ type: 'progress', completed, total }),
    },
  );

  // Binary skin mask from the labelmap.
  const mask = new Uint8Array(result.labelmap.length);
  let voxelCount = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (result.labelmap[i] === AMASSS_SKIN_LABEL) {
      mask[i] = 1;
      voxelCount += 1;
    }
  }

  return {
    type: 'result',
    mask: mask.buffer,
    dims: result.dims,
    spacing: result.spacing,
    voxelCount,
  };
}

self.onmessage = async (event: MessageEvent<SkinSegRequest>) => {
  try {
    const response = await segment(event.data);
    const transfer = response.type === 'result' ? [response.mask] : [];
    self.postMessage(response, transfer);
  } catch (error) {
    self.postMessage({
      type: 'error',
      message:
        error instanceof Error ? error.message : 'Face segmentation failed.',
    } satisfies SkinSegResponse);
  }
};
