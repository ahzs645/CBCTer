/**
 * Small, dependency-free linear-algebra helpers shared by the geometry ports
 * (rigid alignment, FDI numbering, transform matrices). Kept pure-TS — no
 * three.js — so it runs unchanged in workers and under vitest (node).
 *
 * Matrices are dense `number[][]` (row-major). The sizes here are tiny (3x3,
 * 4x4), so clarity beats micro-optimisation; the Jacobi eigensolver below is
 * the workhorse for both PCA (symmetric 3x3) and Horn's quaternion absolute
 * orientation (symmetric 4x4).
 */
import type { Vec3 } from '../../types';

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale(a: Vec3, factor: number): Vec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (len === 0) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

export function mean(points: Vec3[]): Vec3 {
  if (points.length === 0) return [0, 0, 0];
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const p of points) {
    sx += p[0];
    sy += p[1];
    sz += p[2];
  }
  const n = points.length;
  return [sx / n, sy / n, sz / n];
}

/** Multiply two square matrices of equal size (`a · b`). */
export function matMul(a: number[][], b: number[][]): number[][] {
  const n = a.length;
  const out: number[][] = Array.from({ length: n }, () =>
    new Array<number>(n).fill(0),
  );
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < n; k += 1) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < n; j += 1) out[i][j] += aik * b[k][j];
    }
  }
  return out;
}

export function transpose(a: number[][]): number[][] {
  const n = a.length;
  const out: number[][] = Array.from({ length: n }, () =>
    new Array<number>(n).fill(0),
  );
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) out[j][i] = a[i][j];
  }
  return out;
}

export interface Eigen {
  /** Eigenvalues, sorted descending. */
  values: number[];
  /** `vectors[i]` is the (unit) eigenvector for `values[i]`. */
  vectors: number[][];
}

/**
 * Eigen-decomposition of a real symmetric matrix via cyclic Jacobi rotations.
 * Robust and exact enough for the 3x3 / 4x4 matrices used here. Returns
 * eigenpairs sorted by descending eigenvalue.
 */
export function jacobiEigenSymmetric(input: number[][], maxSweeps = 100): Eigen {
  const n = input.length;
  const a = input.map((row) => row.slice());
  // Accumulated rotations; columns of `v` are the eigenvectors.
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );

  const offDiagNorm = () => {
    let sum = 0;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) sum += a[p][q] * a[p][q];
    }
    return sum;
  };

  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    if (offDiagNorm() < 1e-30) break;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        const apq = a[p][q];
        if (Math.abs(apq) < 1e-300) continue;
        // Rotation angle that annihilates a[p][q]: tan(2φ) = 2·apq/(app−aqq).
        const phi = 0.5 * Math.atan2(2 * apq, a[p][p] - a[q][q]);
        const c = Math.cos(phi);
        const s = Math.sin(phi);

        // a ← Jᵀ·a·J (rotate rows p,q then columns p,q).
        for (let i = 0; i < n; i += 1) {
          const aip = a[i][p];
          const aiq = a[i][q];
          a[i][p] = c * aip + s * aiq;
          a[i][q] = -s * aip + c * aiq;
        }
        for (let i = 0; i < n; i += 1) {
          const api = a[p][i];
          const aqi = a[q][i];
          a[p][i] = c * api + s * aqi;
          a[q][i] = -s * api + c * aqi;
        }
        // v ← v·J
        for (let i = 0; i < n; i += 1) {
          const vip = v[i][p];
          const viq = v[i][q];
          v[i][p] = c * vip + s * viq;
          v[i][q] = -s * vip + c * viq;
        }
      }
    }
  }

  const rawValues = a.map((row, i) => row[i]);
  const rawVectors = rawValues.map((_, col) => v.map((row) => row[col]));
  const order = rawValues
    .map((_, i) => i)
    .sort((x, y) => rawValues[y] - rawValues[x]);
  return {
    values: order.map((i) => rawValues[i]),
    vectors: order.map((i) => rawVectors[i]),
  };
}

export interface Pca {
  /** Centroid of the input points. */
  center: Vec3;
  /** Principal axes (unit vectors), sorted by descending variance. */
  axes: [Vec3, Vec3, Vec3];
  /** Variance along each axis (eigenvalues of the covariance matrix). */
  values: [number, number, number];
}

/** Principal-component analysis of a set of 3-D points. */
export function pca(points: Vec3[]): Pca {
  const center = mean(points);
  const cov: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of points) {
    const d = subtract(p, center);
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) cov[i][j] += d[i] * d[j];
    }
  }
  const n = Math.max(1, points.length);
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) cov[i][j] /= n;
  }
  const eigen = jacobiEigenSymmetric(cov);
  return {
    center,
    axes: [
      eigen.vectors[0] as Vec3,
      eigen.vectors[1] as Vec3,
      eigen.vectors[2] as Vec3,
    ],
    values: [eigen.values[0], eigen.values[1], eigen.values[2]],
  };
}
