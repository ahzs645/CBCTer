import type {
  AxisIndex,
  AxisSign,
  DicomSourceAxisMap,
  ParsedVolumeMeta,
  ScanFolderSource,
  Vec3,
  VolumeSeriesChoice,
} from '../../../../types';
import { VolumeAxis } from '../../../../types';
import type {
  ImportFailure,
  ImportParseOptions,
  ParsedImportResult,
} from '../../types';
import { getEntryPath, inferOneVolumeScanId, resolveScanId } from '../utils';
import {
  estimateZSpacing,
  selectPrimaryDicomSeries,
} from './heuristics';
import type { DicomOverview, DicomSliceEntry } from './reader';
import {
  computeDicomSliceLocation,
  findDicomEntries,
  isNativeLittleEndianDicom,
  parseEnhancedMultiframeDicom,
  parseImplicitLittleEndianDicom,
  readDicomOverview,
  resolveDicomHeaderReadLength,
  sortDicomSlices,
} from './reader';

const ENHANCED_DICOM_METADATA_READ_BYTES = 512 * 1024;
const AXIS_PERMUTATIONS: [AxisIndex, AxisIndex, AxisIndex][] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

interface EnhancedVolumeCandidate {
  slice: DicomSliceEntry;
  id: string;
  axisMap: DicomSourceAxisMap;
  dimensions: Vec3;
  sourceDimensions: Vec3;
  spacing: Vec3;
  sourceSpacing: Vec3;
  nativeAxis: VolumeAxis;
  voxels: number;
  label: string;
  detail: string;
}

function makeError(code: string, message: string): ImportFailure {
  const error = new Error(message) as ImportFailure;
  error.name = code;
  error.code = code;
  return error;
}

function computeFrameStep(slice: DicomSliceEntry): number {
  const positions = slice.header.framePositions;
  if (positions && positions.length > 1) {
    return Math.abs(
      computeDicomSliceLocation({
        ...slice.header,
        imagePositionPatient: positions[1],
      }) - computeDicomSliceLocation(slice.header),
    );
  }

  return slice.header.spacingBetweenSlices || slice.header.sliceThickness || 0;
}

function isEnhancedDicomOverview(overview: DicomOverview): boolean {
  return (
    (overview.numberOfFrames ?? 1) > 1 ||
    overview.sopClassUid === '1.2.840.10008.5.1.4.1.1.4.1'
  );
}

function formatChoiceSpacing(spacing: Vec3): string {
  return spacing.map((value) => value.toFixed(2)).join(' x ');
}

function normalizeVector(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length <= 1e-6) return [0, 0, 0];
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function resolveFrameDirection(slice: DicomSliceEntry): Vec3 {
  const positions = slice.header.framePositions;
  if (positions && positions.length > 1) {
    return normalizeVector([
      positions[1][0] - positions[0][0],
      positions[1][1] - positions[0][1],
      positions[1][2] - positions[0][2],
    ]);
  }

  const row = slice.header.imageOrientationPatient.slice(0, 3) as Vec3;
  const column = slice.header.imageOrientationPatient.slice(3, 6) as Vec3;
  return normalizeVector([
    row[1] * column[2] - row[2] * column[1],
    row[2] * column[0] - row[0] * column[2],
    row[0] * column[1] - row[1] * column[0],
  ]);
}

function resolveSourceAxisMap(
  slice: DicomSliceEntry,
  sourceDimensions: Vec3,
): DicomSourceAxisMap {
  const sourceDirections: Vec3[] = [
    normalizeVector(slice.header.imageOrientationPatient.slice(0, 3) as Vec3),
    normalizeVector(slice.header.imageOrientationPatient.slice(3, 6) as Vec3),
    resolveFrameDirection(slice),
  ];
  const scorePermutation = (
    permutation: [AxisIndex, AxisIndex, AxisIndex],
  ): number => {
    let score = 0;
    for (let sourceAxis = 0; sourceAxis < 3; sourceAxis += 1) {
      const axis = permutation[sourceAxis];
      score += Math.abs(sourceDirections[sourceAxis]?.[axis] ?? 0);
    }
    return score;
  };
  const sourceToVolumeAxes = AXIS_PERMUTATIONS.reduce(
    (bestPermutation, permutation) => {
      return scorePermutation(permutation) > scorePermutation(bestPermutation)
        ? permutation
        : bestPermutation;
    },
    AXIS_PERMUTATIONS[0],
  );
  const sourceToVolumeSigns = sourceToVolumeAxes.map((axis, sourceAxis) =>
    (sourceDirections[sourceAxis]?.[axis] ?? 0) < 0 ? -1 : 1,
  ) as [AxisSign, AxisSign, AxisSign];

  return {
    sourceDimensions,
    sourceToVolumeAxes,
    sourceToVolumeSigns,
  };
}

