/**
 * 4x4 affine transform utilities and ITK `.tfm` (Insight Transform File) I/O.
 *
 * Ported from the matrix handling in SlicerAutomatedDentalTools (ASO /
 * AutoMatrix / AReg), which read/write ITK `MatrixOffsetTransformBase` files and
 * convert between Slicer's RAS world and ITK/DICOM's LPS world. CBCTer had no
 * transform-matrix concept; this is the foundation for applying orientations,
 * landmark transforms, and batch matrices.
 *
 * `Mat4` is a 16-element row-major array: element (row, col) is `m[row * 4 + col]`,
 * and a point is transformed as `y = M · [x, 1]`.
 */
import type { Vec3 } from '../../types';

export type Mat4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export function identityMat4(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Matrix product `a · b`. */
export function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0) as Mat4;
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[row * 4 + k] * b[k * 4 + col];
      out[row * 4 + col] = sum;
    }
  }
  return out;
}

/** Apply an affine transform to a point (implicit homogeneous w = 1). */
export function applyMat4ToPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

/** Compose a 3x3 rotation (row-major `number[][]`) and translation into a Mat4. */
export function fromRotationTranslation(rotation: number[][], t: Vec3): Mat4 {
  return [
    rotation[0][0], rotation[0][1], rotation[0][2], t[0],
    rotation[1][0], rotation[1][1], rotation[1][2], t[1],
    rotation[2][0], rotation[2][1], rotation[2][2], t[2],
    0, 0, 0, 1,
  ];
}

/** General 4x4 inverse (cofactor method). Returns `null` if singular. */
export function invertMat4(m: Mat4): Mat4 | null {
  const inv = new Array<number>(16).fill(0);
  inv[0] =
    m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] +
    m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] =
    -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] -
    m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] =
    m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] +
    m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] =
    -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] -
    m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] =
    -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] -
    m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] =
    m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] +
    m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] =
    -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] -
    m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] =
    m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] +
    m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] =
    m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] +
    m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] =
    -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] -
    m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] =
    m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] +
    m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] =
    -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] -
    m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] =
    -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] -
    m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] =
    m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] +
    m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] =
    -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] -
    m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] =
    m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] +
    m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];

  let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (det === 0) return null;
  det = 1 / det;
  return inv.map((value) => value * det) as Mat4;
}

/**
 * Diagonal sign flip between RAS (Slicer world) and LPS (ITK/DICOM world):
 * negate the X and Y axes. The transform is its own inverse, so the same
 * matrix converts both directions.
 */
export const LPS_RAS_FLIP: Mat4 = [
  -1, 0, 0, 0,
  0, -1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/** Convert an affine expressed in LPS to RAS (and vice-versa: it is symmetric). */
export function flipLpsRas(m: Mat4): Mat4 {
  return multiplyMat4(multiplyMat4(LPS_RAS_FLIP, m), LPS_RAS_FLIP);
}

export interface ItkTransform {
  /** The full affine as a homogeneous Mat4 (`y = M · [x, 1]`). */
  matrix: Mat4;
  /** ITK center of rotation (FixedParameters), preserved for reference. */
  center: Vec3;
  /** Transform class name, e.g. `MatrixOffsetTransformBase_double_3_3`. */
  transformType: string;
}

/**
 * Parse an ITK `.tfm` (Insight Transform File V1.0). Supports the 3-D
 * `MatrixOffsetTransformBase` / `AffineTransform` family that SADT emits:
 * `Parameters` = 9 matrix entries (row-major) + 3 translation entries,
 * `FixedParameters` = 3-component center of rotation.
 *
 * ITK evaluates `y = A·(x − c) + T + c = A·x + (T + c − A·c)`, so the returned
 * Mat4 folds the center into the translation column.
 */
export function parseItkTransform(text: string): ItkTransform {
  let transformType = 'MatrixOffsetTransformBase_double_3_3';
  let parameters: number[] | null = null;
  let fixed: number[] = [0, 0, 0];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('#') || line.length === 0) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === 'Transform') {
      transformType = value.split(/\s+/)[0] ?? transformType;
    } else if (key === 'Parameters') {
      parameters = value.split(/\s+/).map(Number);
    } else if (key === 'FixedParameters') {
      const parsed = value.split(/\s+/).map(Number);
      if (parsed.length >= 3) fixed = parsed.slice(0, 3);
    }
  }

  if (!parameters || parameters.length < 12) {
    throw new Error('Invalid ITK transform: expected 12 Parameters.');
  }
  if (parameters.some((value) => !Number.isFinite(value))) {
    throw new Error('Invalid ITK transform: non-numeric Parameters.');
  }

  const a = [
    [parameters[0], parameters[1], parameters[2]],
    [parameters[3], parameters[4], parameters[5]],
    [parameters[6], parameters[7], parameters[8]],
  ];
  const t: Vec3 = [parameters[9], parameters[10], parameters[11]];
  const c: Vec3 = [fixed[0], fixed[1], fixed[2]];
  // offset = T + c − A·c
  const ac: Vec3 = [
    a[0][0] * c[0] + a[0][1] * c[1] + a[0][2] * c[2],
    a[1][0] * c[0] + a[1][1] * c[1] + a[1][2] * c[2],
    a[2][0] * c[0] + a[2][1] * c[1] + a[2][2] * c[2],
  ];
  const offset: Vec3 = [
    t[0] + c[0] - ac[0],
    t[1] + c[1] - ac[1],
    t[2] + c[2] - ac[2],
  ];
  return {
    matrix: fromRotationTranslation(a, offset),
    center: c,
    transformType,
  };
}

/**
 * Serialise a Mat4 as an ITK `.tfm` with a zero center of rotation (so the
 * translation column is written directly as the ITK translation parameters).
 * Round-trips with {@link parseItkTransform} at the matrix level.
 */
export function serializeItkTransform(
  m: Mat4,
  transformType = 'MatrixOffsetTransformBase_double_3_3',
): string {
  const params = [
    m[0], m[1], m[2],
    m[4], m[5], m[6],
    m[8], m[9], m[10],
    m[3], m[7], m[11],
  ];
  return [
    '#Insight Transform File V1.0',
    '#Transform 0',
    `Transform: ${transformType}`,
    `Parameters: ${params.join(' ')}`,
    'FixedParameters: 0 0 0',
    '',
  ].join('\n');
}
