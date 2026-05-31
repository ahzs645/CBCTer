/**
 * Intensity-normalization schemes used to feed CBCT/CT segmentation models.
 *
 * - `zScoreNormalize` mirrors the per-crop MONAI `NormalizeIntensity` used today
 *   in `toothSeg.worker.ts` (zero mean / unit std).
 * - `ctNormalize` is nnU-Net's `CTNormalization`: clip to a foreground intensity
 *   window, then standardise with the dataset's global mean/std. This is what
 *   every DentalSegmentator / AMASSS nnU-Net port needs — without it, ported
 *   weights produce garbage.
 * - `percentileNormalize` is a robust contrast normalisation (clip to a low/high
 *   percentile, rescale) that doubles as an auto window/level preset.
 */

export interface CtNormalizationParams {
  /** Clip lower bound (nnU-Net 0.5-percentile of foreground). */
  lowerBound: number;
  /** Clip upper bound (nnU-Net 99.5-percentile of foreground). */
  upperBound: number;
  /** Global foreground mean (subtracted after clipping). */
  mean: number;
  /** Global foreground std (divided after centering). */
  std: number;
}

/**
 * Verified nnU-Net `CTNormalization` constants for the DentalSegmentator model,
 * read from `plans.json` → `foreground_intensity_properties_per_channel` of
 * `Dataset112_DentalSegmentator_v100` (Zenodo DOI 10.5281/zenodo.10829674,
 * CC-BY-4.0). Clip bounds are the 0.5 / 99.5 foreground percentiles.
 */
export const DENTAL_SEGMENTATOR_CT_NORMALIZATION: CtNormalizationParams = {
  lowerBound: -208,
  upperBound: 3070,
  mean: 1178.261474609375,
  std: 611.7098999023438,
};

/** nnU-Net CTNormalization: clip to [lower, upper], then (x − mean) / std. */
export function ctNormalize(
  data: ArrayLike<number>,
  params: CtNormalizationParams,
  out: Float32Array = new Float32Array(data.length),
): Float32Array {
  const { lowerBound, upperBound, mean, std } = params;
  const invStd = std !== 0 ? 1 / std : 1;
  for (let i = 0; i < data.length; i += 1) {
    let value = data[i];
    if (value < lowerBound) value = lowerBound;
    else if (value > upperBound) value = upperBound;
    out[i] = (value - mean) * invStd;
  }
  return out;
}

/** Zero-mean / unit-std normalisation over the whole array (MONAI-style). */
export function zScoreNormalize(
  data: ArrayLike<number>,
  out: Float32Array = new Float32Array(data.length),
): Float32Array {
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) sum += data[i];
  const mean = sum / data.length;
  let variance = 0;
  for (let i = 0; i < data.length; i += 1) {
    const d = data[i] - mean;
    variance += d * d;
  }
  const std = Math.sqrt(variance / data.length) || 1;
  const invStd = 1 / std;
  for (let i = 0; i < data.length; i += 1) out[i] = (data[i] - mean) * invStd;
  return out;
}

export interface PercentileNormalizeOptions {
  /** Lower percentile (0..100) to clip at. Default 0.5. */
  lowerPercentile?: number;
  /** Upper percentile (0..100) to clip at. Default 99.5. */
  upperPercentile?: number;
  /** Output range [min, max]. Default [0, 1]. */
  outputRange?: [number, number];
  /** Histogram bin count for percentile estimation. Default 4096. */
  bins?: number;
}

export interface PercentileNormalizeResult {
  data: Float32Array;
  /** The intensity values chosen as the low/high clip bounds. */
  lowerValue: number;
  upperValue: number;
}

/**
 * Robust contrast normalisation: estimate the lower/upper percentile intensities
 * with a histogram, clip to that window, and rescale to `outputRange`. The
 * returned `lowerValue`/`upperValue` are reusable as an auto window/level preset.
 */
export function percentileNormalize(
  data: ArrayLike<number>,
  options: PercentileNormalizeOptions = {},
): PercentileNormalizeResult {
  const {
    lowerPercentile = 0.5,
    upperPercentile = 99.5,
    outputRange = [0, 1],
    bins = 4096,
  } = options;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return {
      data: new Float32Array(data.length).fill(outputRange[0]),
      lowerValue: min,
      upperValue: max,
    };
  }

  const histogram = new Uint32Array(bins);
  const span = max - min;
  const scale = (bins - 1) / span;
  for (let i = 0; i < data.length; i += 1) {
    histogram[Math.round((data[i] - min) * scale)] += 1;
  }

  const total = data.length;
  const lowerCount = (lowerPercentile / 100) * total;
  const upperCount = (upperPercentile / 100) * total;
  let cumulative = 0;
  let lowerBin = 0;
  let upperBin = bins - 1;
  let lowerFound = false;
  for (let bin = 0; bin < bins; bin += 1) {
    cumulative += histogram[bin];
    if (!lowerFound && cumulative >= lowerCount) {
      lowerBin = bin;
      lowerFound = true;
    }
    if (cumulative >= upperCount) {
      upperBin = bin;
      break;
    }
  }

  const lowerValue = min + lowerBin / scale;
  let upperValue = min + upperBin / scale;
  if (upperValue <= lowerValue) upperValue = lowerValue + span / bins;

  const [outMin, outMax] = outputRange;
  const outSpan = outMax - outMin;
  const invWindow = 1 / (upperValue - lowerValue);
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    let t = (data[i] - lowerValue) * invWindow;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    out[i] = outMin + t * outSpan;
  }

  return { data: out, lowerValue, upperValue };
}
