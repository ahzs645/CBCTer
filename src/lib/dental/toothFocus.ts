import type { Vec3 } from '../../types';

/**
 * Tooth-centred views: slices along a tooth's own long axis (the way a
 * periapical film or a "tooth MPR" shows it), its lengths, and a check for
 * dark areas inside the tooth that are not shaped like the pulp canal.
 * Everything works on a crop around one tooth (x-fastest, scan frame).
 */

export interface ToothAxes {
  /** Centroid in crop voxel coordinates. */
  centre: Vec3;
  /** Unit vectors in physical space; `long` points from crown to root. */
  long: Vec3;
  wide: Vec3;
  thin: Vec3;
  lengthMm: number;
  /** Distance along `long` from the centre to the crown tip (negative). */
  tipMm: number;
  /** Distance along `long` from the centre to the root apex. */
  apexMm: number;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(...a) || 1));
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Eigenvectors of a symmetric 3×3 matrix by Jacobi rotation, largest first. */
function eigenSymmetric(m: number[][]): Array<{ value: number; vector: Vec3 }> {
  const a = m.map((row) => [...row]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++)
      for (let q = p + 1; q < 3; q++) off += a[p][q] ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p++)
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t =
          Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta ** 2 + 1));
        const c = 1 / Math.sqrt(t * t + 1),
          s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p],
            akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k],
            aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p],
            vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  return [0, 1, 2]
    .map((i) => ({
      value: a[i][i],
      vector: [v[0][i], v[1][i], v[2][i]] as Vec3,
    }))
    .sort((x, y) => y.value - x.value);
}

/**
 * Principal axes of a tooth. `crownDirection` (+1 when the crown points to
 * higher z) orients `long` from crown to root.
 */
export function toothAxes(
  labels: Uint16Array,
  shape: Vec3,
  values: number[],
  spacing: Vec3,
  crownDirection: 1 | -1,
): ToothAxes | null {
  const wanted = new Set(values);
  let n = 0;
  const sum = [0, 0, 0];
  const plane = shape[0] * shape[1];
  for (let i = 0; i < labels.length; i++) {
    if (!wanted.has(labels[i])) continue;
    sum[0] += i % shape[0];
    sum[1] += Math.floor(i / shape[0]) % shape[1];
    sum[2] += Math.floor(i / plane);
    n++;
  }
  if (n < 10) return null;
  const centre = sum.map((s) => s / n) as Vec3;
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < labels.length; i++) {
    if (!wanted.has(labels[i])) continue;
    const d = [
      (i % shape[0]) - centre[0],
      (Math.floor(i / shape[0]) % shape[1]) - centre[1],
      Math.floor(i / plane) - centre[2],
    ].map((value, a) => value * spacing[a]);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) cov[r][c] += d[r] * d[c];
  }
  const [first, second] = eigenSymmetric(cov.map((row) => row.map((v) => v / n)));
  let long = norm(first.vector);
  // Crown to root runs against the crown direction along z.
  if (long[2] * crownDirection > 0) long = scale(long, -1);
  const wide = norm(second.vector);
  const thin = norm(cross(long, wide));
  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < labels.length; i++) {
    if (!wanted.has(labels[i])) continue;
    const p: Vec3 = [
      ((i % shape[0]) - centre[0]) * spacing[0],
      ((Math.floor(i / shape[0]) % shape[1]) - centre[1]) * spacing[1],
      (Math.floor(i / plane) - centre[2]) * spacing[2],
    ];
    const t = dot(p, long);
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return { centre, long, wide, thin, lengthMm: max - min, tipMm: min, apexMm: max };
}

