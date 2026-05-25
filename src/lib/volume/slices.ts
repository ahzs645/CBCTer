import type {
  LoadedVolume,
  SliceImage,
  SliceWindowLevel,
  VolumeCursor,
} from '../../types';
import { VolumeAxis } from '../../types';
import { clamp, grayToRgba, resolveWindowLevel } from './math';

const MAX_SLICE_CACHE_ENTRIES = 12;

// Int16-indexed window/level lookup table (value + 32768 -> gray 0..255).
// Building it once per (window, level) turns the hot per-voxel mapping into a
// single array read, which keeps MPR scrubbing responsive on large volumes.
const LUT_SIZE = 65536;
const LUT_OFFSET = 32768;
let lutCache: { window: number; level: number; table: Uint8Array } | null =
  null;

function getGrayLut(window: number, level: number): Uint8Array {
  if (lutCache && lutCache.window === window && lutCache.level === level) {
    return lutCache.table;
  }
  const table = new Uint8Array(LUT_SIZE);
  const low = level - window / 2;
  for (let raw = 0; raw < LUT_SIZE; raw += 1) {
    const value = raw - LUT_OFFSET;
    const normalized = (value - low) / window;
    table[raw] = Math.round(Math.min(1, Math.max(0, normalized)) * 255);
  }
  lutCache = { window, level, table };
  return table;
}

interface VolumeCacheEntry {
  axial: Map<string, SliceImage>;
  coronal: Map<string, SliceImage>;
  sagittal: Map<string, SliceImage>;
}

const volumeCache = new WeakMap<LoadedVolume, VolumeCacheEntry>();
const SPARSE_AXIS_RATIO = 3;

function getVolumeCache(volume: LoadedVolume): VolumeCacheEntry {
  let cache = volumeCache.get(volume);
  if (!cache) {
    cache = {
      axial: new Map(),
      coronal: new Map(),
      sagittal: new Map(),
    };
    volumeCache.set(volume, cache);
  }
  return cache;
}

function cacheForAxis(
  cache: VolumeCacheEntry,
  axis: VolumeAxis,
): Map<string, SliceImage> {
  return cache[axis];
}

function sliceCacheKey(
  sliceIndex: number,
  window: number,
  level: number,
): string {
  return `${sliceIndex}|${window}|${level}`;
}

function extractAxisSliceIndex(axis: VolumeAxis, cursor: VolumeCursor): number {
  switch (axis) {
    case VolumeAxis.Axial:
      return cursor.z;
    case VolumeAxis.Coronal:
      return cursor.y;
    case VolumeAxis.Sagittal:
      return cursor.x;
  }
}

function axisSliceLimit(
  axis: VolumeAxis,
  width: number,
  height: number,
  depth: number,
): number {
  switch (axis) {
    case VolumeAxis.Axial:
      return depth - 1;
    case VolumeAxis.Coronal:
      return height - 1;
    case VolumeAxis.Sagittal:
      return width - 1;
  }
}

function axisImageShape(
  axis: VolumeAxis,
  width: number,
  height: number,
  depth: number,
): Pick<SliceImage, 'width' | 'height'> {
  switch (axis) {
    case VolumeAxis.Axial:
      return { width, height };
    case VolumeAxis.Coronal:
      return { width, height: depth };
    case VolumeAxis.Sagittal:
      return { width: height, height: depth };
  }
}

function axisDisplayAspect(volume: LoadedVolume, axis: VolumeAxis): number {
  const [spacingX, spacingY, spacingZ] = volume.meta.spacing;
  switch (axis) {
    case VolumeAxis.Axial:
      return spacingX / spacingY || 1;
    case VolumeAxis.Coronal:
      return spacingX / spacingZ || 1;
    case VolumeAxis.Sagittal:
      return spacingY / spacingZ || 1;
  }
}

function shouldUsePixelatedRendering(
  volume: LoadedVolume,
  axis: VolumeAxis,
): boolean {
  const displayAspect = axisDisplayAspect(volume, axis);
  return (
    displayAspect <= SPARSE_AXIS_RATIO && displayAspect >= 1 / SPARSE_AXIS_RATIO
  );
}

function sampleAxialGray(
  volume: LoadedVolume,
  z: number,
  lut: Uint8Array,
  width: number,
  height: number,
): Uint8ClampedArray {
  const voxels = volume.voxels;
  const out = new Uint8ClampedArray(width * height);
  const base = z * width * height;
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    const row = base + y * width;
    for (let x = 0; x < width; x += 1) {
      out[offset] = lut[voxels[row + x] + LUT_OFFSET];
      offset += 1;
    }
  }
  return out;
}

