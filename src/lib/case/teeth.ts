import type { PreparedVolumeFor3D, Vec3 } from '../../types';
import type { ToothInstance } from './types';
export const FDI_NUMBERS = [1, 2, 3, 4]
  .flatMap((q) => Array.from({ length: 8 }, (_, i) => q * 10 + i + 1))
  .concat(
    [5, 6, 7, 8].flatMap((q) =>
      Array.from({ length: 5 }, (_, i) => q * 10 + i + 1),
    ),
  );
export function summarizeTeeth(
  labels: Uint16Array,
  dims: Vec3,
  groupId: string,
  previous: ToothInstance[] = [],
  source: ToothInstance['source'] = 'separation',
): ToothInstance[] {
  if (labels.length !== dims.reduce((a, b) => a * b, 1))
    throw new Error('Tooth grid does not match the scan.');
  const stats = new Map<
    number,
    { count: number; sum: Vec3; min: Vec3; max: Vec3 }
  >();
  for (let i = 0; i < labels.length; i++) {
    const value = labels[i];
    if (!value) continue;
    const p: Vec3 = [
      i % dims[0],
      Math.floor(i / dims[0]) % dims[1],
      Math.floor(i / (dims[0] * dims[1])),
    ];
    let s = stats.get(value);
    if (!s) {
      s = { count: 0, sum: [0, 0, 0], min: [...p], max: [...p] };
      stats.set(value, s);
    }
    s.count++;
    for (let a = 0; a < 3; a++) {
      s.sum[a] += p[a];
      s.min[a] = Math.min(s.min[a], p[a]);
      s.max[a] = Math.max(s.max[a], p[a]);
    }
  }
  return [...stats].map(([value, s]) => ({
    ...(previous.find((t) => t.groupId === groupId && t.value === value) ?? {
      id: crypto.randomUUID(),
      groupId,
      value,
      fdi: null,
      review: 'unreviewed' as const,
      source,
    }),
    voxelCount: s.count,
    centroid: s.sum.map((v) => v / s.count) as Vec3,
    bounds: { min: s.min, max: s.max },
  }));
}
export function splitTooth(
  labels: Uint16Array,
  dims: Vec3,
  value: number,
  axis: 0 | 1 | 2,
  cut: number,
) {
  if (!Number.isFinite(cut)) throw new Error('Choose a split position.');
  const used = new Set(labels);
  let next = 1;
  while (used.has(next) && next < 65536) next++;
  if (next > 65535) throw new Error('No free tooth labels.');
  let left = 0,
    right = 0;
  const output = new Uint16Array(labels);
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== value) continue;
    const coordinate =
      axis === 0
        ? i % dims[0]
        : axis === 1
          ? Math.floor(i / dims[0]) % dims[1]
          : Math.floor(i / (dims[0] * dims[1]));
    if (coordinate >= cut) {
      output[i] = next;
      right++;
    } else left++;
  }
  if (!left || !right)
    throw new Error(
      'The split plane must pass through the tooth. Move the crosshair inside it.',
    );
  return { labels: output, newValue: next };
}
export function mergeTeeth(
  labels: Uint16Array,
  primary: number,
  other: number,
) {
  if (primary === other || !labels.includes(primary) || !labels.includes(other))
    throw new Error('Choose two existing teeth.');
  return labels.map((v) => (v === other ? primary : v));
}
/** Hide labels in the quantized 3D texture without changing the original CT. */
export function isolatePreview(
  preview: PreparedVolumeFor3D,
  labels: Uint16Array,
  dims: Vec3,
  value: number,
  mode: 'all' | 'selected' | 'hide-teeth',
  bone?: Uint16Array,
  boneValues: number[] = [1, 2],
  toothLayers: Uint16Array[] = [labels],
): PreparedVolumeFor3D {
  if (mode === 'all') return preview;
  const voxels = new Uint8Array(preview.voxels.length),
    out = preview.dimensions;
  for (let z = 0; z < out[2]; z++)
    for (let y = 0; y < out[1]; y++)
      for (let x = 0; x < out[0]; x++) {
        const p = [x, y, z].map((n, a) =>
            out[a] <= 1 ? 0 : Math.round((n / (out[a] - 1)) * (dims[a] - 1)),
          ),
          source = (p[2] * dims[1] + p[1]) * dims[0] + p[0],
          index = (z * out[1] + y) * out[0] + x;
        const visible =
          mode === 'hide-teeth'
            ? toothLayers.every((layer) => layer[source] === 0)
            : labels[source] === value ||
              (bone && boneValues.includes(bone[source]));
        if (visible) voxels[index] = preview.voxels[index];
      }
  return { ...preview, voxels };
}
