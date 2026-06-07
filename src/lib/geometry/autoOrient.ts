/**
 * ASO — Automated Standardized Orientation. Ported from SADT's ASO module, which
 * reorients a CBCT into a standardized head pose by rigidly aligning a few of the
 * scan's anatomical landmarks onto a *reference* landmark template.
 *
 * This is the "semi-automated" path: the caller supplies the scan's landmarks
 * (e.g. parsed from a Slicer `.mrk.json` via {@link parseSlicerMarkups}) and a
 * reference set in the target/standard pose. We match landmarks by label, solve
 * the least-squares rigid transform with Horn's method
 * ({@link absoluteOrientation}), then resample the volume into the reference pose
 * with {@link resampleVolumeWithMatrix}.
 *
 * Coordinate frames: landmarks are world millimetres (LPS — parse markups with
 * `targetSystem: 'LPS'`). The voxel→world map is `world = origin + diag(spacing)
 * · voxel`; CBCTer currently treats volumes as axis-aligned with origin 0, so
 * pass the scan's `origin` when one is available, else it defaults to 0.
 *
 * Conventions: `dims` is `[depth, height, width]` (z, y, x); data is `[z, y, x]`;
 * `spacing`/`origin` are `[x, y, z]` mm.
 */
import type { Vec3 } from '../../types';
import type { Landmark } from '../io/slicerMarkups';
import {
  absoluteOrientation,
  applyTransformToPoints,
  type RigidAlignment,
} from './rigidAlignment';
import { applyMatrixToLandmarks, resampleVolumeWithMatrix, worldToVoxelMatrix } from './autoMatrix';
import type { Interpolation, ResampledMatrixVolume } from './autoMatrix';

export interface LandmarkMatch {
  labels: string[];
  source: Vec3[];
  target: Vec3[];
}

/**
 * Pair landmarks by label (case-insensitive, trimmed). Order follows the
 * `reference` set; only labels present in both sides are kept. The first
 * occurrence of a label on each side wins.
 */
export function matchLandmarksByLabel(
  source: Landmark[],
  reference: Landmark[],
): LandmarkMatch {
  const key = (label: string) => label.trim().toLowerCase();
  const sourceByLabel = new Map<string, Vec3>();
  for (const landmark of source) {
    const k = key(landmark.label);
    if (!sourceByLabel.has(k)) sourceByLabel.set(k, landmark.position);
  }

  const labels: string[] = [];
  const src: Vec3[] = [];
  const tgt: Vec3[] = [];
  const seen = new Set<string>();
  for (const ref of reference) {
    const k = key(ref.label);
    if (seen.has(k)) continue;
    const match = sourceByLabel.get(k);
    if (!match) continue;
    seen.add(k);
    labels.push(ref.label);
    src.push(match);
    tgt.push(ref.position);
  }
  return { labels, source: src, target: tgt };
}

export interface OrientationSolution {
  /** Rigid transform (world mm) mapping scan landmarks onto the reference. */
  alignment: RigidAlignment;
  /** Labels actually used in the solve. */
  matchedLabels: string[];
}

/**
 * Solve the standardizing rigid transform from matched landmarks. Throws if
 * fewer than 3 labels are shared (Horn needs ≥3 non-collinear correspondences).
 */
export function solveLandmarkOrientation(
  source: Landmark[],
  reference: Landmark[],
): OrientationSolution {
  const match = matchLandmarksByLabel(source, reference);
  if (match.source.length < 3) {
    throw new Error(
      `ASO needs at least 3 shared landmarks; found ${match.source.length}.`,
    );
  }
  return {
    alignment: absoluteOrientation(match.source, match.target),
    matchedLabels: match.labels,
  };
}

export interface OrientVolumeOptions {
  /** Volume world origin `[x, y, z]` mm (voxel (0,0,0)). Default `[0,0,0]`. */
  origin?: Vec3;
  /** `'linear'` for intensity (default), `'nearest'` for labelmaps. */
  interpolation?: Interpolation;
  /** Output grid `[depth, height, width]`; defaults to the input grid. */
  outputDims?: [number, number, number];
  /** Fill value for samples outside the input grid. Default `0`. */
  fill?: number;
}

/**
 * Resample a volume into the reference pose given a world-space rigid transform
 * (e.g. {@link solveLandmarkOrientation}'s `alignment.transform`). Keeps the same
 * grid by default, so the patient is reposed within the existing field of view.
 */
export function orientVolume(
  data: ArrayLike<number>,
  dims: [number, number, number],
  spacing: Vec3,
  worldTransform: RigidAlignment['transform'],
  options: OrientVolumeOptions = {},
): ResampledMatrixVolume {
  const origin = options.origin ?? [0, 0, 0];
  const voxelMatrix = worldToVoxelMatrix(worldTransform, spacing, origin);
  return resampleVolumeWithMatrix(data, dims, voxelMatrix, {
    interpolation: options.interpolation ?? 'linear',
    outputDims: options.outputDims,
    fill: options.fill,
  });
}

export interface OrientToReferenceResult {
  /** The reposed volume, `[depth, height, width]` Float32. */
  volume: ResampledMatrixVolume;
  /** The scan landmarks moved into the reference pose. */
  orientedLandmarks: Landmark[];
  /** The solved transform + residual. */
  solution: OrientationSolution;
}

/**
 * End-to-end ASO: solve the transform from landmark correspondences, resample the
 * volume into the reference pose, and transform the scan landmarks to match.
 */
export function orientVolumeToReference(
  data: ArrayLike<number>,
  dims: [number, number, number],
  spacing: Vec3,
  sourceLandmarks: Landmark[],
  referenceLandmarks: Landmark[],
  options: OrientVolumeOptions = {},
): OrientToReferenceResult {
  const solution = solveLandmarkOrientation(sourceLandmarks, referenceLandmarks);
  const volume = orientVolume(
    data,
    dims,
    spacing,
    solution.alignment.transform,
    options,
  );
  const orientedLandmarks = applyMatrixToLandmarks(
    sourceLandmarks,
    solution.alignment.transform,
  );
  return { volume, orientedLandmarks, solution };
}

/** Transform a list of world-space points by an orientation solution. */
export function orientPoints(
  points: Vec3[],
  alignment: RigidAlignment,
): Vec3[] {
  return applyTransformToPoints(alignment.transform, points);
}
