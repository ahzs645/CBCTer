import { describe, expect, it } from 'vitest';
import {
  MASK_COEFFS,
  buildInstanceMasks,
  buildUnionMask,
  decodeDetections,
  decodeYoloSegMask,
  decodeYoloSegMasks,
} from './yoloSegDecode';

const CH = 5 + MASK_COEFFS; // 37

/** Build a channel-major output0 [1, 37, anchors] from per-anchor records. */
function makeOut0(
  anchors: Array<{ cx: number; cy: number; w: number; h: number; score: number; coeff0?: number }>,
): Float32Array {
  const n = anchors.length;
  const out = new Float32Array(CH * n);
  anchors.forEach((a, i) => {
    out[0 * n + i] = a.cx;
    out[1 * n + i] = a.cy;
    out[2 * n + i] = a.w;
    out[3 * n + i] = a.h;
    out[4 * n + i] = a.score;
    out[5 * n + i] = a.coeff0 ?? 0; // coeff for prototype 0
  });
  return out;
}

describe('yoloSegDecode', () => {
  it('keeps only confident detections', () => {
    const out0 = makeOut0([
      { cx: 4, cy: 4, w: 2, h: 2, score: 0.9 },
      { cx: 1, cy: 1, w: 1, h: 1, score: 0.1 },
    ]);
    const dets = decodeDetections(out0, CH, 2, { conf: 0.25 });
    expect(dets).toHaveLength(1);
    expect(dets[0].box).toEqual([3, 3, 5, 5]);
  });

  it('suppresses overlapping boxes via NMS', () => {
    const out0 = makeOut0([
      { cx: 4, cy: 4, w: 4, h: 4, score: 0.9 },
      { cx: 4.2, cy: 4.2, w: 4, h: 4, score: 0.8 }, // ~fully overlapping
    ]);
    const dets = decodeDetections(out0, CH, 2, { conf: 0.25, iou: 0.45 });
    expect(dets).toHaveLength(1);
    expect(dets[0].score).toBeCloseTo(0.9, 5);
  });

  it('rasterizes mask inside the box from prototype 0', () => {
    const inputSize = 8;
    const protoH = 4;
    const protoW = 4;
    // coeff0 large positive, proto0 all ones -> sigmoid ~1 everywhere; other protos zero.
    const out0 = makeOut0([{ cx: 4, cy: 4, w: 4, h: 4, score: 0.9, coeff0: 10 }]);
    const protos = new Float32Array(MASK_COEFFS * protoH * protoW);
    for (let i = 0; i < protoH * protoW; i += 1) protos[i] = 1; // prototype 0 = ones
    const dets = decodeDetections(out0, CH, 1);
    const mask = buildUnionMask(dets, protos, protoH, protoW, inputSize);
    // box is [2,2,6,6]; inside should be set, outside clear
    expect(mask[4 * inputSize + 4]).toBe(1); // center, inside box
    expect(mask[0]).toBe(0); // corner, outside box
    expect(mask[2 * inputSize + 2]).toBe(1); // box top-left inclusive
    expect(mask[6 * inputSize + 6]).toBe(0); // just outside box (x2=6 exclusive)
  });

  it('keeps per-detection instance masks before unioning', () => {
    const inputSize = 8;
    const protoH = 4;
    const protoW = 4;
    const out0 = makeOut0([
      { cx: 2, cy: 2, w: 2, h: 2, score: 0.9, coeff0: 10 },
      { cx: 6, cy: 6, w: 2, h: 2, score: 0.8, coeff0: 10 },
    ]);
    const protos = new Float32Array(MASK_COEFFS * protoH * protoW);
    for (let i = 0; i < protoH * protoW; i += 1) protos[i] = 1;

    const dets = decodeDetections(out0, CH, 2);
    const instances = buildInstanceMasks(dets, protos, protoH, protoW, inputSize);

    expect(instances).toHaveLength(2);
    expect([...instances[0].pixels]).toContain(2 * inputSize + 2);
    expect([...instances[0].pixels]).not.toContain(6 * inputSize + 6);
    expect([...instances[1].pixels]).toContain(6 * inputSize + 6);
  });

  it('end-to-end decode returns a non-empty mask', () => {
    const out0 = makeOut0([{ cx: 4, cy: 4, w: 4, h: 4, score: 0.9, coeff0: 10 }]);
    const protos = new Float32Array(MASK_COEFFS * 4 * 4).fill(0);
    for (let i = 0; i < 16; i += 1) protos[i] = 1;
    const { mask, count } = decodeYoloSegMask(out0, [1, CH, 1], protos, [1, 32, 4, 4], 8);
    expect(count).toBe(1);
    expect(mask.reduce((s, v) => s + v, 0)).toBeGreaterThan(0);
  });

  it('end-to-end decode returns sparse instances matching the union mask', () => {
    const out0 = makeOut0([{ cx: 4, cy: 4, w: 4, h: 4, score: 0.9, coeff0: 10 }]);
    const protos = new Float32Array(MASK_COEFFS * 4 * 4).fill(0);
    for (let i = 0; i < 16; i += 1) protos[i] = 1;

    const { mask, instances } = decodeYoloSegMasks(
      out0,
      [1, CH, 1],
      protos,
      [1, 32, 4, 4],
      8,
    );

    expect(instances).toHaveLength(1);
    for (const pixel of instances[0].pixels) expect(mask[pixel]).toBe(1);
  });
});
