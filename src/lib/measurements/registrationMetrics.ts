import type { LoadedVolume, Vec3 } from '../../types';
import { distance3d } from './geometry';

export interface ImagePlane {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface McagpcWeights {
  ssim: number;
  ncc: number;
  landmark: number;
}

export interface SliceCorrespondenceScore {
  ssim: number;
  ncc: number;
  landmarkScore: number;
  landmarkDistance: number;
  mcagpc: number;
}

export interface VolumeSimilarityScore {
  mutualInformation: number;
  dice: number;
  sampledVoxels: number;
}

const DEFAULT_MCAGPC_WEIGHTS: McagpcWeights = {
  ssim: 0.4,
  ncc: 0.4,
  landmark: 0.2,
};

function assertSameImageShape(a: ImagePlane, b: ImagePlane): number {
  const n = a.width * a.height;
  if (
    a.width !== b.width ||
    a.height !== b.height ||
    a.data.length < n ||
    b.data.length < n
  ) {
    return 0;
  }
  return n;
}

function normalizeWeights(weights: McagpcWeights): McagpcWeights {
  const sum = weights.ssim + weights.ncc + weights.landmark;
  if (!Number.isFinite(sum) || sum <= 0) return DEFAULT_MCAGPC_WEIGHTS;
  return {
    ssim: weights.ssim / sum,
    ncc: weights.ncc / sum,
    landmark: weights.landmark / sum,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function computeNcc(a: ImagePlane, b: ImagePlane): number {
  const n = assertSameImageShape(a, b);
  if (n === 0) return 0;

  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i += 1) {
    sumA += a.data[i];
    sumB += b.data[i];
  }

  const meanA = sumA / n;
  const meanB = sumB / n;
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a.data[i] - meanA;
    const db = b.data[i] - meanB;
    numerator += da * db;
    denomA += da * da;
    denomB += db * db;
  }

  const denominator = Math.sqrt(denomA * denomB);
  return denominator < 1e-10 ? 0 : numerator / denominator;
}

export function computeSsim(
  a: ImagePlane,
  b: ImagePlane,
  dynamicRange = 255,
): number {
  const n = assertSameImageShape(a, b);
  if (n < 2) return 0;

  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i += 1) {
    sumA += a.data[i];
    sumB += b.data[i];
  }

  const meanA = sumA / n;
  const meanB = sumB / n;
  let varA = 0;
  let varB = 0;
  let covariance = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a.data[i] - meanA;
    const db = b.data[i] - meanB;
    varA += da * da;
    varB += db * db;
    covariance += da * db;
  }

  varA /= n - 1;
  varB /= n - 1;
  covariance /= n - 1;

  const c1 = (0.01 * dynamicRange) ** 2;
  const c2 = (0.03 * dynamicRange) ** 2;
  const numerator = (2 * meanA * meanB + c1) * (2 * covariance + c2);
  const denominator =
    (meanA ** 2 + meanB ** 2 + c1) * (varA + varB + c2);
  return denominator === 0 ? 0 : numerator / denominator;
}

export function computeMcagpc(
  a: ImagePlane,
  b: ImagePlane,
  fixedLandmark: Vec3,
  movingLandmark: Vec3,
  options: {
    maxLandmarkError?: number;
    spacing?: Vec3;
    weights?: Partial<McagpcWeights>;
    dynamicRange?: number;
  } = {},
): SliceCorrespondenceScore {
  const ssim = computeSsim(a, b, options.dynamicRange);
  const ncc = computeNcc(a, b);
  const landmarkDistance = distance3d(
    fixedLandmark,
    movingLandmark,
    options.spacing,
  );
  const maxLandmarkError = Math.max(1e-6, options.maxLandmarkError ?? 10);
  const landmarkScore = 1 - Math.min(landmarkDistance / maxLandmarkError, 1);
  const weights = normalizeWeights({
    ...DEFAULT_MCAGPC_WEIGHTS,
    ...options.weights,
  });

  return {
    ssim,
    ncc,
    landmarkScore,
    landmarkDistance,
    mcagpc:
      weights.ssim * clamp01(ssim) +
      weights.ncc * clamp01((ncc + 1) / 2) +
      weights.landmark * landmarkScore,
  };
}

