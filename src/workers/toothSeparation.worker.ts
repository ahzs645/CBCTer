import { watershedSplit } from '../lib/segmentation/watershed';
import type { Vec3 } from '../types';
self.onmessage = (
  event: MessageEvent<{
    mask: Uint8Array;
    dimensions: Vec3;
    minVoxels: number;
    coreThreshold: number;
    maxRoi: number;
  }>,
) => {
  try {
    const {
      mask,
      dimensions: d,
      minVoxels,
      coreThreshold,
      maxRoi,
    } = event.data;
    const min = [...d],
      max = [-1, -1, -1];
    for (let i = 0; i < mask.length; i++)
      if (mask[i]) {
        const p = [
          i % d[0],
          Math.floor(i / d[0]) % d[1],
          Math.floor(i / (d[0] * d[1])),
        ];
        for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a], p[a]);
          max[a] = Math.max(max[a], p[a]);
        }
      }
    if (max[0] < 0) throw new Error('The selected source has no tooth voxels.');
    const shape = min.map((n, a) => max[a] - n + 3) as Vec3;
    if (shape.reduce((a, b) => a * b, 1) > maxRoi)
      throw new Error(
        'The tooth region is too large for separation on this device. Select a smaller mask or separate one jaw at a time.',
      );
    const roi = new Uint8Array(shape.reduce((a, b) => a * b, 1));
    for (let z = min[2]; z <= max[2]; z++)
      for (let y = min[1]; y <= max[1]; y++)
        for (let x = min[0]; x <= max[0]; x++)
          roi[
            ((z - min[2] + 1) * shape[1] + y - min[1] + 1) * shape[0] +
              x -
              min[0] +
              1
          ] = mask[(z * d[1] + y) * d[0] + x];
    const result = watershedSplit(roi, [shape[2], shape[1], shape[0]], {
      coreThreshold,
    });
    const map = new Map<number, number>();
    result.components
      .filter((c) => c.voxels >= minVoxels)
      .forEach((c, i) => map.set(c.id, i + 1));
    if (map.size > 65535)
      throw new Error('Too many proposed teeth. Increase the minimum size.');
    const labels = new Uint16Array(mask.length);
    for (let z = min[2]; z <= max[2]; z++)
      for (let y = min[1]; y <= max[1]; y++)
        for (let x = min[0]; x <= max[0]; x++)
          labels[(z * d[1] + y) * d[0] + x] =
            map.get(
              result.labels[
                ((z - min[2] + 1) * shape[1] + y - min[1] + 1) * shape[0] +
                  x -
                  min[0] +
                  1
              ],
            ) ?? 0;
    postMessage({ labels }, [labels.buffer]);
  } catch (e) {
    postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
