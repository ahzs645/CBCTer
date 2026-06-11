import type { LoadedVolume } from '../../types';
import type { ToothSegmentationResult, SegmentationProgress } from './toothInference';
import type {
  ToothYoloRequest,
  ToothYoloResponse,
} from '../../workers/toothSegYolo.worker';

export interface YoloVolumeOptions {
  /** Detection confidence threshold (default 0.25). */
  conf?: number;
  /** Mask binarization threshold on sigmoid prob (default 0.5). */
  maskThreshold?: number;
}

/**
 * Whole-volume single-class tooth segmentation using the YOLOv8-seg model.
 * Resamples to 0.3 mm, runs the detector on every axial slice, and assembles a
 * 3D tooth mask — returning the same {@link ToothSegmentationResult} shape as the
 * UNet path so the existing watershed → FDI → mesh pipeline can be reused.
 *
 * The returned mask is in the **0.3 mm resampled grid** (origin [0,0,0],
 * spacing [0.3,0.3,0.3]), not the source voxel frame.
 */
export function segmentToothVolumeYolo(
  volume: LoadedVolume,
  onProgress?: (progress: SegmentationProgress) => void,
  options: YoloVolumeOptions = {},
): Promise<ToothSegmentationResult> {
  const [width, height, depth] = volume.meta.dimensions;
  const voxels = Int16Array.from(volume.voxels); // copy so the source buffer is untouched

  return new Promise<ToothSegmentationResult>((resolve, reject) => {
    const worker = new Worker(
      new URL('../../workers/toothSegYolo.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (event: MessageEvent<ToothYoloResponse>) => {
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
          origin: [0, 0, 0],
          spacing: data.spacing,
          voxelCount: data.voxelCount,
        });
        return;
      }
      worker.terminate();
      reject(new Error(data.message));
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'YOLO tooth segmentation worker failed.'));
    };

    const request: ToothYoloRequest = {
      voxels: voxels.buffer,
      dims: [depth, height, width],
      spacing: volume.meta.spacing,
      conf: options.conf,
      maskThreshold: options.maskThreshold,
    };
    worker.postMessage(request, [request.voxels]);
  });
}
