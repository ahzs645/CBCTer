import type { LoadedVolume, Vec3 } from '../../types';
import { sha256 } from '../import/chunked/codec';
import type { Affine, ScanBinding } from './types';
const rawHashes = new WeakMap<ArrayBufferView, Promise<string>>();
export const identityAffine: Affine = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];
export function transformPoint(p: Vec3, m: Affine): Vec3 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}
export async function geometryHash(geometry: ScanBinding['geometry']) {
  return sha256(
    new TextEncoder().encode(
      JSON.stringify([
        geometry.dimensions,
        geometry.spacing,
        geometry.origin,
        geometry.direction,
        geometry.coordinateSystem,
      ]),
    ),
  );
}
function cachedHash(array: ArrayBufferView) {
  let hash = rawHashes.get(array);
  if (!hash) {
    hash = sha256(array);
    rawHashes.set(array, hash);
  }
  return hash;
}
export async function bindVolume(volume: LoadedVolume): Promise<ScanBinding> {
  const native = volume.native?.metadata ?? volume.chunked?.manifest.volume;
  const geometry: ScanBinding['geometry'] = {
    dimensions: native?.dimensions ?? volume.meta.dimensions,
    spacing: native?.spacing ?? volume.meta.spacing,
    origin: native?.origin ?? [0, 0, 0],
    direction: native?.direction ?? [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    coordinateSystem: native?.coordinateSystem ?? 'unknown',
  };
  const matrix = [...identityAffine] as Affine;
  for (let a = 0; a < 3; a++) {
    matrix[a * 4 + a] = volume.meta.spacing[a] / geometry.spacing[a];
    matrix[a * 4 + 3] = volume.meta.sourceOffset?.[a] ?? 0;
  }
  return {
    sha256:
      volume.chunked?.manifest.volume.sha256 ??
      (await cachedHash(volume.native?.voxels ?? volume.voxels)),
    geometrySha256: await geometryHash(geometry),
    geometry,
    displaySha256: await cachedHash(volume.voxels),
    displayDimensions: volume.meta.dimensions,
    displaySpacing: volume.meta.spacing,
    displayToNative: matrix,
  };
}
export async function assertProjectBinding(
  binding: ScanBinding | undefined,
  volume: LoadedVolume,
) {
  if (!binding)
    throw new Error(
      'This older project has no scan fingerprint. Open its original scan and export a verified case before restoring analysis.',
    );
  const actual = await bindVolume(volume);
  if (
    binding.sha256 !== actual.sha256 ||
    binding.geometrySha256 !== actual.geometrySha256 ||
    binding.displaySha256 !== actual.displaySha256 ||
    JSON.stringify(binding.displayToNative) !==
      JSON.stringify(actual.displayToNative)
  )
    throw new Error(
      'This project belongs to a different scan or voxel grid. Open the matching scan.',
    );
}
/** Nearest label sampling on the native grid; background outside a cropped grid. */
export function nativeBlock(
  words: Uint8Array | Uint16Array,
  sourceDims: Vec3,
  toNative: Affine,
  start: Vec3,
  shape: Vec3,
): Uint16Array {
  // Current source import maps are axis-aligned scaling/cropping. Fail rather
  // than silently misplace a mask when a general registration is required.
  if (
    [1, 2, 4, 6, 8, 9, 12, 13, 14].some((i) => toNative[i] !== 0) ||
    toNative[15] !== 1 ||
    [0, 5, 10].some((i) => toNative[i] <= 0)
  )
    throw new Error(
      'This analysis grid requires a supported registration transform.',
    );
  if (words.length !== sourceDims.reduce((a, b) => a * b, 1))
    throw new Error('Analysis voxel count does not match its source grid.');
  const out = new Uint16Array(shape.reduce((a, b) => a * b, 1));
  let index = 0;
  for (let z = 0; z < shape[2]; z++)
    for (let y = 0; y < shape[1]; y++)
      for (let x = 0; x < shape[0]; x++) {
        const p = [x + start[0], y + start[1], z + start[2]].map((v, a) =>
          Math.round((v - toNative[a * 4 + 3]) / toNative[a * 4 + a]),
        );
        if (p.every((v, a) => v >= 0 && v < sourceDims[a]))
          out[index] =
            words[(p[2] * sourceDims[1] + p[1]) * sourceDims[0] + p[0]];
        index++;
      }
  return out;
}