function mapSourceVecToVolume(
  sourceValues: Vec3,
  axisMap: DicomSourceAxisMap,
): Vec3 {
  const mapped: Vec3 = [0, 0, 0];
  for (let sourceAxis = 0; sourceAxis < 3; sourceAxis += 1) {
    mapped[axisMap.sourceToVolumeAxes[sourceAxis]] = sourceValues[sourceAxis];
  }
  return mapped;
}

function resolveNativeAxis(axisMap: DicomSourceAxisMap): VolumeAxis {
  const sliceAxis = axisMap.sourceToVolumeAxes[2];
  if (sliceAxis === 0) return VolumeAxis.Sagittal;
  if (sliceAxis === 1) return VolumeAxis.Coronal;
  return VolumeAxis.Axial;
}

function buildEnhancedVolumeCandidate(
  slice: DicomSliceEntry,
): EnhancedVolumeCandidate | null {
  const frameCount = slice.header.numberOfFrames ?? 1;
  const expectedBytes =
    slice.header.rows *
    slice.header.columns *
    frameCount *
    Math.max(1, Math.round(slice.header.bitsAllocated / 8));

  if (
    !isNativeLittleEndianDicom(slice.header) ||
    frameCount <= 1 ||
    slice.header.pixelDataLength !== expectedBytes
  ) {
    return null;
  }

  const id = getEntryPath(slice.entry);
  const sourceDimensions: Vec3 = [
    slice.header.columns,
    slice.header.rows,
    frameCount,
  ];
  const sourceSpacing: Vec3 = [
    slice.header.pixelSpacing[1],
    slice.header.pixelSpacing[0],
    computeFrameStep(slice) || slice.header.pixelSpacing[0],
  ];
  const axisMap = resolveSourceAxisMap(slice, sourceDimensions);
  const dimensions = mapSourceVecToVolume(sourceDimensions, axisMap);
  const spacing = mapSourceVecToVolume(sourceSpacing, axisMap);
  const nativeAxis = resolveNativeAxis(axisMap);
  const label =
    slice.header.seriesDescription?.trim() ||
    id.split('/').pop() ||
    'DICOM series';
  const detail = `${slice.header.modality ?? 'DICOM'} · ${sourceDimensions.join(
    ' x ',
  )} · ${formatChoiceSpacing(sourceSpacing)} mm`;

  return {
    slice,
    id,
    axisMap,
    dimensions,
    sourceDimensions,
    spacing,
    sourceSpacing,
    nativeAxis,
    voxels: dimensions[0] * dimensions[1] * dimensions[2],
    label,
    detail,
  };
}

function collectEnhancedVolumeCandidates(
  slices: DicomSliceEntry[],
): EnhancedVolumeCandidate[] {
  return slices
    .map(buildEnhancedVolumeCandidate)
    .filter(
      (candidate): candidate is EnhancedVolumeCandidate => candidate != null,
    )
    .sort((left, right) => {
      const leftIsLocalizer = /localizer/i.test(left.label);
      const rightIsLocalizer = /localizer/i.test(right.label);
      if (leftIsLocalizer !== rightIsLocalizer) return leftIsLocalizer ? 1 : -1;

      return right.voxels - left.voxels;
    });
}

