/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web';
import { resampleVolume } from '../lib/volume/resample';
import { decodeYoloSegMask } from '../lib/segmentation/yoloSegDecode';
import type { Vec3 } from '../types';

// Match the single-class training preprocessing: resample to 0.3 mm isotropic,
// fixed CT window, per-axial-slice YOLOv8-seg, union mask -> 3D tooth volume.
const INPUT = 512;
const TARGET_SPACING = 0.3;
const HU_LO = -113.8;
const HU_HI = 4021;

const BASE = import.meta.env.BASE_URL;
ort.env.wasm.wasmPaths = `${BASE}ort/`;
const threaded = self.crossOriginIsolated && (navigator.hardwareConcurrency ?? 1) > 1;
ort.env.wasm.numThreads = threaded ? Math.min(navigator.hardwareConcurrency ?? 1, 16) : 1;
const executionProviders: ('wasm' | 'webgpu')[] = threaded ? ['wasm'] : ['webgpu', 'wasm'];

export interface ToothYoloRequest {
  /** Raw volume voxels (Int16) in [D, H, W] order. */
  voxels: ArrayBuffer;
  dims: [number, number, number]; // [D, H, W]
  spacing: Vec3; // [x, y, z] mm
  conf?: number;
  maskThreshold?: number;
}

export type ToothYoloResponse =
  | { type: 'progress'; completed: number; total: number }
  | {
      type: 'result';
      mask: ArrayBuffer; // Uint8 [oD, oH, oW]
      dims: [number, number, number];
      spacing: Vec3;
      voxelCount: number;
    }
  | { type: 'error'; message: string };

let sessionPromise: Promise<ort.InferenceSession> | null = null;
function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(`${BASE}models/tooth-yolov8n-seg.onnx`, {
      executionProviders,
    });
  }
  return sessionPromise;
}

/** Letterbox one [h,w] slice into a [1,3,512,512] tensor (CT-window normalized, grayscale->RGB). */
function preprocessSlice(slice: Float32Array, h: number, w: number) {
  const scale = INPUT / Math.max(h, w);
  const newW = Math.max(1, Math.round(w * scale));
  const newH = Math.max(1, Math.round(h * scale));
  const padX = Math.floor((INPUT - newW) / 2);
  const padY = Math.floor((INPUT - newH) / 2);
  const range = Math.max(1, HU_HI - HU_LO);
  const plane = INPUT * INPUT;
  const chw = new Float32Array(3 * plane); // zero-padded (air maps to 0)
  const rx = w / newW;
  const ry = h / newH;
  for (let oy = 0; oy < newH; oy += 1) {
    const sy = (oy + 0.5) * ry - 0.5;
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(sy)));
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sy - Math.floor(sy)));
    for (let ox = 0; ox < newW; ox += 1) {
      const sx = (ox + 0.5) * rx - 0.5;
      const x0 = Math.max(0, Math.min(w - 1, Math.floor(sx)));
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sx - Math.floor(sx)));
      const v00 = slice[y0 * w + x0];
      const v01 = slice[y0 * w + x1];
      const v10 = slice[y1 * w + x0];
      const v11 = slice[y1 * w + x1];
      const v = (v00 * (1 - fx) + v01 * fx) * (1 - fy) + (v10 * (1 - fx) + v11 * fx) * fy;
      let n = (v - HU_LO) / range;
      n = n < 0 ? 0 : n > 1 ? 1 : n;
      const idx = (padY + oy) * INPUT + (padX + ox);
      chw[idx] = n;
      chw[plane + idx] = n;
      chw[2 * plane + idx] = n;
    }
  }
  return { chw, padX, padY, newW, newH };
}

async function run(req: ToothYoloRequest): Promise<ToothYoloResponse> {
  const session = await getSession();
  const inputName = session.inputNames[0];

  // Resample whole volume to 0.3 mm isotropic.
  const src = new Int16Array(req.voxels);
  const { data: vol, dims: rdims } = resampleVolume(
    src,
    req.dims,
    req.spacing,
    [TARGET_SPACING, TARGET_SPACING, TARGET_SPACING],
    'linear',
  );
  const [oD, oH, oW] = rdims;
  const mask3d = new Uint8Array(oD * oH * oW);
  let voxelCount = 0;
  const sliceLen = oH * oW;
  const conf = req.conf ?? 0.25;
  const maskThreshold = req.maskThreshold ?? 0.5;

  for (let z = 0; z < oD; z += 1) {
    const slice = vol.subarray(z * sliceLen, (z + 1) * sliceLen);
    const { chw, padX, padY, newW, newH } = preprocessSlice(slice, oH, oW);
    const tensor = new ort.Tensor('float32', chw, [1, 3, INPUT, INPUT]);
    const out = await session.run({ [inputName]: tensor });
    // Identify outputs by rank: 3D = detections [1,C,N], 4D = prototypes [1,32,ph,pw].
    let det: ort.Tensor | null = null;
    let proto: ort.Tensor | null = null;
    for (const name of session.outputNames) {
      const t = out[name];
      if (t.dims.length === 3) det = t;
      else if (t.dims.length === 4) proto = t;
    }
    if (det && proto) {
      const { mask } = decodeYoloSegMask(
        det.data as Float32Array,
        det.dims as [number, number, number],
        proto.data as Float32Array,
        proto.dims as [number, number, number, number],
        INPUT,
        { conf, maskThreshold },
      );
      // Un-letterbox: map the [newH,newW] region back to [oH,oW].
      const base = z * sliceLen;
      for (let y = 0; y < oH; y += 1) {
        const ly = padY + Math.min(newH - 1, Math.floor((y * newH) / oH));
        for (let x = 0; x < oW; x += 1) {
          const lx = padX + Math.min(newW - 1, Math.floor((x * newW) / oW));
          if (mask[ly * INPUT + lx]) {
            mask3d[base + y * oW + x] = 1;
            voxelCount += 1;
          }
        }
      }
    }
    self.postMessage({ type: 'progress', completed: z + 1, total: oD } satisfies ToothYoloResponse);
  }

  return {
    type: 'result',
    mask: mask3d.buffer,
    dims: [oD, oH, oW],
    spacing: [TARGET_SPACING, TARGET_SPACING, TARGET_SPACING],
    voxelCount,
  };
}

self.onmessage = async (event: MessageEvent<ToothYoloRequest>) => {
  try {
    const response = await run(event.data);
    const transfer = response.type === 'result' ? [response.mask] : [];
    self.postMessage(response, transfer);
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'YOLO tooth segmentation failed.',
    } satisfies ToothYoloResponse);
  }
};
