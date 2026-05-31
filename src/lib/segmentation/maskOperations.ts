import { labelComponents } from './connectedComponents';
import { VolumeAxis, type SliceImage, type Vec3, type VolumeCursor } from '../../types';

export function thresholdVolume(
  voxels: Int16Array,
  range: [number, number],
): Uint8Array {
  const [min, max] = range;
  const mask = new Uint8Array(voxels.length);
  for (let index = 0; index < voxels.length; index += 1) {
    const value = voxels[index];
    if (value >= min && value <= max) mask[index] = 1;
  }
  return mask;
}

export function keepLargestMaskComponent(
  mask: Uint8Array,
  dims: [number, number, number],
  connectivity: 6 | 26 = 26,
): Uint8Array {
  const labeled = labelComponents(mask, dims, connectivity);
  const largest = labeled.components.sort(
    (left, right) => right.voxels - left.voxels,
  )[0];
  const out = new Uint8Array(mask.length);
  if (!largest) return out;

  for (let index = 0; index < labeled.labels.length; index += 1) {
    if (labeled.labels[index] === largest.id) out[index] = 1;
  }
  return out;
}

export function splitMaskComponents(
  mask: Uint8Array,
  dims: [number, number, number],
  connectivity: 6 | 26 = 26,
): Array<{ label: number; mask: Uint8Array; voxels: number }> {
  const labeled = labelComponents(mask, dims, connectivity);
  return labeled.components.map((component) => {
    const componentMask = new Uint8Array(mask.length);
    for (let index = 0; index < labeled.labels.length; index += 1) {
      if (labeled.labels[index] === component.id) componentMask[index] = 1;
    }
    return {
      label: component.id,
      mask: componentMask,
      voxels: component.voxels,
    };
  });
}

export function fillMaskHoles(
  mask: Uint8Array,
  dims: [number, number, number],
  maxHoleVoxels = Infinity,
): Uint8Array {
  const inverted = new Uint8Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) {
    inverted[index] = mask[index] ? 0 : 1;
  }

  const [depth, height, width] = dims;
  const background = labelComponents(inverted, dims, 6);
  const touchesBorder = new Set<number>();

  for (const component of background.components) {
    const [z0, y0, x0, z1, y1, x1] = component.bbox;
    if (
      z0 === 0 ||
      y0 === 0 ||
      x0 === 0 ||
      z1 === depth ||
      y1 === height ||
      x1 === width
    ) {
      touchesBorder.add(component.id);
    }
  }

  const fillable = new Set(
    background.components
      .filter(
        (component) =>
          !touchesBorder.has(component.id) && component.voxels <= maxHoleVoxels,
      )
      .map((component) => component.id),
  );

  const out = new Uint8Array(mask);
  for (let index = 0; index < background.labels.length; index += 1) {
    if (fillable.has(background.labels[index])) out[index] = 1;
  }
  return out;
}

export function regionGrowMask(
  voxels: Int16Array,
  dims: [number, number, number],
  seed: [number, number, number],
  range: [number, number],
  connectivity: 6 | 26 = 6,
): Uint8Array {
  const [depth, height, width] = dims;
  const [seedX, seedY, seedZ] = seed;
  const out = new Uint8Array(voxels.length);
  if (
    seedX < 0 ||
    seedY < 0 ||
    seedZ < 0 ||
    seedX >= width ||
    seedY >= height ||
    seedZ >= depth
  ) {
    return out;
  }

  const [min, max] = range;
  const seedIndex = (seedZ * height + seedY) * width + seedX;
  const seedValue = voxels[seedIndex];
  if (seedValue < min || seedValue > max) return out;

  const offsets: Array<[number, number, number]> = [];
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        const distance = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
        if (connectivity === 6 && distance !== 1) continue;
        offsets.push([dz, dy, dx]);
      }
    }
  }

  const stack = new Int32Array(voxels.length);
  let stackTop = 0;
  stack[stackTop++] = seedIndex;
  out[seedIndex] = 1;

  while (stackTop > 0) {
    const index = stack[--stackTop];
    const z = Math.floor(index / (height * width));
    const rem = index - z * height * width;
    const y = Math.floor(rem / width);
    const x = rem - y * width;

    for (const [dz, dy, dx] of offsets) {
      const nz = z + dz;
      const ny = y + dy;
      const nx = x + dx;
      if (nz < 0 || ny < 0 || nx < 0) continue;
      if (nz >= depth || ny >= height || nx >= width) continue;
      const next = (nz * height + ny) * width + nx;
      if (out[next]) continue;
      const value = voxels[next];
      if (value < min || value > max) continue;
      out[next] = 1;
      stack[stackTop++] = next;
    }
  }

  return out;
}

