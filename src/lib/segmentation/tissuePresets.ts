import { VolumeAxis, type SliceImage, type Vec3, type VolumeCursor } from '../../types';

export type TissuePresetId =
  | 'softTissue'
  | 'spongialBone'
  | 'compactBone'
  | 'enamel'
  | 'dentalMaterial';

export interface TissuePreset {
  id: TissuePresetId;
  label: string;
  range: [number, number];
  color: string;
  opacity: number;
}

export const TISSUE_PRESETS: TissuePreset[] = [
  {
    id: 'softTissue',
    label: 'Soft tissue / skin',
    range: [-700, 225],
    color: '#f9a8d4',
    opacity: 0.38,
  },
  {
    id: 'spongialBone',
    label: 'Spongial bone',
    range: [148, 661],
    color: '#fbbf24',
    opacity: 0.42,
  },
  {
    id: 'compactBone',
    label: 'Compact bone',
    range: [662, 1988],
    color: '#fb923c',
    opacity: 0.48,
  },
  {
    id: 'enamel',
    label: 'Enamel / dense tooth',
    range: [1553, 3023],
    color: '#e0f2fe',
    opacity: 0.58,
  },
  {
    id: 'dentalMaterial',
    label: 'Metal / restoration',
    range: [3024, 12000],
    color: '#c084fc',
    opacity: 0.62,
  },
];

export interface TissueOverlayLayer {
  preset: TissuePreset;
  visible: boolean;
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

function layerForValue(layers: TissueOverlayLayer[], value: number) {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    const [min, max] = layer.preset.range;
    if (layer.visible && value >= min && value <= max) return layer;
  }
  return null;
}

export function extractTissueOverlayImage(
  voxels: Int16Array,
  layers: TissueOverlayLayer[],
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

  let output = 0;
  const drawValue = (value: number) => {
    const layer = layerForValue(visibleLayers, value);
    if (!layer) return;
    blendPixel(
      data,
      output * 4,
      parseHexColor(layer.preset.color),
      Math.round(Math.max(0, Math.min(1, layer.preset.opacity)) * 210),
    );
  };

  switch (axis) {
    case VolumeAxis.Axial: {
      const base = cursor.z * sliceStride;
      for (let y = 0; y < height; y += 1) {
        const row = base + y * width;
        for (let x = 0; x < width; x += 1) {
          drawValue(voxels[row + x]);
          output += 1;
        }
      }
      break;
    }
    case VolumeAxis.Coronal: {
      for (let z = depth - 1; z >= 0; z -= 1) {
        const base = z * sliceStride + cursor.y * width;
        for (let x = 0; x < width; x += 1) {
          drawValue(voxels[base + x]);
          output += 1;
        }
      }
      break;
    }
    case VolumeAxis.Sagittal: {
      for (let z = depth - 1; z >= 0; z -= 1) {
        const base = z * sliceStride + cursor.x;
        for (let y = 0; y < height; y += 1) {
          drawValue(voxels[base + y * width]);
          output += 1;
        }
      }
      break;
    }
  }

  return {
    ...shape,
    data,
    displayAspect: overlayDisplayAspect(axis, spacing),
    pixelated: true,
  };
}
