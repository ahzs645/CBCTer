/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web';
import { resampleVolume } from '../lib/volume/resample';
import { decodeYoloSegMasks, type YoloMaskInstance } from '../lib/segmentation/yoloSegDecode';
import type { Vec3 } from '../types';

// Match the single-class training preprocessing: resample to 0.3 mm isotropic,
// fixed CT window, per-axial-slice YOLOv8-seg, union mask plus tracked
// per-detection seed labels -> 3D tooth volume.
const INPUT = 512;
const TARGET_SPACING = 0.3;
const DEFAULT_CONF = 0.15;
const DEFAULT_MASK_THRESHOLD = 0.7;
const HU_LO = -113.8;
const HU_HI = 4021;
const MAX_TRACK_GAP = 2;
const MIN_TRACK_OVERLAP = 0.12;
const MAX_SEED_LABEL = 65535;

export type ToothYoloModelVariant = 'legacy' | '2p5d';

const MODEL_CONFIG: Record<
  ToothYoloModelVariant,
  { filename: string; contextSlices: number }
> = {
  legacy: { filename: 'tooth-yolov8n-seg.onnx', contextSlices: 0 },
  // Trained with RGB = z-2, z, z+2 on the 0.3 mm inference grid.
  '2p5d': { filename: 'tooth-yolov8n-seg-2p5d.onnx', contextSlices: 2 },
};

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
  /** Defaults to the shipping single-slice checkpoint. */
  modelVariant?: ToothYoloModelVariant;
}

export type ToothYoloResponse =
  | { type: 'progress'; completed: number; total: number }
  | {
      type: 'result';
      mask: ArrayBuffer; // Uint8 [oD, oH, oW]
      seedLabels?: ArrayBuffer; // Uint16 [oD, oH, oW], 0 = unseeded
      seedCount: number;
      dims: [number, number, number];
      spacing: Vec3;
      voxelCount: number;
    }
  | { type: 'error'; message: string };

const sessionPromises = new Map<ToothYoloModelVariant, Promise<ort.InferenceSession>>();
function getSession(variant: ToothYoloModelVariant): Promise<ort.InferenceSession> {
  let promise = sessionPromises.get(variant);
  if (!promise) {
    promise = ort.InferenceSession.create(`${BASE}models/${MODEL_CONFIG[variant].filename}`, {
      executionProviders,
    });
    sessionPromises.set(variant, promise);
  }
  return promise;
}

/** Letterbox neighbor/center/neighbor [h,w] slices into a [1,3,512,512] tensor. */
function preprocessSlices(
  slices: [Float32Array, Float32Array, Float32Array],
  h: number,
  w: number,
) {
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
      const idx = (padY + oy) * INPUT + (padX + ox);
      for (let channel = 0; channel < 3; channel += 1) {
        const slice = slices[channel];
        const v00 = slice[y0 * w + x0];
        const v01 = slice[y0 * w + x1];
        const v10 = slice[y1 * w + x0];
        const v11 = slice[y1 * w + x1];
        const v =
          (v00 * (1 - fx) + v01 * fx) * (1 - fy) +
          (v10 * (1 - fx) + v11 * fx) * fy;
        let n = (v - HU_LO) / range;
        n = n < 0 ? 0 : n > 1 ? 1 : n;
        chw[channel * plane + idx] = n;
      }
    }
  }
  return { chw, padX, padY, newW, newH };
}

interface SliceSeed {
  pixels: Int32Array; // y * width + x in the resampled volume slice
  score: number;
}

interface ActiveTrack {
  id: number;
  lastZ: number;
  pixels: Int32Array;
}