function sampleCoronalGray(
  volume: LoadedVolume,
  y: number,
  lut: Uint8Array,
  width: number,
  height: number,
  depth: number,
): Uint8ClampedArray {
  const voxels = volume.voxels;
  const out = new Uint8ClampedArray(width * depth);
  const sliceStride = width * height;
  const yRow = y * width;
  let offset = 0;
  for (let z = depth - 1; z >= 0; z -= 1) {
    const base = z * sliceStride + yRow;
    for (let x = 0; x < width; x += 1) {
      out[offset] = lut[voxels[base + x] + LUT_OFFSET];
      offset += 1;
    }
  }
  return out;
}

function sampleSagittalGray(
  volume: LoadedVolume,
  x: number,
  lut: Uint8Array,
  width: number,
  height: number,
  depth: number,
): Uint8ClampedArray {
  const voxels = volume.voxels;
  const out = new Uint8ClampedArray(height * depth);
  const sliceStride = width * height;
  let offset = 0;
  for (let z = depth - 1; z >= 0; z -= 1) {
    const base = z * sliceStride + x;
    for (let y = 0; y < height; y += 1) {
      out[offset] = lut[voxels[base + y * width] + LUT_OFFSET];
      offset += 1;
    }
  }
  return out;
}

function sampleAxisGray(
  volume: LoadedVolume,
  axis: VolumeAxis,
  sliceIndex: number,
  window: number,
  level: number,
): Uint8ClampedArray {
  const [width, height, depth] = volume.meta.dimensions;
  const slice = clamp(
    Math.round(sliceIndex),
    0,
    axisSliceLimit(axis, width, height, depth),
  );
  const lut = getGrayLut(window, level);

  switch (axis) {
    case VolumeAxis.Axial:
      return sampleAxialGray(volume, slice, lut, width, height);
    case VolumeAxis.Coronal:
      return sampleCoronalGray(volume, slice, lut, width, height, depth);
    case VolumeAxis.Sagittal:
      return sampleSagittalGray(volume, slice, lut, width, height, depth);
  }
}

function extractAxisImageData(
  volume: LoadedVolume,
  axis: VolumeAxis,
  sliceIndex: number,
  window: number,
  level: number,
): SliceImage {
  const cache = cacheForAxis(getVolumeCache(volume), axis);
  const key = sliceCacheKey(sliceIndex, window, level);
  const cached = cache.get(key);
  if (cached) return cached;

  const [width, height, depth] = volume.meta.dimensions;
  const gray = sampleAxisGray(volume, axis, sliceIndex, window, level);
  const shape = axisImageShape(axis, width, height, depth);
  const image: SliceImage = {
    ...shape,
    data: grayToRgba(gray),
    displayAspect: axisDisplayAspect(volume, axis),
    pixelated: shouldUsePixelatedRendering(volume, axis),
  };

  if (cache.size >= MAX_SLICE_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, image);
  return image;
}

function extractAxisImage(
  volume: LoadedVolume,
  axis: VolumeAxis,
  sliceIndex: number,
  windowLevel?: Partial<SliceWindowLevel>,
): SliceImage {
  const { window, level } = resolveWindowLevel(windowLevel);
  return extractAxisImageData(volume, axis, sliceIndex, window, level);
}

export function extractAxialImage(
  volume: LoadedVolume,
  cursor: VolumeCursor,
  windowLevel?: Partial<SliceWindowLevel>,
): SliceImage {
  const { window, level } = resolveWindowLevel(windowLevel);
  return extractAxisImage(volume, VolumeAxis.Axial, cursor.z, {
    window,
    level,
  });
}

export function extractCoronalImage(
  volume: LoadedVolume,
  cursor: VolumeCursor,
  windowLevel?: Partial<SliceWindowLevel>,
): SliceImage {
  const { window, level } = resolveWindowLevel(windowLevel);
  return extractAxisImage(volume, VolumeAxis.Coronal, cursor.y, {
    window,
    level,
  });
}

export function extractSagittalImage(
  volume: LoadedVolume,
  cursor: VolumeCursor,
  windowLevel?: Partial<SliceWindowLevel>,
): SliceImage {
  const { window, level } = resolveWindowLevel(windowLevel);
  return extractAxisImage(volume, VolumeAxis.Sagittal, cursor.x, {
    window,
    level,
  });
}

export function extractSliceGrayImage(
  volume: LoadedVolume,
  axis: VolumeAxis,
  cursor: VolumeCursor,
  windowLevel?: Partial<SliceWindowLevel>,
): Uint8ClampedArray {
  const { window, level } = resolveWindowLevel(windowLevel);
  return sampleAxisGray(
    volume,
    axis,
    extractAxisSliceIndex(axis, cursor),
    window,
    level,
  );
}