function trilinear(
  volume: ArrayLike<number>,
  shape: Vec3,
  x: number,
  y: number,
  z: number,
  outside: number,
): number {
  if (
    x < 0 ||
    y < 0 ||
    z < 0 ||
    x > shape[0] - 1 ||
    y > shape[1] - 1 ||
    z > shape[2] - 1
  )
    return outside;
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    z0 = Math.floor(z);
  const x1 = Math.min(x0 + 1, shape[0] - 1),
    y1 = Math.min(y0 + 1, shape[1] - 1),
    z1 = Math.min(z0 + 1, shape[2] - 1);
  const fx = x - x0,
    fy = y - y0,
    fz = z - z0;
  const at = (a: number, b: number, c: number) =>
    volume[(c * shape[1] + b) * shape[0] + a];
  const c00 = at(x0, y0, z0) * (1 - fx) + at(x1, y0, z0) * fx;
  const c10 = at(x0, y1, z0) * (1 - fx) + at(x1, y1, z0) * fx;
  const c01 = at(x0, y0, z1) * (1 - fx) + at(x1, y0, z1) * fx;
  const c11 = at(x0, y1, z1) * (1 - fx) + at(x1, y1, z1) * fx;
  return (
    (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz
  );
}

export interface ObliqueImage {
  width: number;
  height: number;
  /** Interpolated scan values, row-major, first row at `up`'s positive end. */
  values: Float32Array;
  /** 1 where the sample falls inside the tooth outline. */
  inside: Uint8Array;
  mmPerPixel: number;
}

/**
 * Sample a plane through `centre` (crop voxels) spanned by unit physical
 * directions `right` and `up`, `halfWidthMm` × `halfHeightMm` around it.
 */
export function sampleOblique(options: {
  scan: ArrayLike<number>;
  labels?: Uint16Array;
  values?: number[];
  shape: Vec3;
  spacing: Vec3;
  centre: Vec3;
  right: Vec3;
  up: Vec3;
  halfWidthMm: number;
  halfHeightMm: number;
  mmPerPixel?: number;
  outside?: number;
}): ObliqueImage {
  const step = options.mmPerPixel ?? Math.min(...options.spacing);
  const width = Math.max(1, Math.round((2 * options.halfWidthMm) / step) + 1);
  const height = Math.max(1, Math.round((2 * options.halfHeightMm) / step) + 1);
  const values = new Float32Array(width * height);
  const inside = new Uint8Array(width * height);
  const wanted = new Set(options.values ?? []);
  const { shape, spacing, centre } = options;
  // Physical direction → voxel step.
  const toVoxel = (d: Vec3): Vec3 => [d[0] / spacing[0], d[1] / spacing[1], d[2] / spacing[2]];
  const r = toVoxel(options.right),
    u = toVoxel(options.up);
  for (let row = 0; row < height; row++) {
    const v = options.halfHeightMm - row * step;
    for (let col = 0; col < width; col++) {
      const h = -options.halfWidthMm + col * step;
      const p = add(add(centre, scale(r, h)), scale(u, v));
      const index = row * width + col;
      values[index] = trilinear(
        options.scan,
        shape,
        p[0],
        p[1],
        p[2],
        options.outside ?? -1000,
      );
      if (options.labels) {
        const x = Math.round(p[0]),
          y = Math.round(p[1]),
          z = Math.round(p[2]);
        if (
          x >= 0 &&
          y >= 0 &&
          z >= 0 &&
          x < shape[0] &&
          y < shape[1] &&
          z < shape[2] &&
          wanted.has(options.labels[(z * shape[1] + y) * shape[0] + x])
        )
          inside[index] = 1;
      }
    }
  }
  return { width, height, values, inside, mmPerPixel: step };
}

/** Grey image with the tooth outline drawn on top, as RGBA bytes. */
export function obliqueToRgba(
  image: ObliqueImage,
  windowLevel: { window: number; level: number },
  outline = true,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(image.width * image.height * 4);
  const low = windowLevel.level - windowLevel.window / 2;
  for (let i = 0; i < image.values.length; i++) {
    const g = Math.max(
      0,
      Math.min(255, ((image.values[i] - low) / windowLevel.window) * 255),
    );
    let r = g,
      gg = g,
      b = g;
    if (outline && image.inside[i]) {
      const x = i % image.width,
        y = Math.floor(i / image.width);
      const edge =
        x === 0 ||
        y === 0 ||
        x === image.width - 1 ||
        y === image.height - 1 ||
        !image.inside[i - 1] ||
        !image.inside[i + 1] ||
        !image.inside[i - image.width] ||
        !image.inside[i + image.width];
      if (edge) {
        r = 250;
        gg = 204;
        b = 21;
      }
    }
    out.set([r, gg, b, 255], i * 4);
  }
  return out;
}

/** 1D min/max over the 3 neighbours along one axis (stride), in place-safe. */
function pass1d(
  mask: Uint8Array,
  shape: Vec3,
  axis: 0 | 1 | 2,
  grow: boolean,
): Uint8Array {
  const out = new Uint8Array(mask.length);
  const stride = axis === 0 ? 1 : axis === 1 ? shape[0] : shape[0] * shape[1];
  const size = shape[axis];
  for (let i = 0; i < mask.length; i++) {
    const c =
      axis === 0
        ? i % shape[0]
        : axis === 1
          ? Math.floor(i / shape[0]) % shape[1]
          : Math.floor(i / (shape[0] * shape[1]));
    const a = c > 0 ? mask[i - stride] : 0,
      b = c < size - 1 ? mask[i + stride] : 0;
    out[i] = grow ? mask[i] | a | b : mask[i] & a & b;
  }
  return out;
}

/**
 * One step of binary dilation (`grow`) or erosion with the 6-neighbourhood,
 * or the full 3×3×3 cube when `cube` is set (as three 1D passes).
 * Alternating the two gives a rounder structuring element than either alone.
 */
function morph(
  mask: Uint8Array,
  shape: Vec3,
  grow: boolean,
  cube = false,
): Uint8Array {
  if (cube)
    return pass1d(
      pass1d(pass1d(mask, shape, 0, grow), shape, 1, grow),
      shape,
      2,
      grow,
    );
  const out = new Uint8Array(mask.length);
  const [w, h, d] = shape,
    plane = w * h;
  for (let z = 0; z < d; z++)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = z * plane + y * w + x;
        const n0 = x > 0 ? mask[i - 1] : 0,
          n1 = x < w - 1 ? mask[i + 1] : 0,
          n2 = y > 0 ? mask[i - w] : 0,
          n3 = y < h - 1 ? mask[i + w] : 0,
          n4 = z > 0 ? mask[i - plane] : 0,
          n5 = z < d - 1 ? mask[i + plane] : 0;
        out[i] = grow
          ? mask[i] | n0 | n1 | n2 | n3 | n4 | n5
          : mask[i] & n0 & n1 & n2 & n3 & n4 & n5;
      }
  return out;
}