function volumeVoxelCount(volume: LoadedVolume): number {
  const [width, height, depth] = volume.meta.dimensions;
  return width * height * depth;
}

export function computeVolumeMutualInformation(
  a: LoadedVolume,
  b: LoadedVolume,
  options: { bins?: number; step?: number; valueRange?: [number, number] } = {},
): { value: number; sampledVoxels: number } {
  const total = volumeVoxelCount(a);
  if (total !== volumeVoxelCount(b) || total === 0) {
    return { value: 0, sampledVoxels: 0 };
  }

  const bins = Math.max(2, Math.floor(options.bins ?? 50));
  const step = Math.max(1, Math.floor(options.step ?? 4));
  const range = options.valueRange ?? [-1000, 3000];
  const span = Math.max(1e-6, range[1] - range[0]);
  const histA = new Float64Array(bins);
  const histB = new Float64Array(bins);
  const joint = new Float64Array(bins * bins);
  let sampledVoxels = 0;

  for (let i = 0; i < total; i += step) {
    const binA = Math.min(
      bins - 1,
      Math.max(0, Math.floor(((a.voxels[i] - range[0]) / span) * bins)),
    );
    const binB = Math.min(
      bins - 1,
      Math.max(0, Math.floor(((b.voxels[i] - range[0]) / span) * bins)),
    );
    histA[binA] += 1;
    histB[binB] += 1;
    joint[binA * bins + binB] += 1;
    sampledVoxels += 1;
  }

  let entropyA = 0;
  let entropyB = 0;
  let jointEntropy = 0;
  for (let i = 0; i < bins; i += 1) {
    const pa = histA[i] / sampledVoxels;
    const pb = histB[i] / sampledVoxels;
    if (pa > 1e-12) entropyA -= pa * Math.log(pa);
    if (pb > 1e-12) entropyB -= pb * Math.log(pb);
    for (let j = 0; j < bins; j += 1) {
      const p = joint[i * bins + j] / sampledVoxels;
      if (p > 1e-12) jointEntropy -= p * Math.log(p);
    }
  }

  return { value: entropyA + entropyB - jointEntropy, sampledVoxels };
}

export function computeDiceCoefficient(
  a: LoadedVolume,
  b: LoadedVolume,
  options: { threshold?: number; step?: number } = {},
): { value: number; sampledVoxels: number } {
  const total = volumeVoxelCount(a);
  if (total !== volumeVoxelCount(b) || total === 0) {
    return { value: 0, sampledVoxels: 0 };
  }

  const threshold = options.threshold ?? 300;
  const step = Math.max(1, Math.floor(options.step ?? 2));
  let intersection = 0;
  let countA = 0;
  let countB = 0;
  let sampledVoxels = 0;

  for (let i = 0; i < total; i += step) {
    const inA = a.voxels[i] > threshold;
    const inB = b.voxels[i] > threshold;
    if (inA) countA += 1;
    if (inB) countB += 1;
    if (inA && inB) intersection += 1;
    sampledVoxels += 1;
  }

  return {
    value: countA + countB === 0 ? 0 : (2 * intersection) / (countA + countB),
    sampledVoxels,
  };
}

export function computeVolumeSimilarity(
  a: LoadedVolume,
  b: LoadedVolume,
  options: {
    bins?: number;
    miStep?: number;
    valueRange?: [number, number];
    diceThreshold?: number;
    diceStep?: number;
  } = {},
): VolumeSimilarityScore {
  const mi = computeVolumeMutualInformation(a, b, {
    bins: options.bins,
    step: options.miStep,
    valueRange: options.valueRange,
  });
  const dice = computeDiceCoefficient(a, b, {
    threshold: options.diceThreshold,
    step: options.diceStep,
  });
  return {
    mutualInformation: mi.value,
    dice: dice.value,
    sampledVoxels: Math.max(mi.sampledVoxels, dice.sampledVoxels),
  };
}
