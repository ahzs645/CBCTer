import { labelComponents } from './connectedComponents';

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