/** Everything not reachable from the crop border through background. */
function fillHoles(mask: Uint8Array, shape: Vec3): Uint8Array {
  const [w, h, d] = shape,
    plane = w * h;
  const outside = new Uint8Array(mask.length);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!mask[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let z = 0; z < d; z++)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (!x || !y || !z || x === w - 1 || y === h - 1 || z === d - 1)
          push(z * plane + y * w + x);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w,
      y = Math.floor(i / w) % h,
      z = Math.floor(i / plane);
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
    if (z > 0) push(i - plane);
    if (z < d - 1) push(i + plane);
  }
  const filled = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) filled[i] = outside[i] ? 0 : 1;
  return filled;
}

export interface DarkArea {
  volumeMm3: number;
  /** Crop voxel coordinates of the centre. */
  centre: Vec3;
  /** Extent along the tooth's long axis, in mm. */
  lengthAlongToothMm: number;
  widthMm: number;
  /** Closest distance to the outer tooth surface, in mm. */
  surfaceDistanceMm: number;
  /** Mean value relative to the tooth's dentine (0–1). */
  relativeDensity: number;
  /** Position along the tooth: 0 at the crown tip, 1 at the root apex. */
  alongTooth: number;
  /**
   * `pulp-like`: long along the tooth or enclosed inside it (pulp chamber and
   * canals). `focal`: compact and reaching the surface — worth a closer look.
   * `minor`: small specks such as fissures or contact gaps.
   */
  kind: 'pulp-like' | 'focal' | 'minor';
}

