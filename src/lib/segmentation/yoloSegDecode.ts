/**
 * Decode YOLOv8-seg ONNX outputs into a per-slice binary mask.
 *
 * Single-class ("tooth") model:
 *   output0: [1, 4 + 1 + 32, numAnchors]  (cx, cy, w, h, score, 32 mask coeffs) — channel-major
 *   output1: [1, 32, protoH, protoW]      (32 mask prototypes)
 *
 * mask(px,py) = sigmoid( sum_k coeff_k * proto_k(px,py) ), cropped to each box, thresholded,
 * unioned across detections. Pure functions (no ONNX) so they unit-test in Node.
 */

export const MASK_COEFFS = 32;

export interface YoloSegOptions {
  conf?: number; // detection confidence threshold (default 0.25)
  iou?: number; // NMS IoU threshold (default 0.45)
  maxDet?: number; // max detections kept (default 300)
  maskThreshold?: number; // mask binarization threshold on sigmoid prob (default 0.5)
}

export interface YoloDetection {
  /** [x1, y1, x2, y2] in model input pixel space. */
  box: [number, number, number, number];
  score: number;
  coeffs: Float32Array; // length 32
}

export interface YoloMaskInstance {
  /** Detection that produced this mask. */
  detection: YoloDetection;
  /** Sparse mask pixels in model input space, encoded as `y * inputSize + x`. */
  pixels: Int32Array;
}

function iouBox(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const ix1 = Math.max(a[0], b[0]);
  const iy1 = Math.max(a[1], b[1]);
  const ix2 = Math.min(a[2], b[2]);
  const iy2 = Math.min(a[3], b[3]);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/** Parse output0 into thresholded, NMS-filtered detections (boxes in input pixel space). */
export function decodeDetections(
  out0: Float32Array,
  numChannels: number,
  numAnchors: number,
  options: YoloSegOptions = {},
): YoloDetection[] {
  const conf = options.conf ?? 0.25;
  const iou = options.iou ?? 0.45;
  const maxDet = options.maxDet ?? 300;
  if (numChannels !== 5 + MASK_COEFFS) {
    throw new Error(`expected ${5 + MASK_COEFFS} channels (single-class), got ${numChannels}`);
  }
  const dets: YoloDetection[] = [];
  const scoreRow = 4 * numAnchors;
  for (let a = 0; a < numAnchors; a += 1) {
    const score = out0[scoreRow + a];
    if (score < conf) continue;
    const cx = out0[a];
    const cy = out0[numAnchors + a];
    const w = out0[2 * numAnchors + a];
    const h = out0[3 * numAnchors + a];
    const coeffs = new Float32Array(MASK_COEFFS);
    for (let k = 0; k < MASK_COEFFS; k += 1) {
      coeffs[k] = out0[(5 + k) * numAnchors + a];
    }
    dets.push({ box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], score, coeffs });
  }
  dets.sort((p, q) => q.score - p.score);
  const keep: YoloDetection[] = [];
  for (const d of dets) {
    if (keep.length >= maxDet) break;
    let suppressed = false;
    for (const k of keep) {
      if (iouBox(d.box, k.box) > iou) {
        suppressed = true;
        break;
      }
    }
    if (!suppressed) keep.push(d);
  }
  return keep;
}

/**
 * Rasterize the union of detection masks at `inputSize` × `inputSize` (model input space).
 * Each detection's mask is evaluated only inside its box (crop-to-box) from the prototypes.
 */
export function buildUnionMask(
  dets: YoloDetection[],
  protos: Float32Array,
  protoH: number,
  protoW: number,
  inputSize: number,
  options: YoloSegOptions = {},
): Uint8Array {
  const out = new Uint8Array(inputSize * inputSize);
  for (const instance of buildInstanceMasks(dets, protos, protoH, protoW, inputSize, options)) {
    for (let i = 0; i < instance.pixels.length; i += 1) out[instance.pixels[i]] = 1;
  }
  return out;
}

/**
 * Rasterize every detection mask separately at model input resolution.
 *
 * Keeping sparse per-detection pixels lets the 3D pipeline use YOLO instances as
 * watershed seeds instead of losing separation by immediately unioning them.
 */
export function buildInstanceMasks(
  dets: YoloDetection[],
  protos: Float32Array,
  protoH: number,
  protoW: number,
  inputSize: number,
  options: YoloSegOptions = {},
): YoloMaskInstance[] {
  const thr = options.maskThreshold ?? 0.5;
  const planeP = protoH * protoW;
  const sx = protoW / inputSize;
  const sy = protoH / inputSize;
  const instances: YoloMaskInstance[] = [];

  for (const d of dets) {
    const x1 = Math.max(0, Math.floor(d.box[0]));
    const y1 = Math.max(0, Math.floor(d.box[1]));
    const x2 = Math.min(inputSize, Math.ceil(d.box[2]));
    const y2 = Math.min(inputSize, Math.ceil(d.box[3]));
    const pixels: number[] = [];
    for (let y = y1; y < y2; y += 1) {
      const py = Math.min(protoH - 1, Math.floor(y * sy));
      const protoRow = py * protoW;
      const inputRow = y * inputSize;
      for (let x = x1; x < x2; x += 1) {
        const px = Math.min(protoW - 1, Math.floor(x * sx));
        let acc = 0;
        for (let k = 0; k < MASK_COEFFS; k += 1) {
          acc += d.coeffs[k] * protos[k * planeP + protoRow + px];
        }
        const prob = 1 / (1 + Math.exp(-acc));
        if (prob > thr) pixels.push(inputRow + x);
      }
    }
    if (pixels.length > 0) {
      instances.push({ detection: d, pixels: Int32Array.from(pixels) });
    }
  }
  return instances;
}

/** Convenience: decode raw output tensors → union binary mask at model input resolution. */
export function decodeYoloSegMask(
  out0: Float32Array,
  out0Shape: [number, number, number], // [1, channels, anchors]
  out1: Float32Array,
  out1Shape: [number, number, number, number], // [1, 32, protoH, protoW]
  inputSize: number,
  options: YoloSegOptions = {},
): { mask: Uint8Array; count: number } {
  const { mask, count } = decodeYoloSegMasks(
    out0,
    out0Shape,
    out1,
    out1Shape,
    inputSize,
    options,
  );
  return { mask, count };
}

/** Decode raw output tensors into both the union mask and per-detection masks. */
export function decodeYoloSegMasks(
  out0: Float32Array,
  out0Shape: [number, number, number], // [1, channels, anchors]
  out1: Float32Array,
  out1Shape: [number, number, number, number], // [1, 32, protoH, protoW]
  inputSize: number,
  options: YoloSegOptions = {},
): { mask: Uint8Array; count: number; instances: YoloMaskInstance[] } {
  const [, channels, anchors] = out0Shape;
  const [, , protoH, protoW] = out1Shape;
  const dets = decodeDetections(out0, channels, anchors, options);
  const instances = buildInstanceMasks(dets, out1, protoH, protoW, inputSize, options);
  const mask = new Uint8Array(inputSize * inputSize);
  for (const instance of instances) {
    for (let i = 0; i < instance.pixels.length; i += 1) mask[instance.pixels[i]] = 1;
  }
  return { mask, count: dets.length, instances };
}