export function countMaskVoxels(mask: Uint8Array): number {
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) count += mask[index];
  return count;
}

/**
 * Drop connected components smaller than `minVolumeMm3`, using the voxel spacing
 * to convert the physical threshold into a voxel count. Ported from nnU-Net /
 * DentalSegmentator post-processing (`removeSmallComponents`, 60 mm³ default),
 * which cleans speckle from model output. Builds on {@link labelComponents}.
 */
export function removeSmallComponents(
  mask: Uint8Array,
  dims: [number, number, number],
  spacing: Vec3,
  minVolumeMm3: number,
  connectivity: 6 | 26 = 26,
): Uint8Array {
  const voxelVolume = spacing[0] * spacing[1] * spacing[2] || 1;
  const minVoxels = Math.max(1, Math.ceil(minVolumeMm3 / voxelVolume));
  const labeled = labelComponents(mask, dims, connectivity);
  const keep = new Set(
    labeled.components
      .filter((component) => component.voxels >= minVoxels)
      .map((component) => component.id),
  );
  const out = new Uint8Array(mask.length);
  for (let index = 0; index < labeled.labels.length; index += 1) {
    if (keep.has(labeled.labels[index])) out[index] = 1;
  }
  return out;
}

/**
 * Apply {@link removeSmallComponents} independently to each label of a multi-class
 * labelmap (the nnU-Net per-structure cleanup). `skipLabels` are left untouched —
 * e.g. the thin mandibular-canal class, which legitimately has small volume.
 */
export function removeSmallComponentsPerLabel(
  labelmap: Uint16Array,
  dims: [number, number, number],
  spacing: Vec3,
  minVolumeMm3: number,
  options: { skipLabels?: number[]; connectivity?: 6 | 26 } = {},
): Uint16Array {
  const { skipLabels = [], connectivity = 26 } = options;
  const skip = new Set(skipLabels);
  const labels = new Set<number>();
  for (let index = 0; index < labelmap.length; index += 1) {
    const value = labelmap[index];
    if (value !== 0 && !skip.has(value)) labels.add(value);
  }

  const out = new Uint16Array(labelmap);
  for (const label of labels) {
    const binary = new Uint8Array(labelmap.length);
    for (let index = 0; index < labelmap.length; index += 1) {
      if (labelmap[index] === label) binary[index] = 1;
    }
    const cleaned = removeSmallComponents(
      binary,
      dims,
      spacing,
      minVolumeMm3,
      connectivity,
    );
    for (let index = 0; index < labelmap.length; index += 1) {
      if (binary[index] === 1 && cleaned[index] === 0) out[index] = 0;
    }
  }
  return out;
}

export interface MaskOverlayLayer {
  mask: Uint8Array;
  color: string;
  opacity: number;
  visible: boolean;
}

export interface LabelmapOverlaySegment {
  value: number;
  color: string;
  opacity: number;
  visible: boolean;
}

export interface LabelmapOverlayLayer {
  labelmap: Uint16Array;
  opacity: number;
  visible: boolean;
  segments: LabelmapOverlaySegment[];
}