/**
 * Dark areas inside a tooth's outline. The pulp canal is long and thin along
 * the tooth; a compact dark area — especially one reaching the surface — can
 * be decay, a low-density filling or resorption, and is worth a closer look.
 */
export function findDarkAreas(options: {
  scan: ArrayLike<number>;
  labels: Uint16Array;
  shape: Vec3;
  spacing: Vec3;
  values: number[];
  axes: ToothAxes;
  /** Fraction of the dentine median below which a voxel counts as dark. */
  darkFraction?: number;
  minVolumeMm3?: number;
  /** Compact surface areas smaller than this are reported as minor. */
  focalMinMm3?: number;
  /** Focal areas must be darker than this fraction of dentine (bone ≈ 0.5). */
  focalMaxDensity?: number;
}): DarkArea[] {
  const { scan, labels, shape, spacing, axes } = options;
  const wanted = new Set(options.values);
  const n = labels.length;
  const tooth = new Uint8Array(n);
  const dentine: number[] = [];
  for (let i = 0; i < n; i++)
    if (wanted.has(labels[i])) {
      tooth[i] = 1;
      if (i % 5 === 0) dentine.push(scan[i]);
    }
  if (dentine.length < 10) return [];
  dentine.sort((a, b) => a - b);
  const median = dentine[dentine.length >> 1];
  // Envelope: the outline closed and with holes filled, so dark areas the
  // model left out of the tooth still count as inside it.
  // About 1.5 mm of closing bridges cavities that open onto the surface.
  const closing = Math.max(
    2,
    Math.min(10, Math.round(1.5 / Math.min(...spacing))),
  );
  let hull: Uint8Array = tooth;
  for (let k = 0; k < closing; k++) hull = morph(hull, shape, true, k % 2 === 1);
  for (let k = 0; k < closing; k++) hull = morph(hull, shape, false, k % 2 === 1);
  hull = fillHoles(hull, shape);
  const core = morph(hull, shape, false);
  // 3×3×3 mean over envelope voxels only, so air outside the tooth does not
  // darken voxels at its surface.
  const [w, h, d] = shape,
    plane = w * h;
  const smooth = new Float32Array(n);
  for (let z = 0; z < d; z++)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = z * plane + y * w + x;
        if (!core[i]) continue;
        let s = 0,
          c = 0;
        for (let dz = -1; dz <= 1; dz++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx,
                yy = y + dy,
                zz = z + dz;
              if (xx < 0 || yy < 0 || zz < 0 || xx >= w || yy >= h || zz >= d)
                continue;
              const j = zz * plane + yy * w + xx;
              if (!hull[j]) continue;
              s += scan[j];
              c++;
            }
        smooth[i] = s / c;
      }
  const threshold = (options.darkFraction ?? 0.6) * median;
  const dark = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (core[i] && smooth[i] < threshold) dark[i] = 1;
  // Distance (in voxels, 6-connected BFS) from the outside of the envelope.
  const distance = new Int32Array(n).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < n; i++)
    if (!hull[i]) {
      distance[i] = 0;
      queue.push(i);
    }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % w,
      y = Math.floor(i / w) % h,
      z = Math.floor(i / plane);
    const next = [
      x > 0 ? i - 1 : -1,
      x < w - 1 ? i + 1 : -1,
      y > 0 ? i - w : -1,
      y < h - 1 ? i + w : -1,
      z > 0 ? i - plane : -1,
      z < d - 1 ? i + plane : -1,
    ];
    for (const j of next)
      if (j >= 0 && distance[j] < 0) {
        distance[j] = distance[i] + 1;
        queue.push(j);
      }
  }
  const voxelMm = Math.cbrt(spacing[0] * spacing[1] * spacing[2]);
  const minVoxels =
    (options.minVolumeMm3 ?? 0.5) / (spacing[0] * spacing[1] * spacing[2]);
  const seen = new Uint8Array(n);
  const areas: DarkArea[] = [];
  for (let start = 0; start < n; start++) {
    if (!dark[start] || seen[start]) continue;
    const members: number[] = [start];
    seen[start] = 1;
    for (let head = 0; head < members.length; head++) {
      const i = members[head];
      const x = i % w,
        y = Math.floor(i / w) % h,
        z = Math.floor(i / plane);
      const next = [
        x > 0 ? i - 1 : -1,
        x < w - 1 ? i + 1 : -1,
        y > 0 ? i - w : -1,
        y < h - 1 ? i + w : -1,
        z > 0 ? i - plane : -1,
        z < d - 1 ? i + plane : -1,
      ];
      for (const j of next)
        if (j >= 0 && dark[j] && !seen[j]) {
          seen[j] = 1;
          members.push(j);
        }
    }
    if (members.length < minVoxels) continue;
    let sx = 0,
      sy = 0,
      sz = 0,
      sum = 0,
      minDistance = Infinity;
    let minL = Infinity,
      maxL = -Infinity,
      minW = Infinity,
      maxW = -Infinity;
    for (const i of members) {
      const p: Vec3 = [i % w, Math.floor(i / w) % h, Math.floor(i / plane)];
      sx += p[0];
      sy += p[1];
      sz += p[2];
      sum += smooth[i];
      minDistance = Math.min(minDistance, distance[i]);
      const rel: Vec3 = [
        (p[0] - axes.centre[0]) * spacing[0],
        (p[1] - axes.centre[1]) * spacing[1],
        (p[2] - axes.centre[2]) * spacing[2],
      ];
      const along = dot(rel, axes.long),
        across = dot(rel, axes.wide);
      minL = Math.min(minL, along);
      maxL = Math.max(maxL, along);
      minW = Math.min(minW, across);
      maxW = Math.max(maxW, across);
    }
    const lengthAlong = maxL - minL + voxelMm,
      width = maxW - minW + voxelMm;
    const volumeMm3 = members.length * spacing[0] * spacing[1] * spacing[2];
    const surfaceDistanceMm = Math.max(0, (minDistance - 1) * voxelMm);
    const elongated =
      lengthAlong >= 0.35 * axes.lengthMm && lengthAlong > 2.5 * width;
    const centre: Vec3 = [
      sx / members.length,
      sy / members.length,
      sz / members.length,
    ];
    const relativeDensity = sum / members.length / median;
    const alongTooth = positionAlongTooth(axes, centre, spacing);
    // Small dark specks in the biting fifth of the tooth are fissures or the
    // gap to the opposing tooth in a closed-bite scan.
    const occlusalSpeck = alongTooth < 0.2 && volumeMm3 < 6;
    areas.push({
      volumeMm3,
      centre,
      lengthAlongToothMm: lengthAlong,
      widthMm: width,
      surfaceDistanceMm,
      relativeDensity,
      alongTooth,
      kind:
        elongated || surfaceDistanceMm >= 0.6
          ? 'pulp-like'
          : volumeMm3 >= (options.focalMinMm3 ?? 3) &&
              relativeDensity < (options.focalMaxDensity ?? 0.42) &&
              !occlusalSpeck
            ? 'focal'
            : 'minor',
    });
  }
  return areas.sort((a, b) => b.volumeMm3 - a.volumeMm3);
}

/** Position along the tooth (0 = crown tip, 1 = root apex) of a crop point. */
export function positionAlongTooth(axes: ToothAxes, point: Vec3, spacing: Vec3): number {
  const rel: Vec3 = [
    (point[0] - axes.centre[0]) * spacing[0],
    (point[1] - axes.centre[1]) * spacing[1],
    (point[2] - axes.centre[2]) * spacing[2],
  ];
  return Math.max(
    0,
    Math.min(1, (dot(rel, axes.long) - axes.tipMm) / (axes.lengthMm || 1)),
  );
}
