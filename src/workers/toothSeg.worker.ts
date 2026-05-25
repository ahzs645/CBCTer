/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web';

// Mirror the reference SlicerCBCTToothSegmentation inference settings.
const WINDOW = 96;
const MIN_PAD = 144;
const OVERLAP = 0.25;

const BASE = import.meta.env.BASE_URL;
ort.env.wasm.wasmPaths = `${BASE}ort/`;
ort.env.wasm.numThreads = 1;

export interface ToothSegRequest {
  /** Float32 crop voxels in [D, H, W] order. */
  data: ArrayBuffer;
  dims: [number, number, number];
}

export type ToothSegResponse =
  | { type: 'progress'; completed: number; total: number }
  | {
      type: 'result';
      mask: ArrayBuffer;
      dims: [number, number, number];
      voxelCount: number;
    }
  | { type: 'error'; message: string };

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(
      `${BASE}models/tooth-unet-96.onnx`,
      { executionProviders: ['wasm'] },
    );
  }
  return sessionPromise;
}

function reflectIndex(i: number, n: number): number {
  if (n === 1) return 0;
  const period = 2 * (n - 1);
  let m = ((i % period) + period) % period;
  if (m >= n) m = period - m;
  return m;
}

function windowStarts(size: number): number[] {
  if (size <= WINDOW) return [0];
  const interval = Math.max(1, Math.floor(WINDOW * (1 - OVERLAP)));
  const count = Math.ceil((size - WINDOW) / interval) + 1;
  const starts: number[] = [];
  for (let k = 0; k < count; k += 1) {
    starts.push(Math.min(k * interval, size - WINDOW));
  }
  return starts;
}

async function segment(request: ToothSegRequest): Promise<ToothSegResponse> {
  const session = await getSession();
  const [cd, ch, cw] = request.dims;
  const crop = new Float32Array(request.data);

  // NormalizeIntensity: zero mean, unit std over the crop.
  let sum = 0;
  for (let i = 0; i < crop.length; i += 1) sum += crop[i];
  const mean = sum / crop.length;
  let variance = 0;
  for (let i = 0; i < crop.length; i += 1) {
    const d = crop[i] - mean;
    variance += d * d;
  }
  const std = Math.sqrt(variance / crop.length) || 1;

  // SpatialPad to >= 144^3 with reflect padding, centered.
  const pd = Math.max(MIN_PAD, cd);
  const ph = Math.max(MIN_PAD, ch);
  const pw = Math.max(MIN_PAD, cw);
  const offZ = Math.floor((pd - cd) / 2);
  const offY = Math.floor((ph - ch) / 2);
  const offX = Math.floor((pw - cw) / 2);

  const padded = new Float32Array(pd * ph * pw);
  for (let z = 0; z < pd; z += 1) {
    const sz = reflectIndex(z - offZ, cd);
    for (let y = 0; y < ph; y += 1) {
      const sy = reflectIndex(y - offY, ch);
      const srcRow = (sz * ch + sy) * cw;
      const dstRow = (z * ph + y) * pw;
      for (let x = 0; x < pw; x += 1) {
        const sx = reflectIndex(x - offX, cw);
        padded[dstRow + x] = (crop[srcRow + sx] - mean) / std;
      }
    }
  }

  // Sliding-window inference, accumulating foreground probability.
  const probSum = new Float32Array(pd * ph * pw);
  const weight = new Float32Array(pd * ph * pw);
  const startsZ = windowStarts(pd);
  const startsY = windowStarts(ph);
  const startsX = windowStarts(pw);
  const total = startsZ.length * startsY.length * startsX.length;
  const windowData = new Float32Array(WINDOW * WINDOW * WINDOW);
  let done = 0;

  for (const z0 of startsZ) {
    for (const y0 of startsY) {
      for (const x0 of startsX) {
        let w = 0;
        for (let z = 0; z < WINDOW; z += 1) {
          for (let y = 0; y < WINDOW; y += 1) {
            const base = ((z0 + z) * ph + (y0 + y)) * pw + x0;
            for (let x = 0; x < WINDOW; x += 1) {
              windowData[w] = padded[base + x];
              w += 1;
            }
          }
        }

        const tensor = new ort.Tensor('float32', windowData.slice(), [
          1,
          1,
          WINDOW,
          WINDOW,
          WINDOW,
        ]);
        const output = await session.run({ input: tensor });
        const logits = output.logits.data as Float32Array;
        const channel = WINDOW * WINDOW * WINDOW;

        let idx = 0;
        for (let z = 0; z < WINDOW; z += 1) {
          for (let y = 0; y < WINDOW; y += 1) {
            const base = ((z0 + z) * ph + (y0 + y)) * pw + x0;
            for (let x = 0; x < WINDOW; x += 1) {
              const l0 = logits[idx];
              const l1 = logits[channel + idx];
              const fg = 1 / (1 + Math.exp(l0 - l1));
              probSum[base + x] += fg;
              weight[base + x] += 1;
              idx += 1;
            }
          }
        }

        done += 1;
        self.postMessage({ type: 'progress', completed: done, total });
      }
    }
  }

  // Threshold averaged probability and crop back to original size.
  const mask = new Uint8Array(cd * ch * cw);
  let voxelCount = 0;
  let out = 0;
  for (let z = 0; z < cd; z += 1) {
    for (let y = 0; y < ch; y += 1) {
      const base = ((z + offZ) * ph + (y + offY)) * pw + offX;
      for (let x = 0; x < cw; x += 1) {
        const w = weight[base + x];
        const prob = w > 0 ? probSum[base + x] / w : 0;
        if (prob > 0.5) {
          mask[out] = 1;
          voxelCount += 1;
        }
        out += 1;
      }
    }
  }

  return {
    type: 'result',
    mask: mask.buffer,
    dims: [cd, ch, cw],
    voxelCount,
  };
}

self.onmessage = async (event: MessageEvent<ToothSegRequest>) => {
  try {
    const response = await segment(event.data);
    const transfer =
      response.type === 'result' ? [response.mask] : [];
    self.postMessage(response, transfer);
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Segmentation failed.',
    } satisfies ToothSegResponse);
  }
};