function parseHexColor(color: string): [number, number, number] {
  const normalized = color.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return [56, 189, 248];
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function overlayShape(
  axis: VolumeAxis,
  dimensions: Vec3,
): Pick<SliceImage, 'width' | 'height'> {
  const [width, height, depth] = dimensions;
  switch (axis) {
    case VolumeAxis.Axial:
      return { width, height };
    case VolumeAxis.Coronal:
      return { width, height: depth };
    case VolumeAxis.Sagittal:
      return { width: height, height: depth };
  }
}

function overlayDisplayAspect(axis: VolumeAxis, spacing: Vec3): number {
  const [spacingX, spacingY, spacingZ] = spacing;
  switch (axis) {
    case VolumeAxis.Axial:
      return spacingX / spacingY || 1;
    case VolumeAxis.Coronal:
      return spacingX / spacingZ || 1;
    case VolumeAxis.Sagittal:
      return spacingY / spacingZ || 1;
  }
}

function blendPixel(
  data: Uint8ClampedArray,
  offset: number,
  color: [number, number, number],
  alpha: number,
): void {
  if (alpha <= 0) return;
  if (data[offset + 3] === 0) {
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
    data[offset + 3] = alpha;
    return;
  }
  const existingAlpha = data[offset + 3] / 255;
  const nextAlpha = alpha / 255;
  const outAlpha = nextAlpha + existingAlpha * (1 - nextAlpha);
  if (outAlpha <= 0) return;
  data[offset] =
    (color[0] * nextAlpha +
      data[offset] * existingAlpha * (1 - nextAlpha)) /
    outAlpha;
  data[offset + 1] =
    (color[1] * nextAlpha +
      data[offset + 1] * existingAlpha * (1 - nextAlpha)) /
    outAlpha;
  data[offset + 2] =
    (color[2] * nextAlpha +
      data[offset + 2] * existingAlpha * (1 - nextAlpha)) /
    outAlpha;
  data[offset + 3] = Math.round(outAlpha * 255);
}

export function extractMaskOverlayImage(
  layers: MaskOverlayLayer[],
  axis: VolumeAxis,
  cursor: VolumeCursor,
  dimensions: Vec3,
  spacing: Vec3,
): SliceImage | null {
  const visibleLayers = layers.filter((layer) => layer.visible);
  if (visibleLayers.length === 0) return null;

  const [width, height, depth] = dimensions;
  const shape = overlayShape(axis, dimensions);
  const data = new Uint8ClampedArray(shape.width * shape.height * 4);
  const sliceStride = width * height;

  for (const layer of visibleLayers) {
    const color = parseHexColor(layer.color);
    const alpha = Math.round(Math.max(0, Math.min(1, layer.opacity)) * 180);
    let output = 0;

    switch (axis) {
      case VolumeAxis.Axial: {
        const base = cursor.z * sliceStride;
        for (let y = 0; y < height; y += 1) {
          const row = base + y * width;
          for (let x = 0; x < width; x += 1) {
            if (layer.mask[row + x]) blendPixel(data, output * 4, color, alpha);
            output += 1;
          }
        }
        break;
      }
      case VolumeAxis.Coronal: {
        for (let z = depth - 1; z >= 0; z -= 1) {
          const base = z * sliceStride + cursor.y * width;
          for (let x = 0; x < width; x += 1) {
            if (layer.mask[base + x]) blendPixel(data, output * 4, color, alpha);
            output += 1;
          }
        }
        break;
      }
      case VolumeAxis.Sagittal: {
        for (let z = depth - 1; z >= 0; z -= 1) {
          const base = z * sliceStride + cursor.x;
          for (let y = 0; y < height; y += 1) {
            if (layer.mask[base + y * width]) {
              blendPixel(data, output * 4, color, alpha);
            }
            output += 1;
          }
        }
        break;
      }
    }
  }

  return {
    ...shape,
    data,
    displayAspect: overlayDisplayAspect(axis, spacing),
    pixelated: true,
  };
}

export function extractLabelmapOverlayImage(
  layers: LabelmapOverlayLayer[],
  axis: VolumeAxis,
  cursor: VolumeCursor,
  dimensions: Vec3,
  spacing: Vec3,
): SliceImage | null {
  const visibleLayers = layers.filter((layer) => layer.visible);
  if (visibleLayers.length === 0) return null;

  const [width, height, depth] = dimensions;
  const shape = overlayShape(axis, dimensions);
  const data = new Uint8ClampedArray(shape.width * shape.height * 4);
  const sliceStride = width * height;

  for (const layer of visibleLayers) {
    const segmentByValue = new Map(
      layer.segments
        .filter((segment) => segment.visible)
        .map((segment) => [segment.value, segment]),
    );
    if (segmentByValue.size === 0) continue;

    let output = 0;
    const drawValue = (value: number) => {
      const segment = segmentByValue.get(value);
      if (!segment) return;
      const alpha = Math.round(
        Math.max(0, Math.min(1, segment.opacity * layer.opacity)) * 180,
      );
      blendPixel(data, output * 4, parseHexColor(segment.color), alpha);
    };

    switch (axis) {
      case VolumeAxis.Axial: {
        const base = cursor.z * sliceStride;
        for (let y = 0; y < height; y += 1) {
          const row = base + y * width;
          for (let x = 0; x < width; x += 1) {
            drawValue(layer.labelmap[row + x]);
            output += 1;
          }
        }
        break;
      }
      case VolumeAxis.Coronal: {
        for (let z = depth - 1; z >= 0; z -= 1) {
          const base = z * sliceStride + cursor.y * width;
          for (let x = 0; x < width; x += 1) {
            drawValue(layer.labelmap[base + x]);
            output += 1;
          }
        }
        break;
      }
      case VolumeAxis.Sagittal: {
        for (let z = depth - 1; z >= 0; z -= 1) {
          const base = z * sliceStride + cursor.x;
          for (let y = 0; y < height; y += 1) {
            drawValue(layer.labelmap[base + y * width]);
            output += 1;
          }
        }
        break;
      }
    }
  }

  return {
    ...shape,
    data,
    displayAspect: overlayDisplayAspect(axis, spacing),
    pixelated: true,
  };
}
