import type { LoadedVolume, Vec3 } from '../../types';
import { extractCropFloat32, type ToothRoi } from './roi';
import type {
  ToothSegRequest,
  ToothSegResponse,
} from '../../workers/toothSeg.worker';

export interface ToothSegmentationResult {
  /** Binary mask in [D, H, W] order over the ROI crop. */
  mask: Uint8Array;
  /** [depth, height, width] of the crop. */
  dims: [number, number, number];
  /** ROI origin in volume voxel coords [x, y, z]. */
  origin: Vec3;
  /** Voxel spacing in mm [x, y, z]. */
  spacing: Vec3;
  voxelCount: number;
}

export interface SegmentationProgress {
  completed: number;
  total: number;
}

/**
 * Run the CBCT tooth-segmentation UNet fully client-side over an ROI of the
 * loaded volume. Crops on the main thread, then offloads normalization,
 * padding, sliding-window ONNX inference and thresholding to a worker.
 *
 * This is the programmatic entry point: it can be called directly from a
 * script/console (`segmentToothROI(volume, roi)`) or from the UI.
 */
export function segmentToothROI(
  volume: LoadedVolume,
  roi: ToothRoi,
  onProgress?: (progress: SegmentationProgress) => void,
): Promise<ToothSegmentationResult> {
  const crop = extractCropFloat32(volume, roi);

  return new Promise<ToothSegmentationResult>((resolve, reject) => {
    const worker = new Worker(
      new URL('../../workers/toothSeg.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (event: MessageEvent<ToothSegResponse>) => {
      const data = event.data;
      if (data.type === 'progress') {
        onProgress?.({ completed: data.completed, total: data.total });
        return;
      }
      if (data.type === 'result') {
        worker.terminate();
        resolve({
          mask: new Uint8Array(data.mask),
          dims: data.dims,
          origin: roi.min,
          spacing: volume.meta.spacing,
          voxelCount: data.voxelCount,
        });
        return;
      }
      worker.terminate();
      reject(new Error(data.message));
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Tooth segmentation worker failed.'));
    };

    const request: ToothSegRequest = {
      data: crop.data.buffer as ArrayBuffer,
      dims: crop.dims,
    };
    worker.postMessage(request, [request.data]);
  });
}
