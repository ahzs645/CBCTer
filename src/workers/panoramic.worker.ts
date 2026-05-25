/// <reference lib="webworker" />
import type { Vec3 } from '../types';
import { resampleArch } from '../lib/panoramic/spline';
import { reformat } from '../lib/panoramic/reformation';
import type { ArchPoint, PanoramicProjection } from '../lib/panoramic/types';

export interface PanoramicRequest {
  /** Int16 voxel slab covering exactly the requested z-band, z-major. */
  voxels: ArrayBuffer;
  /** [width, height, slabDepth] of the slab. */
  dims: Vec3;
  spacing: Vec3;
  controlPoints: ArchPoint[];
  archStepMm: number;
  depthMm: number;
  depthStepMm: number;
  projection: PanoramicProjection;
  window: number;
  level: number;
}

export type PanoramicResponse =
  | { type: 'progress'; fraction: number }
  | {
      type: 'result';
      data: ArrayBuffer;
      width: number;
      height: number;
      mmPerPixelX: number;
      mmPerPixelY: number;
    }
  | { type: 'error'; message: string };

self.onmessage = (event: MessageEvent<PanoramicRequest>) => {
  try {
    const req = event.data;
    const voxels = new Int16Array(req.voxels);
    const arch = resampleArch(
      { controlPoints: req.controlPoints },
      req.spacing,
      req.archStepMm,
    );
    const slabDepth = req.dims[2];
    const result = reformat(
      voxels,
      req.dims,
      req.spacing,
      arch,
      {
        zMin: 0,
        zMax: slabDepth - 1,
        depthMm: req.depthMm,
        depthStepMm: req.depthStepMm,
        archStepMm: req.archStepMm,
        projection: req.projection,
        window: req.window,
        level: req.level,
      },
      (fraction) => self.postMessage({ type: 'progress', fraction }),
    );

    const buffer = result.data.buffer as ArrayBuffer;
    self.postMessage(
      {
        type: 'result',
        data: buffer,
        width: result.width,
        height: result.height,
        mmPerPixelX: result.mmPerPixelX,
        mmPerPixelY: result.mmPerPixelY,
      } satisfies PanoramicResponse,
      [buffer],
    );
  } catch (error) {
    self.postMessage({
      type: 'error',
      message:
        error instanceof Error ? error.message : 'Panoramic reformation failed.',
    } satisfies PanoramicResponse);
  }
};
