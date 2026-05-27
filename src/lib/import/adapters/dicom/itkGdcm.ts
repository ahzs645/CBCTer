import { readImageDicomFileSeries } from '@itk-wasm/dicom';
import type { BinaryFile, Image } from 'itk-wasm';
import { prepareVolumeFor3D } from '../../../volume';
import type {
  LoadedVolume,
  ParsedVolumeMeta,
  ScanFolderEntry,
  ScanFolderSource,
  Vec3,
} from '../../../../types';
import type { ImportFailure, ParsedImportResult } from '../../types';
import { getEntryPath, resolveScanId } from '../utils';
import {
  findDicomEntries,
  parseImplicitLittleEndianDicom,
  readDicomOverview,
  resolveDicomHeaderReadLength,
} from './reader';

function makeError(code: string, message: string): ImportFailure {
  const error = new Error(message) as ImportFailure;
  error.name = code;
  error.code = code;
  return error;
}

function sanitizeItkPath(entry: ScanFolderEntry, index: number): string {
  const path = getEntryPath(entry).replace(/[\\/]+/g, '_');
  return `${index}_${path || entry.name || 'dicom.dcm'}`;
}

async function entryToBinaryFile(
  entry: ScanFolderEntry,
  index: number,
): Promise<BinaryFile> {
  return {
    path: sanitizeItkPath(entry, index),
    data: new Uint8Array(await entry.file.arrayBuffer()),
  };
}

function toVec3(values: number[] | undefined, fallback: Vec3): Vec3 {
  return [
    Number.isFinite(values?.[0]) ? Number(values?.[0]) : fallback[0],
    Number.isFinite(values?.[1]) ? Number(values?.[1]) : fallback[1],
    Number.isFinite(values?.[2]) ? Number(values?.[2]) : fallback[2],
  ];
}

function toInt16Voxels(data: Image['data']): Int16Array {
  if (!data) throw makeError('E_DICOM_ITK_EMPTY', 'ITK/GDCM returned no voxel data.');
  const out = new Int16Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    const value = Number(data[index] ?? 0);
    out[index] = Math.max(-32768, Math.min(32767, Math.round(value)));
  }
  return out;
}

function scalarRange(voxels: Int16Array): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of voxels) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min, min + 1];
  return [min, max];
}

async function readFirstHeader(source: ScanFolderSource, entry: ScanFolderEntry) {
  try {
    const headerBytes = await entry.file
      .slice(0, resolveDicomHeaderReadLength(entry.file.size))
      .arrayBuffer();
    return parseImplicitLittleEndianDicom(headerBytes, {
      requirePixelData: false,
    });
  } catch {
    try {
      const overviewBytes = await entry.file
        .slice(0, Math.min(entry.file.size, 8192))
        .arrayBuffer();
      const overview = readDicomOverview(overviewBytes);
      return {
        studyDate: undefined,
        studyTime: undefined,
        studyId: undefined,
        seriesDescription: overview.seriesDescription,
        rescaleSlope: 1,
        rescaleIntercept: 0,
      };
    } catch {
      return {
        studyDate: undefined,
        studyTime: undefined,
        studyId: source.label,
        seriesDescription: source.label,
        rescaleSlope: 1,
        rescaleIntercept: 0,
      };
    }
  }
}

export async function parseDicomFolderWithItkGdcm(
  source: ScanFolderSource,
): Promise<ParsedImportResult> {
  const entries = findDicomEntries(source);
  if (entries.length < 1) {
    throw makeError('E_DICOM_COUNT', 'expected at least one DICOM file');
  }

  const inputImages = await Promise.all(entries.map(entryToBinaryFile));
  let result: Awaited<ReturnType<typeof readImageDicomFileSeries>>;
  try {
    result = await readImageDicomFileSeries({ inputImages });
  } catch (error) {
    throw makeError(
      'E_DICOM_ITK_GDCM',
      error instanceof Error
        ? `ITK/GDCM failed to read this DICOM series: ${error.message}`
        : 'ITK/GDCM failed to read this DICOM series.',
    );
  }

  const image = result.outputImage;
  const dimensions = toVec3(image.size, [1, 1, 1]).map((value) =>
    Math.max(1, Math.round(value)),
  ) as Vec3;
  const spacing = toVec3(image.spacing, [1, 1, 1]);
  const voxels = toInt16Voxels(image.data);
  const expectedVoxels = dimensions[0] * dimensions[1] * dimensions[2];
  if (voxels.length !== expectedVoxels) {
    throw makeError(
      'E_DICOM_ITK_DIMENSIONS',
      `ITK/GDCM returned ${voxels.length} voxels for ${dimensions.join(' x ')} dimensions.`,
    );
  }

  const firstHeader = await readFirstHeader(source, entries[0]);
  const range = scalarRange(voxels);
  const window = Math.max(1, range[1] - range[0]);
  const level = Math.round(range[0] + window / 2);
  const meta: ParsedVolumeMeta = {
    format: 'dicom',
    formatLabel: 'DICOM CT (ITK/GDCM)',
    scanId: resolveScanId(source, {
      preferred: firstHeader.seriesDescription,
      studyDate: firstHeader.studyDate,
      studyTime: firstHeader.studyTime,
      studyId: firstHeader.studyId,
    }),
    dimensions,
    spacing,
    scalarRange: range,
    initialWindowLevel: {
      window,
      level,
    },
    nativeValueScale: {
      slope: firstHeader.rescaleSlope,
      intercept: firstHeader.rescaleIntercept,
    },
    sliceCount: dimensions[2],
    bytesPerVoxel: 2,
    headerFileName: getEntryPath(entries[0]),
    slicePrefix: getEntryPath(entries[0]).split('/').slice(0, -1).join('/'),
    sliceFiles: entries.map((entry) => getEntryPath(entry)),
  };
  const volume: LoadedVolume = {
    meta,
    voxels,
    histogram: new Uint32Array(0),
  };

  return {
    meta,
    loaded: {
      volume,
      meta,
      prepared3D: prepareVolumeFor3D(volume),
    },
  };
}