function selectEnhancedVolumeCandidate(
  candidates: EnhancedVolumeCandidate[],
  preferredSeriesId?: string,
): EnhancedVolumeCandidate | null {
  if (preferredSeriesId) {
    const preferred = candidates.find(
      (candidate) => candidate.id === preferredSeriesId,
    );
    if (preferred) return preferred;
  }

  return (
    candidates.find((candidate) =>
      /(^|[_\W])(tra|ax|axial)([_\W]|$)/i.test(candidate.label),
    ) ??
    candidates[0] ??
    null
  );
}

function buildSeriesChoices(
  candidates: EnhancedVolumeCandidate[],
  selectedId: string,
): VolumeSeriesChoice[] {
  return candidates.map((candidate) => ({
    id: candidate.id,
    label: candidate.label,
    detail: candidate.detail,
    dimensions: candidate.dimensions,
    spacing: candidate.spacing,
    selected: candidate.id === selectedId,
    nativeAxis: candidate.nativeAxis,
  }));
}

function summarizeUnsupportedDicom(overviews: DicomOverview[]): string {
  const modalities = [
    ...new Set(
      overviews
        .map((overview) => overview.modality)
        .filter((modality): modality is string => Boolean(modality)),
    ),
  ].sort();
  const hasEnhancedMultiframe = overviews.some(
    (overview) =>
      (overview.numberOfFrames ?? 1) > 1 ||
      overview.sopClassUid === '1.2.840.10008.5.1.4.1.1.4.1',
  );

  if (modalities.length > 0 && !modalities.includes('CT')) {
    return `Unsupported DICOM study. This folder contains ${modalities.join(
      '/',
    )} DICOM objects${
      hasEnhancedMultiframe ? ', including enhanced multi-frame images' : ''
    }, not a CT slice stack. Select a folder with native CT .dcm slices.`;
  }

  if (hasEnhancedMultiframe) {
    return 'Unsupported DICOM layout. This folder contains enhanced multi-frame DICOM objects. Select a folder with separate native CT .dcm slices.';
  }

  return 'DICOM files were found, but none form a compatible CT slice stack. Select a folder with native monochrome CT .dcm slices and consistent geometry.';
}

