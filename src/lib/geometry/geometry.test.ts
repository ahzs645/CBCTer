import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../types';
import { jacobiEigenSymmetric, pca } from './linalg';
import {
  applyMat4ToPoint,
  flipLpsRas,
  fromRotationTranslation,
  invertMat4,
  multiplyMat4,
  parseItkTransform,
  serializeItkTransform,
  type Mat4,
} from './transformMatrix';
import {
  absoluteOrientation,
  applyTransformToPoints,
  meanPointDistance,
  rodrigues,
  rotationBetween,
} from './rigidAlignment';

describe('linalg', () => {
  it('eigen-decomposes a known symmetric matrix', () => {
    // Diagonal-dominant symmetric matrix with known eigenvalues 2, 4, 6.
    const a = [
      [4, 1, 1],
      [1, 4, 1],
      [1, 1, 4],
    ];
    const { values, vectors } = jacobiEigenSymmetric(a);
    // Eigenvalues of [[4,1,1],[1,4,1],[1,1,4]] are 6, 3, 3.
    expect(values[0]).toBeCloseTo(6, 6);
    expect(values[1]).toBeCloseTo(3, 6);
    expect(values[2]).toBeCloseTo(3, 6);
    // Top eigenvector should be ~[1,1,1]/√3.
    const v = vectors[0];
    const norm = Math.hypot(v[0], v[1], v[2]);
    expect(Math.abs(v[0] / norm)).toBeCloseTo(1 / Math.sqrt(3), 5);
  });

  it('finds the principal axis of an elongated point cloud', () => {
    const points: Vec3[] = [];
    for (let i = -10; i <= 10; i += 1) points.push([i, 0.0, 0.0]);
    const result = pca(points);
    expect(result.center[0]).toBeCloseTo(0);
    // Largest-variance axis is the x axis.
    expect(Math.abs(result.axes[0][0])).toBeCloseTo(1, 6);
    expect(result.values[0]).toBeGreaterThan(result.values[1]);
  });
});

describe('transformMatrix', () => {
  it('inverts an affine so M · M⁻¹ = I', () => {
    const r = rodrigues([0, 0, 1], Math.PI / 3);
    const m = fromRotationTranslation(r, [5, -2, 7]);
    const inv = invertMat4(m);
    expect(inv).not.toBeNull();
    const product = multiplyMat4(m, inv as Mat4);
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let i = 0; i < 16; i += 1) expect(product[i]).toBeCloseTo(identity[i], 6);
  });

  it('LPS↔RAS flip is its own inverse', () => {
    const r = rodrigues([1, 1, 0], 0.7);
    const m = fromRotationTranslation(r, [3, 4, 5]);
    const back = flipLpsRas(flipLpsRas(m));
    for (let i = 0; i < 16; i += 1) expect(back[i]).toBeCloseTo(m[i], 6);
  });

  it('round-trips an ITK .tfm through serialise → parse', () => {
    const r = rodrigues([0, 1, 0], Math.PI / 4);
    const m = fromRotationTranslation(r, [12.5, -3.25, 0.5]);
    const text = serializeItkTransform(m);
    expect(text).toContain('MatrixOffsetTransformBase_double_3_3');
    const parsed = parseItkTransform(text);
    for (let i = 0; i < 16; i += 1) {
      expect(parsed.matrix[i]).toBeCloseTo(m[i], 6);
    }
  });

  it('folds a non-zero ITK center of rotation into the translation', () => {
    // Identity rotation about a center → pure identity (center cancels).
    const text = [
      '#Insight Transform File V1.0',
      'Transform: AffineTransform_double_3_3',
      'Parameters: 1 0 0 0 1 0 0 0 1 0 0 0',
      'FixedParameters: 10 20 30',
    ].join('\n');
    const parsed = parseItkTransform(text);
    const p = applyMat4ToPoint(parsed.matrix, [1, 2, 3]);
    expect(p[0]).toBeCloseTo(1);
    expect(p[1]).toBeCloseTo(2);
    expect(p[2]).toBeCloseTo(3);
  });
});

describe('rigid alignment', () => {
  it('recovers a known rotation + translation from correspondences', () => {
    const source: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 2, 0],
      [0, 0, 3],
      [1, 1, 1],
    ];
    const r = rodrigues([0.3, 0.5, 0.81], 0.9);
    const t: Vec3 = [4, -1.5, 2];
    const truth = fromRotationTranslation(r, t);
    const target = applyTransformToPoints(truth, source);

    const fit = absoluteOrientation(source, target);
    expect(fit.rmse).toBeLessThan(1e-6);
    const mapped = applyTransformToPoints(fit.transform, source);
    expect(meanPointDistance(mapped, target)).toBeLessThan(1e-6);
  });

  it('rotates one vector onto another', () => {
    const r = rotationBetween([1, 0, 0], [0, 1, 0]);
    const m = fromRotationTranslation(r, [0, 0, 0]);
    const v = applyMat4ToPoint(m, [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0, 6);
    expect(v[1]).toBeCloseTo(1, 6);
    expect(v[2]).toBeCloseTo(0, 6);
  });
});
