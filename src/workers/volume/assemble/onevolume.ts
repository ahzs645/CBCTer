import type { LoadedVolume } from '../../../types';
import { ImportStage } from '../../../types';
import { post } from '../progress';
import {
  buildScalarHistogram,
  resolveOneVolumeWindowLevel,
  resolveScalarRange,
} from '../scalars';
import type { VolumeAssemblerContext } from '../types';

const ONEVOLUME_SENTINEL = -32768;
const ONEVOLUME_MARKER_LENGTH = 'JmVolumeVersion=1'.length;
const INT16_MAX = 32767;
/** Raw OneVolume samples are stored in thousandths of the vendor "V" unit. */
const ONEVOLUME_RAW_PER_V = 1000;

/**
 * Map a raw OneVolume sample onto an HU-like Int16 scale using the header's
 * value-to-HU calibration (`HU = V * tfSystemV2HuSlope + tfSystemV2HuIntercept`,
 * with V = raw / 1000). With that reading the scan's own saved display window
 * (CtStatus `SliceExist_dWindowCenter/Width`, in V units) lands on a typical
 * dental air-to-enamel range.
 *
 * The previous mapping (`raw * 100 / slope + intercept * 100`) left Int16 for
 * every sample and only rendered because the typed-array store wrapped
 * around; the brightest enamel/metal wrapped twice and showed up as black
 * speckle inside teeth, easily mistaken for caries or voids. The result is
 * clamped so it can never wrap, and -32768 stays reserved for the padding
 * sentinel.
 */
export function scaleOneVolumeSample(
  raw: number,
  slope: number,
  intercept: number,
): number {
  const value = Math.round((raw / ONEVOLUME_RAW_PER_V) * slope + intercept);
  return Math.min(INT16_MAX, Math.max(-INT16_MAX, value));
}

export async function assembleOneVolumeVolume({
  meta,
  files,
}: VolumeAssemblerContext): Promise<LoadedVolume> {
  const file = files.find((entry) => entry.path === meta.sliceFiles[0]);
  if (!file) {
    throw new Error('missing CT_0.vol payload');
  }

  post({
    stage: ImportStage.Assembling,
    detailKey: 'importStatus.progress.readingOneVolumeVoxelPayload',
    completed: 0,
    total: 2,
  });

  const buffer = file.buffer as ArrayBuffer;
  const markerOffset = 4;
  const xmlLength = new DataView(
    buffer,
    markerOffset + ONEVOLUME_MARKER_LENGTH,
    4,
  ).getUint32(0, true);
  const dataOffset =
    markerOffset + ONEVOLUME_MARKER_LENGTH + 4 + xmlLength + 36;
  const [sourceWidth, sourceHeight, sourceDepth] =
    meta.sourceDimensions ?? meta.dimensions;
  const sourceVoxelCount = sourceWidth * sourceHeight * sourceDepth;
  const expectedBytes = sourceVoxelCount * meta.bytesPerVoxel;
  const actualBytes = buffer.byteLength - dataOffset;

  if (actualBytes !== expectedBytes) {
    throw new Error(
      `invalid OneVolume payload size: expected ${expectedBytes}, got ${actualBytes}`,
    );
  }

  const view = new DataView(buffer, dataOffset, actualBytes);
  // The native archive retains all bounds and exact raw words. Display cropping
  // and calibration below remain separate, reversible neither by assumption.
  const nativeVoxels = new Int16Array(sourceVoxelCount);
  for (let z = 0; z < sourceDepth; z++)
    for (let y = 0; y < sourceHeight; y++)
      for (let x = 0; x < sourceWidth; x++) {
        nativeVoxels[(z * sourceHeight + y) * sourceWidth + x] = view.getInt16(
          (z + sourceDepth * y + sourceDepth * sourceHeight * x) * 2,
          true,
        );
      }
  const [offsetX, offsetY, offsetZ] = meta.sourceOffset ?? [0, 0, 0];
  const [width, height, depth] = meta.dimensions;
  const voxels = new Int16Array(width * height * depth);
  const slope = meta.nativeValueScale?.slope ?? 190;
  const intercept = meta.nativeValueScale?.intercept ?? 0;

  for (let z = 0; z < depth; z += 1) {
    for (let y = 0; y < height; y += 1) {
      const canonicalPlaneOffset = z * width * height + y * width;
      const sourceY = offsetY + y;

      for (let x = 0; x < width; x += 1) {
        const sourceX = offsetX + x;
        const sourceZ = offsetZ + z;
        const sourceIndex =
          sourceZ +
          sourceDepth * sourceY +
          sourceDepth * sourceHeight * sourceX;
        const raw = view.getInt16(sourceIndex * 2, true);
        if (raw === ONEVOLUME_SENTINEL) {
          voxels[canonicalPlaneOffset + x] = ONEVOLUME_SENTINEL;
          continue;
        }

        voxels[canonicalPlaneOffset + x] = scaleOneVolumeSample(
          raw,
          slope,
          intercept,
        );
      }
    }
  }

  post({
    stage: ImportStage.Assembling,
    detailKey: 'importStatus.progress.decodedOneVolumeVoxelPayload',
    completed: 1,
    total: 2,
  });

  const scalarRange = resolveScalarRange(
    voxels,
    meta.scalarRange,
    ONEVOLUME_SENTINEL,
  );
  const histogram = buildScalarHistogram(voxels, scalarRange);
  return {
    meta: {
      ...meta,
      scalarRange,
      initialWindowLevel: resolveOneVolumeWindowLevel(
        histogram,
        scalarRange,
        meta.initialWindowLevel,
      ),
    },
    voxels,
    ...(meta.nativeGeometry
      ? { native: { voxels: nativeVoxels, metadata: meta.nativeGeometry } }
      : {}),
    histogram,
  } satisfies LoadedVolume;
}
