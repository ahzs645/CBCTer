import {
  keepLargestMaskComponent,
  splitMaskComponents,
} from '../lib/segmentation/maskOperations';

export type MaskWorkerOperation = 'keep-largest' | 'split-components';

export interface MaskWorkerRequest {
  id: string;
  operation: MaskWorkerOperation;
  mask: ArrayBuffer;
  dims: [number, number, number];
  connectivity?: 6 | 26;
  limit?: number;
}

export type MaskWorkerResponse =
  | {
      id: string;
      type: 'keep-largest';
      mask: ArrayBuffer;
      voxels: number;
    }
  | {
      id: string;
      type: 'split-components';
      components: Array<{ label: number; mask: ArrayBuffer; voxels: number }>;
    }
  | {
      id: string;
      type: 'error';
      message: string;
    };

function countVoxels(mask: Uint8Array): number {
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) count += 1;
  }
  return count;
}

function transferableBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

self.onmessage = (event: MessageEvent<MaskWorkerRequest>) => {
  const { id, operation, mask, dims, connectivity = 26, limit } = event.data;
  try {
    const source = new Uint8Array(mask);
    if (operation === 'keep-largest') {
      const next = keepLargestMaskComponent(source, dims, connectivity);
      const maskBuffer = transferableBuffer(next);
      const response: MaskWorkerResponse = {
        id,
        type: 'keep-largest',
        mask: maskBuffer,
        voxels: countVoxels(next),
      };
      self.postMessage(response, [maskBuffer]);
      return;
    }

    const components = splitMaskComponents(source, dims, connectivity)
      .filter((component) => component.voxels > 0)
      .sort((left, right) => right.voxels - left.voxels)
      .slice(0, limit ?? 24)
      .map((component) => ({
        label: component.label,
        mask: transferableBuffer(component.mask),
        voxels: component.voxels,
      }));
    const response: MaskWorkerResponse = {
      id,
      type: 'split-components',
      components,
    };
    self.postMessage(response, components.map((component) => component.mask));
  } catch (error) {
    const response: MaskWorkerResponse = {
      id,
      type: 'error',
      message: error instanceof Error ? error.message : 'Mask worker failed.',
    };
    self.postMessage(response);
  }
};
