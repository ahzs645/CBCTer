/**
 * Rigid-alignment math ported from SADT's ASO (Automatic Slicer Orientation)
 * and AReg landmark registration. The headline routine is
 * {@link absoluteOrientation} — given two corresponding landmark sets it solves
 * the optimal rotation + translation (least-squares) using Horn's closed-form
 * unit-quaternion method, which is numerically stable and needs no SVD.
 *
 * Coordinates are plain `[x, y, z]`; nothing here depends on three.js, so it is
 * usable from workers and tests.
 */
import type { Vec3 } from '../../types';
import {
  cross,
  dot,
  jacobiEigenSymmetric,
  mean,
  normalize,
  subtract,
} from './linalg';
import {
  applyMat4ToPoint,
  fromRotationTranslation,
  type Mat4,
} from './transformMatrix';

/**
 * Rodrigues' rotation formula: the 3x3 rotation matrix (row-major) for a
 * rotation of `angle` radians about `axis`. `axis` need not be unit length.
 */
export function rodrigues(axis: Vec3, angle: number): number[][] {
  const k = normalize(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const [x, y, z] = k;
  return [
    [c + x * x * t, x * y * t - z * s, x * z * t + y * s],
    [y * x * t + z * s, c + y * y * t, y * z * t - x * s],
    [z * x * t - y * s, z * y * t + x * s, c + z * z * t],
  ];
}

/** Rotation matrix (row-major) that rotates unit-ish vector `from` onto `to`. */
export function rotationBetween(from: Vec3, to: Vec3): number[][] {
  const a = normalize(from);
  const b = normalize(to);
  const axis = cross(a, b);
  const sinA = Math.hypot(axis[0], axis[1], axis[2]);
  const cosA = dot(a, b);
  const angle = Math.atan2(sinA, cosA);
  if (sinA < 1e-9) {
    // Parallel or anti-parallel: identity, or 180° about any perpendicular axis.
    if (cosA > 0) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const perp: Vec3 =
      Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return rodrigues(normalize(cross(a, perp)), Math.PI);
  }
  return rodrigues(axis, angle);
}

/** Convert a unit quaternion `[w, x, y, z]` to a 3x3 rotation matrix (row-major). */
export function quaternionToMatrix(q: [number, number, number, number]): number[][] {
  const [w, x, y, z] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

export interface RigidAlignment {
  /** 3x3 rotation (row-major). */
  rotation: number[][];
  /** Translation applied after rotation. */
  translation: Vec3;
  /** Homogeneous affine: `target ≈ transform · [source, 1]`. */
  transform: Mat4;
  /** Root-mean-square residual between transformed source and target (mm/voxels). */
  rmse: number;
}

/**
 * Horn's absolute orientation: least-squares rigid transform mapping
 * `source[i]` onto `target[i]`. Requires ≥ 3 non-collinear correspondences.
 */
export function absoluteOrientation(
  source: Vec3[],
  target: Vec3[],
): RigidAlignment {
  if (source.length !== target.length) {
    throw new Error('absoluteOrientation: point sets must match in length.');
  }
  if (source.length < 3) {
    throw new Error('absoluteOrientation: need at least 3 correspondences.');
  }

  const sBar = mean(source);
  const tBar = mean(target);

  // Cross-covariance S[a][b] = Σ (source−sBar)[a] · (target−tBar)[b].
  const s = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < source.length; i += 1) {
    const p = subtract(source[i], sBar);
    const q = subtract(target[i], tBar);
    for (let a = 0; a < 3; a += 1) {
      for (let b = 0; b < 3; b += 1) s[a][b] += p[a] * q[b];
    }
  }
  const [sxx, sxy, sxz] = s[0];
  const [syx, syy, syz] = s[1];
  const [szx, szy, szz] = s[2];

  // Symmetric 4x4 whose top eigenvector is the optimal rotation quaternion.
  const n = [
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];
  const eigen = jacobiEigenSymmetric(n);
  const q = eigen.vectors[0] as [number, number, number, number];
  const rotation = quaternionToMatrix(q);

  // translation = tBar − R · sBar
  const rsBar: Vec3 = [
    rotation[0][0] * sBar[0] + rotation[0][1] * sBar[1] + rotation[0][2] * sBar[2],
    rotation[1][0] * sBar[0] + rotation[1][1] * sBar[1] + rotation[1][2] * sBar[2],
    rotation[2][0] * sBar[0] + rotation[2][1] * sBar[1] + rotation[2][2] * sBar[2],
  ];
  const translation = subtract(tBar, rsBar);
  const transform = fromRotationTranslation(rotation, translation);

  let sqSum = 0;
  for (let i = 0; i < source.length; i += 1) {
    const mapped = applyMat4ToPoint(transform, source[i]);
    const d = subtract(mapped, target[i]);
    sqSum += dot(d, d);
  }
  const rmse = Math.sqrt(sqSum / source.length);

  return { rotation, translation, transform, rmse };
}

/** Mean Euclidean distance between two equal-length point sets (optionally scaled). */
export function meanPointDistance(
  a: Vec3[],
  b: Vec3[],
  spacing: Vec3 = [1, 1, 1],
): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += Math.hypot(
      (a[i][0] - b[i][0]) * spacing[0],
      (a[i][1] - b[i][1]) * spacing[1],
      (a[i][2] - b[i][2]) * spacing[2],
    );
  }
  return sum / a.length;
}

/** Transform every point in a list by an affine. */
export function applyTransformToPoints(m: Mat4, points: Vec3[]): Vec3[] {
  return points.map((p) => applyMat4ToPoint(m, p));
}