export async function parseDicomFolder(
  source: ScanFolderSource,
  options?: ImportParseOptions,
): Promise<ParsedImportResult> {
  if (options?.dicomEngine === 'itk-gdcm') {
    throw makeError(
      'E_DICOM_ENGINE_UNAVAILABLE',
      'The ITK/GDCM DICOM engine is enabled, but the optional itk-wasm runtime is not installed in this build. Switch back to the custom DICOM engine or install the ITK/GDCM adapter package.',
    );
  }

  const dicomEntries = findDicomEntries(source);
  if (dicomEntries.length < 2) {
    throw makeError('E_DICOM_COUNT', 'expected at least two DICOM slices');
  }

  const parsedEntries = await Promise.all(
    dicomEntries.map(async (entry) => {
      const headerBytes = await entry.file
        .slice(0, resolveDicomHeaderReadLength(entry.file.size))
        .arrayBuffer();
      const overview = readDicomOverview(headerBytes);
      if (isEnhancedDicomOverview(overview)) {
        try {
          const enhancedHeaderBytes = await entry.file
            .slice(
              0,
              Math.min(entry.file.size, ENHANCED_DICOM_METADATA_READ_BYTES),
            )
            .arrayBuffer();
          const header = parseEnhancedMultiframeDicom(enhancedHeaderBytes, {
            requirePixelData: false,
          });

          return {
            overview,
            slice: {
              entry,
              header,
              sliceLocation: computeDicomSliceLocation(header),
            },
          };
        } catch {
          return {
            overview,
            slice: null,
          };
        }
      }

      try {
        const header = parseImplicitLittleEndianDicom(headerBytes, {
          requirePixelData: false,
        });
        return {
          overview,
          slice: {
            entry,
            header,
            sliceLocation: computeDicomSliceLocation(header),
          },
        };
      } catch {
        return {
          overview,
          slice: null,
        };
      }
    }),
  );
  const parsedSlices = parsedEntries
    .map((entry) => entry.slice)
    .filter((slice): slice is DicomSliceEntry => slice != null);

  const slices = selectPrimaryDicomSeries(parsedSlices);
  const enhancedCandidates = collectEnhancedVolumeCandidates(parsedSlices);
  const enhancedVolume = selectEnhancedVolumeCandidate(
    enhancedCandidates,
    options?.preferredSeriesId,
  );
  if (enhancedVolume) {
    const { header } = enhancedVolume.slice;
    const frameCount = header.numberOfFrames ?? 1;
    const level = Math.round(header.windowCenter ?? 1600);
    const window = Math.max(1, Math.round(header.windowWidth ?? 3200));
    const path = enhancedVolume.id;
    const modality = header.modality ? `${header.modality} ` : '';

    return {
      meta: {
        format: 'dicom',
        formatLabel: `Enhanced DICOM ${modality}volume`,
        scanId: resolveScanId(source, {
          preferred: header.seriesDescription,
          studyDate: header.studyDate,
          studyTime: header.studyTime,
          studyId: header.studyId,
        }),
        dimensions: enhancedVolume.dimensions,
        spacing: enhancedVolume.spacing,
        scalarRange: [
          Math.round(level - window / 2),
          Math.round(level + window / 2),
        ],
        initialWindowLevel: {
          window,
          level,
        },
        nativeValueScale: {
          slope: header.rescaleSlope,
          intercept: header.rescaleIntercept,
        },
        sliceCount: frameCount,
        bytesPerVoxel: Math.max(1, Math.round(header.bitsAllocated / 8)),
        headerFileName: path,
        slicePrefix: path.split('/').slice(0, -1).join('/'),
        sliceFiles: [path],
        nativeAxis: enhancedVolume.nativeAxis,
        dicomSourceAxisMap: enhancedVolume.axisMap,
        seriesChoices:
          enhancedCandidates.length > 1
            ? buildSeriesChoices(enhancedCandidates, enhancedVolume.id)
            : undefined,
      },
    };
  }

  if (slices.length < 2) {
    throw makeError(
      'E_DICOM_UNSUPPORTED',
      summarizeUnsupportedDicom(parsedEntries.map((entry) => entry.overview)),
    );
  }

  const sorted = sortDicomSlices(slices);
  const first = sorted[0]?.header;
  if (!first) {
    throw makeError('E_DICOM_HEADER', 'missing DICOM header');
  }

  for (const slice of sorted) {
    if (
      slice.header.rows !== first.rows ||
      slice.header.columns !== first.columns ||
      slice.header.bitsAllocated !== first.bitsAllocated ||
      slice.header.pixelRepresentation !== first.pixelRepresentation
    ) {
      throw makeError(
        'E_DICOM_MISMATCH',
        'inconsistent DICOM slice geometry or pixel format',
      );
    }
  }

  const sliceStep = estimateZSpacing(sorted) || first.pixelSpacing[0];
  const width = first.columns;
  const height = first.rows;
  const depth = sorted.length;
  const level = Math.round(first.windowCenter ?? 1600);
  const window = Math.max(1, Math.round(first.windowWidth ?? 3200));

  const meta: ParsedVolumeMeta = {
    format: 'dicom',
    formatLabel: inferOneVolumeScanId(source)
      ? 'OneVolume CT (DICOM)'
      : 'DICOM CT',
    scanId: resolveScanId(source, {
      studyDate: first.studyDate,
      studyTime: first.studyTime,
      studyId: first.studyId,
    }),
    dimensions: [width, height, depth],
    spacing: [first.pixelSpacing[1], first.pixelSpacing[0], sliceStep || 0.16],
    scalarRange: [
      Math.round(level - window / 2),
      Math.round(level + window / 2),
    ],
    initialWindowLevel: {
      window,
      level,
    },
    nativeValueScale: {
      slope: first.rescaleSlope,
      intercept: first.rescaleIntercept,
    },
    sliceCount: depth,
    bytesPerVoxel: Math.max(1, Math.round(first.bitsAllocated / 8)),
    headerFileName: getEntryPath(sorted[0].entry),
    slicePrefix: getEntryPath(sorted[0].entry)
      .split('/')
      .slice(0, -1)
      .join('/'),
    sliceFiles: sorted.map((slice) => getEntryPath(slice.entry)),
  };

  return { meta };
}