function sparseIntersection(a: Int32Array, b: Int32Array): number {
  let i = 0;
  let j = 0;
  let count = 0;
  while (i < a.length && j < b.length) {
    const av = a[i];
    const bv = b[j];
    if (av === bv) {
      count += 1;
      i += 1;
      j += 1;
    } else if (av < bv) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return count;
}

function mapInstanceToVolumeSlice(
  instance: YoloMaskInstance,
  padX: number,
  padY: number,
  newW: number,
  newH: number,
  volumeW: number,
  volumeH: number,
): SliceSeed | null {
  const mapped: number[] = [];
  const xMax = padX + newW;
  const yMax = padY + newH;

  for (let i = 0; i < instance.pixels.length; i += 1) {
    const pixel = instance.pixels[i];
    const ly = Math.floor(pixel / INPUT);
    const lx = pixel - ly * INPUT;
    if (lx < padX || lx >= xMax || ly < padY || ly >= yMax) continue;

    const x = Math.min(
      volumeW - 1,
      Math.max(0, Math.floor(((lx - padX + 0.5) * volumeW) / newW)),
    );
    const y = Math.min(
      volumeH - 1,
      Math.max(0, Math.floor(((ly - padY + 0.5) * volumeH) / newH)),
    );
    mapped.push(y * volumeW + x);
  }

  if (mapped.length === 0) return null;
  mapped.sort((a, b) => a - b);
  let write = 0;
  for (let read = 0; read < mapped.length; read += 1) {
    if (read > 0 && mapped[read] === mapped[read - 1]) continue;
    mapped[write] = mapped[read];
    write += 1;
  }

  return {
    pixels: Int32Array.from(mapped.slice(0, write)),
    score: instance.detection.score,
  };
}

function chooseTrack(
  seed: SliceSeed,
  z: number,
  activeTracks: Map<number, ActiveTrack>,
  usedTracks: Set<number>,
): number | null {
  let bestTrack: ActiveTrack | null = null;
  let bestScore = 0;

  for (const track of activeTracks.values()) {
    if (usedTracks.has(track.id)) continue;
    const gap = z - track.lastZ;
    if (gap < 1 || gap > MAX_TRACK_GAP) continue;
    const intersection = sparseIntersection(seed.pixels, track.pixels);
    if (intersection === 0) continue;
    const score = intersection / Math.min(seed.pixels.length, track.pixels.length);
    if (score > bestScore) {
      bestScore = score;
      bestTrack = track;
    }
  }

  return bestTrack && bestScore >= MIN_TRACK_OVERLAP ? bestTrack.id : null;
}

async function run(req: ToothYoloRequest): Promise<ToothYoloResponse> {
  const modelVariant = req.modelVariant ?? 'legacy';
  const modelConfig = MODEL_CONFIG[modelVariant];
  const session = await getSession(modelVariant);
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
  const seedLabels = new Uint16Array(oD * oH * oW);
  let voxelCount = 0;
  let nextTrackId = 1;
  const sliceLen = oH * oW;
  const conf = req.conf ?? DEFAULT_CONF;
  const maskThreshold = req.maskThreshold ?? DEFAULT_MASK_THRESHOLD;
  const activeTracks = new Map<number, ActiveTrack>();

  for (let z = 0; z < oD; z += 1) {
    const context = modelConfig.contextSlices;
    const z0 = Math.max(0, z - context);
    const z2 = Math.min(oD - 1, z + context);
    const slices: [Float32Array, Float32Array, Float32Array] = [z0, z, z2].map(
      (sliceZ) => vol.subarray(sliceZ * sliceLen, (sliceZ + 1) * sliceLen),
    ) as [Float32Array, Float32Array, Float32Array];
    const { chw, padX, padY, newW, newH } = preprocessSlices(slices, oH, oW);
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
      const { mask, instances } = decodeYoloSegMasks(
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

      const seeds = instances
        .map((instance) => mapInstanceToVolumeSlice(instance, padX, padY, newW, newH, oW, oH))
        .filter((seed): seed is SliceSeed => seed !== null && seed.pixels.length > 0)
        .sort((a, b) => b.score - a.score);
      const usedTracks = new Set<number>();
      for (const seed of seeds) {
        let trackId = chooseTrack(seed, z, activeTracks, usedTracks);
        if (trackId === null) {
          if (nextTrackId > MAX_SEED_LABEL) continue;
          trackId = nextTrackId;
          nextTrackId += 1;
        }
        usedTracks.add(trackId);
        activeTracks.set(trackId, { id: trackId, lastZ: z, pixels: seed.pixels });

        for (let i = 0; i < seed.pixels.length; i += 1) {
          const index = base + seed.pixels[i];
          if (mask3d[index] && seedLabels[index] === 0) seedLabels[index] = trackId;
        }
      }
    }
    for (const [trackId, track] of activeTracks) {
      if (z - track.lastZ > MAX_TRACK_GAP) activeTracks.delete(trackId);
    }
    self.postMessage({ type: 'progress', completed: z + 1, total: oD } satisfies ToothYoloResponse);
  }

  return {
    type: 'result',
    mask: mask3d.buffer,
    seedLabels: seedLabels.buffer,
    seedCount: nextTrackId - 1,
    dims: [oD, oH, oW],
    spacing: [TARGET_SPACING, TARGET_SPACING, TARGET_SPACING],
    voxelCount,
  };
}

self.onmessage = async (event: MessageEvent<ToothYoloRequest>) => {
  try {
    const response = await run(event.data);
    const transfer: Transferable[] = [];
    if (response.type === 'result') {
      transfer.push(response.mask);
      if (response.seedLabels) transfer.push(response.seedLabels);
    }
    self.postMessage(response, transfer);
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'YOLO tooth segmentation failed.',
    } satisfies ToothYoloResponse);
  }
};
