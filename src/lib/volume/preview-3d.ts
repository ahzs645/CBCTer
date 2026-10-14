import type { LoadedVolume, PreparedVolumeFor3D, Vec3 } from '../../types';
import { clamp } from './math';

const MAX_3D_TEXTURE_EDGE = 512;
const HISTOGRAM_BINS = 4096;

function sampleIndex(
  outIndex: number,
  outSize: number,
  sourceSize: number,
): number {
  if (outSize <= 1 || sourceSize <= 1) return 0;
  return Math.min(
    sourceSize - 1,
    Math.round((outIndex / (outSize - 1)) * (sourceSize - 1)),
  );
}

// Both passes go through a 65536-entry table (one per Int16 value) instead
// of doing the arithmetic per voxel: several times faster on big previews.
function quantizePreviewVoxels(
  voxels: Int16Array,
  scalarRange: [number, number],
): Uint8Array {
  const [scalarMin, scalarMax] = scalarRange;
  const span = Math.max(1, scalarMax - scalarMin);
  const table = new Uint8Array(65536);
  for (let value = -32768; value < 32768; value += 1)
    table[value + 32768] = Math.round(
      clamp((value - scalarMin) / span, 0, 1) * 255,
    );
  const out = new Uint8Array(voxels.length);
  for (let index = 0; index < voxels.length; index += 1)
    out[index] = table[voxels[index] + 32768];
  return out;
}

function buildScalarHistogram(
  voxels: Int16Array,
  scalarRange: [number, number],
): { histogram: Uint32Array; included: number } {
  const histogram = new Uint32Array(HISTOGRAM_BINS);
  const [min, max] = scalarRange;
  const span = Math.max(1, max - min);
  const counts = new Uint32Array(65536);
  for (let index = 0; index < voxels.length; index += 1)
    counts[voxels[index] + 32768] += 1;
  let included = 0;
  const lo = Math.max(-32768, Math.ceil(min)),
    hi = Math.min(32767, Math.floor(max));
  for (let value = lo; value <= hi; value += 1) {
    const count = counts[value + 32768];
    if (!count) continue;
    const bucket = Math.max(
      0,
      Math.min(
        histogram.length - 1,
        Math.round(((value - min) / span) * (histogram.length - 1)),
      ),
    );
    histogram[bucket] += count;
    included += count;
  }

  return { histogram, included };
}

function resolveHistogramPercentile(
  histogram: Uint32Array,
  total: number,
  percentile: number,
  scalarRange: [number, number],
): number {
  const threshold = Math.max(
    0,
    Math.min(total - 1, Math.floor(total * percentile)),
  );
  let cumulative = 0;

  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index] ?? 0;
    if (cumulative > threshold) {
      const ratio = histogram.length === 1 ? 0 : index / (histogram.length - 1);
      return scalarRange[0] + ratio * (scalarRange[1] - scalarRange[0]);
    }
  }

  return scalarRange[1];
}
function estimatePreviewThreshold(
  volume: LoadedVolume,
  voxels: Int16Array,
  scalarRange: [number, number],
): number {
  const { histogram, included } = buildScalarHistogram(voxels, scalarRange);
  if (included === 0) {
    return clamp(
      volume.meta.initialWindowLevel.level,
      scalarRange[0],
      scalarRange[1],
    );
  }
  const percentile95 = resolveHistogramPercentile(
    histogram,
    included,
    0.95,
    scalarRange,
  );
  const percentile99 = resolveHistogramPercentile(
    histogram,
    included,
    0.99,
    scalarRange,
  );
  return clamp(
    Math.round(
      Math.max(
        volume.meta.initialWindowLevel.level,
        percentile95 * 0.45 + percentile99 * 0.55,
      ),
    ),
    scalarRange[0],
    scalarRange[1],
  );
}

export function prepareVolumeFor3D(volume: LoadedVolume): PreparedVolumeFor3D {
  const full = {
    dimensions: volume.meta.dimensions,
    sourceDimensions: volume.meta.dimensions,
    origin: [0, 0, 0] as Vec3,
    spacing: volume.meta.spacing,
    voxels: volume.voxels,
    scalarRange: volume.meta.scalarRange,
  };
  const [width, height, depth] = full.dimensions;
  const maxEdge = Math.max(width, height, depth);
  const threshold = estimatePreviewThreshold(
    volume,
    full.voxels,
    full.scalarRange,
  );
  if (maxEdge <= MAX_3D_TEXTURE_EDGE) {
    return {
      dimensions: full.dimensions,
      sourceDimensions: full.sourceDimensions,
      origin: full.origin,
      spacing: full.spacing,
      voxels: quantizePreviewVoxels(full.voxels, full.scalarRange),
      scalarRange: full.scalarRange,
      threshold,
      downsampled: false,
      cropped: false,
    };
  }

  const scale = MAX_3D_TEXTURE_EDGE / maxEdge;
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const outDepth = Math.max(1, Math.round(depth * scale));
  const out = new Int16Array(outWidth * outHeight * outDepth);

  for (let z = 0; z < outDepth; z += 1) {
    const sourceZ = sampleIndex(z, outDepth, depth);
    for (let y = 0; y < outHeight; y += 1) {
      const sourceY = sampleIndex(y, outHeight, height);
      for (let x = 0; x < outWidth; x += 1) {
        const sourceX = sampleIndex(x, outWidth, width);
        out[z * outWidth * outHeight + y * outWidth + x] =
          full.voxels[sourceZ * width * height + sourceY * width + sourceX] ??
          0;
      }
    }
  }

  return {
    dimensions: [outWidth, outHeight, outDepth],
    sourceDimensions: full.sourceDimensions,
    origin: full.origin,
    spacing: [
      full.spacing[0] / scale,
      full.spacing[1] / scale,
      full.spacing[2] / scale,
    ],
    voxels: quantizePreviewVoxels(out, full.scalarRange),
    scalarRange: full.scalarRange,
    threshold,
    downsampled: true,
    cropped: false,
  };
}
