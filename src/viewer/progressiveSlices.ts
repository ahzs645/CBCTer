import {
  VolumeAxis,
  type LoadedVolume,
  type SliceImage,
  type SliceWindowLevel,
  type Vec3,
  type VolumeCursor,
} from '../types';
import {
  extractAxialImage,
  extractCoronalImage,
  extractSagittalImage,
} from '../lib/volume';
import { displayVoxels, type NativeVoxelMetadata } from '../lib/volume/native';
export function planeRegion(
  axis: VolumeAxis,
  cursor: VolumeCursor,
  dimensions: Vec3,
): { start: Vec3; shape: Vec3 } {
  if (axis === VolumeAxis.Axial)
    return {
      start: [0, 0, cursor.z],
      shape: [dimensions[0], dimensions[1], 1],
    };
  if (axis === VolumeAxis.Coronal)
    return {
      start: [0, cursor.y, 0],
      shape: [dimensions[0], 1, dimensions[2]],
    };
  return { start: [cursor.x, 0, 0], shape: [1, dimensions[1], dimensions[2]] };
}
export function renderNativePlane(
  axis: VolumeAxis,
  words: Int16Array | Uint16Array,
  shape: Vec3,
  metadata: NativeVoxelMetadata,
  wl: SliceWindowLevel,
): SliceImage {
  const v: LoadedVolume = {
    voxels: displayVoxels(words, metadata),
    histogram: new Uint32Array(),
    meta: {
      format: 'cbct-package',
      formatLabel: 'CBCT',
      scanId: '',
      dimensions: shape,
      spacing: metadata.spacing,
      scalarRange: [-32767, 32767],
      initialWindowLevel: wl,
      sliceCount: shape[2],
      bytesPerVoxel: 2,
      headerFileName: '',
      slicePrefix: '',
      sliceFiles: [],
    },
  };
  const cursor = { x: 0, y: 0, z: 0 };
  return axis === VolumeAxis.Axial
    ? extractAxialImage(v, cursor, wl)
    : axis === VolumeAxis.Coronal
      ? extractCoronalImage(v, cursor, wl)
      : extractSagittalImage(v, cursor, wl);
}
/** Upsample only a 2D preview plane so full-grid crosshairs/mm stay correct. */
export function renderPreviewPlane(
  axis: VolumeAxis,
  volume: LoadedVolume,
  cursor: VolumeCursor,
  dimensions: Vec3,
  wl: SliceWindowLevel,
): SliceImage {
  const pc = {
    x: Math.floor(cursor.x / 2),
    y: Math.floor(cursor.y / 2),
    z: Math.floor(cursor.z / 2),
  };
  const image =
    axis === VolumeAxis.Axial
      ? extractAxialImage(volume, pc, wl)
      : axis === VolumeAxis.Coronal
        ? extractCoronalImage(volume, pc, wl)
        : extractSagittalImage(volume, pc, wl);
  const width = axis === VolumeAxis.Sagittal ? dimensions[1] : dimensions[0];
  const height = axis === VolumeAxis.Axial ? dimensions[1] : dimensions[2];
  const out: SliceImage = {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    displayAspect: image.displayAspect,
    pixelated: true,
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const py =
        axis === VolumeAxis.Axial
          ? Math.floor(y / 2)
          : image.height - 1 - Math.floor((height - 1 - y) / 2);
      const from = (py * image.width + Math.floor(x / 2)) * 4;
      out.data.set(image.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  return out;
}
