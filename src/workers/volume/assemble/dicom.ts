import {
  parseEnhancedMultiframeDicom,
  parseImplicitLittleEndianDicom,
} from '../../../lib/import/adapters/dicom';
import type { DicomSourceAxisMap, LoadedVolume, Vec3 } from '../../../types';
import { ImportStage } from '../../../types';
import { post } from '../progress';
import { buildScalarHistogram, resolveScalarRange } from '../scalars';
import type { VolumeAssemblerContext } from '../types';

function mapSourceCoordinateToVolume(
  source: Vec3,
  axisMap: DicomSourceAxisMap,
): Vec3 {
  const mapped: Vec3 = [0, 0, 0];
  for (let sourceAxis = 0; sourceAxis < 3; sourceAxis += 1) {
    const volumeAxis = axisMap.sourceToVolumeAxes[sourceAxis];
    const sourceSize = axisMap.sourceDimensions[sourceAxis];
    mapped[volumeAxis] =
      axisMap.sourceToVolumeSigns[sourceAxis] > 0
        ? source[sourceAxis]
        : sourceSize - 1 - source[sourceAxis];
  }
  return mapped;
}

export async function assembleDicomVolume({
  meta,
  files,
}: VolumeAssemblerContext): Promise<LoadedVolume> {
  const map = new Map(files.map((file) => [file.path, file.buffer]));
  const slices = meta.sliceFiles.map((path) => ({
    path,
    buffer: map.get(path),
  }));
  if (slices.some((slice) => !slice.buffer)) {
    throw new Error('missing DICOM slice data');
  }

  post({
    stage: ImportStage.Assembling,
    detailKey: 'importStatus.progress.readingDicomSliceStack',
    completed: 0,
    total: slices.length,
  });

  const [width, height, depth] = meta.dimensions;
  const voxelsPerSlice = width * height;
  const voxels = new Int16Array(voxelsPerSlice * depth);
  const slope = meta.nativeValueScale?.slope ?? 1;
  const intercept = meta.nativeValueScale?.intercept ?? 0;

  if (slices.length === 1 && depth > 1) {
    const buffer = slices[0].buffer as ArrayBuffer;
    const header = parseEnhancedMultiframeDicom(buffer);
    const sourceDimensions = meta.dicomSourceAxisMap?.sourceDimensions ?? [
      width,
      height,
      depth,
    ];
    const [sourceWidth, sourceHeight, sourceDepth] = sourceDimensions;
    const sourceVoxelsPerSlice = sourceWidth * sourceHeight;
    const expectedBytes =
      sourceVoxelsPerSlice * sourceDepth * meta.bytesPerVoxel;
    if (header.pixelDataLength !== expectedBytes) {
      throw new Error(
        `invalid DICOM pixel payload: expected ${expectedBytes}, got ${header.pixelDataLength}`,
      );
    }

    const view = new DataView(
      buffer,
      header.pixelDataOffset,
      header.pixelDataLength,
    );

    for (let sourceZ = 0; sourceZ < sourceDepth; sourceZ += 1) {
      const frameOffset = sourceZ * sourceVoxelsPerSlice;
      for (let sourceY = 0; sourceY < sourceHeight; sourceY += 1) {
        for (let sourceX = 0; sourceX < sourceWidth; sourceX += 1) {
          const sourceOffset = frameOffset + sourceY * sourceWidth + sourceX;
          const byteOffset = sourceOffset * meta.bytesPerVoxel;
          const raw =
            header.pixelRepresentation === 0
              ? view.getUint16(byteOffset, true)
              : view.getInt16(byteOffset, true);
          const [x, y, z] = meta.dicomSourceAxisMap
            ? mapSourceCoordinateToVolume(
                [sourceX, sourceY, sourceZ],
                meta.dicomSourceAxisMap,
              )
            : [sourceX, sourceY, sourceZ];

          voxels[z * voxelsPerSlice + y * width + x] = Math.round(
            raw * slope + intercept,
          );
        }
      }

      post({
        stage: ImportStage.Assembling,
        detailKey: 'importStatus.progress.decodedDicomSlice',
        detailValues: {
          current: sourceZ + 1,
          total: sourceDepth,
        },
        completed: sourceZ + 1,
        total: sourceDepth,
      });
    }

    const scalarRange = resolveScalarRange(voxels, meta.scalarRange);
    return {
      meta: {
        ...meta,
        scalarRange,
      },
      voxels,
      histogram: buildScalarHistogram(voxels, scalarRange),
    } satisfies LoadedVolume;
  }

  for (let index = 0; index < slices.length; index += 1) {
    const buffer = slices[index].buffer as ArrayBuffer;
    const header = parseImplicitLittleEndianDicom(buffer);
    const expectedBytes = voxelsPerSlice * meta.bytesPerVoxel;
    if (header.pixelDataLength !== expectedBytes) {
      throw new Error(
        `invalid DICOM pixel payload: expected ${expectedBytes}, got ${header.pixelDataLength}`,
      );
    }

    const view = new DataView(
      buffer,
      header.pixelDataOffset,
      header.pixelDataLength,
    );
    const offset = index * voxelsPerSlice;

    for (let pixel = 0; pixel < voxelsPerSlice; pixel += 1) {
      const raw =
        header.pixelRepresentation === 0
          ? view.getUint16(pixel * 2, true)
          : view.getInt16(pixel * 2, true);
      voxels[offset + pixel] = Math.round(raw * slope + intercept);
    }

    post({
      stage: ImportStage.Assembling,
      detailKey: 'importStatus.progress.decodedDicomSlice',
      detailValues: {
        current: index + 1,
        total: slices.length,
      },
      completed: index + 1,
      total: slices.length,
    });
  }

  const scalarRange = resolveScalarRange(voxels, meta.scalarRange);
  return {
    meta: {
      ...meta,
      scalarRange,
    },
    voxels,
    histogram: buildScalarHistogram(voxels, scalarRange),
  } satisfies LoadedVolume;
}
