import { describe, expect, it } from 'vitest';
import {
  matchLandmarksByLabel,
  orientVolume,
  orientVolumeToReference,
  solveLandmarkOrientation,
} from './autoOrient';
import { rodrigues } from './rigidAlignment';
import { fromRotationTranslation } from './transformMatrix';
import { applyMatrixToLandmarks } from './autoMatrix';
import type { Landmark } from '../io/slicerMarkups';
import type { Vec3 } from '../../types';

const lm = (label: string, position: Vec3): Landmark => ({ label, position });

describe('autoOrient (ASO)', () => {
  it('matches landmarks by label, case-insensitively, in reference order', () => {
    const source = [lm('n', [1, 1, 1]), lm('Ba', [2, 2, 2]), lm('Extra', [9, 9, 9])];
    const reference = [lm('Ba', [0, 0, 0]), lm('N', [5, 5, 5]), lm('Missing', [7, 7, 7])];
    const match = matchLandmarksByLabel(source, reference);
    expect(match.labels).toEqual(['Ba', 'N']);
    expect(match.source).toEqual([[2, 2, 2], [1, 1, 1]]);
    expect(match.target).toEqual([[0, 0, 0], [5, 5, 5]]);
  });

  it('throws when fewer than 3 landmarks are shared', () => {
    const source = [lm('A', [0, 0, 0]), lm('B', [1, 0, 0])];
    const reference = [lm('A', [0, 0, 0]), lm('B', [1, 0, 0])];
    expect(() => solveLandmarkOrientation(source, reference)).toThrow();
  });

  it('recovers a known rigid transform from landmark correspondences', () => {
    // Build a transform: rotate 25° about z, then translate.
    const r = rodrigues([0, 0, 1], (25 * Math.PI) / 180);
    const transform = fromRotationTranslation(r, [3, -2, 1]);
    const sourcePts: Vec3[] = [
      [0, 0, 0],
      [10, 0, 0],
      [0, 8, 0],
      [0, 0, 6],
    ];
    const source = sourcePts.map((p, i) => lm(`P${i}`, p));
    const reference = applyMatrixToLandmarks(source, transform);

    const solution = solveLandmarkOrientation(source, reference);
    expect(solution.matchedLabels).toHaveLength(4);
    expect(solution.alignment.rmse).toBeLessThan(1e-6);
    // The solved translation column should match the planted transform.
    expect(solution.alignment.transform[3]).toBeCloseTo(3, 6);
    expect(solution.alignment.transform[7]).toBeCloseTo(-2, 6);
    expect(solution.alignment.transform[11]).toBeCloseTo(1, 6);
  });

  it('orientVolume with an identity transform returns the input', () => {
    const dims: [number, number, number] = [2, 2, 2];
    const data = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const identity = fromRotationTranslation(
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      [0, 0, 0],
    );
    const out = orientVolume(data, dims, [1, 1, 1], identity);
    expect([...out.data]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('end-to-end reposes the volume and moves the landmarks consistently', () => {
    // A simple translate-by-1-voxel-in-x world transform (spacing 1mm).
    const dims: [number, number, number] = [1, 1, 4];
    const data = new Float32Array([10, 20, 30, 40]);
    // Reference landmarks are the source shifted +1mm in x → solve recovers it.
    const source = [
      lm('a', [0, 0, 0]),
      lm('b', [2, 0, 0]),
      lm('c', [0, 1, 0]),
      lm('d', [0, 0, 1]),
    ];
    const reference = source.map((l) =>
      lm(l.label, [l.position[0] + 1, l.position[1], l.position[2]]),
    );

    const result = orientVolumeToReference(
      data,
      dims,
      [1, 1, 1],
      source,
      reference,
      { fill: -1 },
    );
    // Content shifts +1 voxel in x: output[x] = source[x-1].
    expect([...result.volume.data]).toEqual([-1, 10, 20, 30]);
    // Landmarks moved into the reference pose.
    expect(result.orientedLandmarks[0].position[0]).toBeCloseTo(1, 6);
    expect(result.solution.alignment.rmse).toBeLessThan(1e-6);
  });
});
