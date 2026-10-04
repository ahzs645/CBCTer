/// <reference lib="webworker" />

import {
  countMaskVoxels,
  fillMaskHoles,
  keepLargestMaskComponent,
} from '../lib/segmentation/maskOperations';
import { maskToBinaryStl, type MaskMeshOptions } from '../lib/segmentation/maskMesh';
import {
  estimateVoxelSurfaceAreaMm2,
  SURFACE_GENERATION_PRESETS,
  type SurfaceGenerationQuality,
} from '../lib/surface';
import type { Vec3 } from '../types';

export interface SurfaceWorkerRequest {
  id: string;
  mask: ArrayBuffer;
  dims: [number, number, number];
  spacing: Vec3;
  quality: SurfaceGenerationQuality;
}

export type SurfaceWorkerResponse =
  | {
      id: string;
      type: 'progress';
      phase: 'preprocess' | 'mesh' | 'metrics';
    }
  | {
      id: string;
      type: 'complete';
      stl: ArrayBuffer;
      areaMm2: number;
      volumeMm3: number;
      triangleCount: number;
      voxelCount: number;
      options: MaskMeshOptions;
    }
  | {
      id: string;
      type: 'error';
      message: string;
    };

const ctx = self as DedicatedWorkerGlobalScope;

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

ctx.onmessage = async (event: MessageEvent<SurfaceWorkerRequest>) => {
  const { id, mask, dims, spacing, quality } = event.data;
  try {
    const preset = SURFACE_GENERATION_PRESETS[quality];
    let workingMask: Uint8Array<ArrayBufferLike> = new Uint8Array(mask);
    ctx.postMessage({ id, type: 'progress', phase: 'preprocess' });
    if (preset.fillHoles) workingMask = fillMaskHoles(workingMask, dims);
    if (preset.keepLargestComponent) {
      workingMask = keepLargestMaskComponent(workingMask, dims, 26);
    }
    const voxelCount = countMaskVoxels(workingMask);
    if (voxelCount === 0) {
      throw new Error('The selected mask has no voxels after preprocessing.');
    }

    const stride = voxelCount > 750_000 ? 2 : 1;
    const options: MaskMeshOptions = {
      extraction: preset.extraction,
      smoothIterations: preset.smoothIterations,
      decimateReduction: preset.decimateReduction,
    };
    ctx.postMessage({ id, type: 'progress', phase: 'mesh' });
    const stl = await blobToArrayBuffer(
      maskToBinaryStl(workingMask, dims, spacing, [0, 0, 0], stride, options),
    );

    ctx.postMessage({ id, type: 'progress', phase: 'metrics' });
    // The binary STL stores the exact triangle count as a little-endian uint32
    // at byte offset 80, which is accurate for both the voxel-face and the
    // marching-tetrahedra ('iso') extraction paths plus any decimation.
    const triangleCount =
      stl.byteLength >= 84 ? new DataView(stl).getUint32(80, true) : 0;
    const areaMm2 = estimateVoxelSurfaceAreaMm2(workingMask, dims, spacing);
    const volumeMm3 = voxelCount * spacing[0] * spacing[1] * spacing[2];
    const response: SurfaceWorkerResponse = {
      id,
      type: 'complete',
      stl,
      areaMm2,
      volumeMm3,
      triangleCount,
      voxelCount,
      options,
    };
    ctx.postMessage(response, [stl]);
  } catch (error) {
    ctx.postMessage({
      id,
      type: 'error',
      message: error instanceof Error ? error.message : 'Surface worker failed.',
    });
  }
};
