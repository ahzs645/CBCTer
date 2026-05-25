import { VolumeAxis, type Vec3 } from '../../../../types';
import type { DicomHeader, DicomSliceEntry } from './reader';
import { isNativeLittleEndianDicom } from './reader';

const ORIENTATION_EPSILON = 0.75;

export interface DicomSeriesGroup {
  key: string;
  slices: DicomSliceEntry[];
  duplicatePositions: number;
  orientation: VolumeAxis | 'oblique';
}

function vectorCross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dominantAxis(vector: Vec3): 0 | 1 | 2 | null {
  const absolutes = vector.map(Math.abs) as Vec3;
  const max = Math.max(...absolutes);
  if (max < ORIENTATION_EPSILON) return null;
  return absolutes.indexOf(max) as 0 | 1 | 2;
}

export function resolveDicomOrientationLabel(
  header: Pick<DicomHeader, 'imageOrientationPatient'>,
): VolumeAxis | 'oblique' {
  const row = header.imageOrientationPatient.slice(0, 3) as Vec3;
  const column = header.imageOrientationPatient.slice(3, 6) as Vec3;
  const normalAxis = dominantAxis(vectorCross(row, column));
  if (normalAxis === 0) return VolumeAxis.Sagittal;
  if (normalAxis === 1) return VolumeAxis.Coronal;
  if (normalAxis === 2) return VolumeAxis.Axial;
  return 'oblique';
}

function stackPixelKey(header: DicomHeader): string {
  return [
    header.rows,
    header.columns,
    header.bitsAllocated,
    header.bitsStored,
    header.pixelRepresentation,
    header.samplesPerPixel,
    header.photometricInterpretation ?? '',
    header.transferSyntaxUid,
  ].join('|');
}

export function buildDicomSeriesKey(slice: DicomSliceEntry): string {
  const { header } = slice;
  return [
    header.patientId ?? header.patientName ?? '',
    header.studyInstanceUid ?? header.studyId ?? '',
    header.seriesInstanceUid ?? '',
    resolveDicomOrientationLabel(header),
    stackPixelKey(header),
  ].join('|');
}

export function groupDicomSeries(slices: DicomSliceEntry[]): DicomSeriesGroup[] {
  const groups = new Map<string, DicomSeriesGroup>();

  for (const slice of slices) {
    if (!isNativeLittleEndianDicom(slice.header)) continue;
    if ((slice.header.numberOfFrames ?? 1) > 1) continue;

    const baseKey = buildDicomSeriesKey(slice);
    const positionKey = slice.header.imagePositionPatient
      .map((value) => value.toFixed(4))
      .join('\\');
    let index = 0;
    let key = baseKey;
    let group = groups.get(key);

    while (
      group?.slices.some(
        (existing) =>
          existing.header.imagePositionPatient
            .map((value) => value.toFixed(4))
            .join('\\') === positionKey,
      )
    ) {
      group.duplicatePositions += 1;
      index += 1;
      key = `${baseKey}|duplicate-${index}`;
      group = groups.get(key);
    }

    if (!group) {
      group = {
        key,
        slices: [],
        duplicatePositions: 0,
        orientation: resolveDicomOrientationLabel(slice.header),
      };
      groups.set(key, group);
    }
    group.slices.push(slice);
  }

  return [...groups.values()];
}

export function selectPrimaryDicomSeries(
  slices: DicomSliceEntry[],
): DicomSliceEntry[] {
  const groups = groupDicomSeries(slices);
  return (
    groups
      .sort((left, right) => {
        const leftLocalizer = /localizer/i.test(
          left.slices[0]?.header.seriesDescription ?? '',
        );
        const rightLocalizer = /localizer/i.test(
          right.slices[0]?.header.seriesDescription ?? '',
        );
        if (leftLocalizer !== rightLocalizer) return leftLocalizer ? 1 : -1;
        if (right.slices.length !== left.slices.length) {
          return right.slices.length - left.slices.length;
        }
        return left.duplicatePositions - right.duplicatePositions;
      })[0]?.slices ?? []
  );
}

export function estimateZSpacing(sortedSlices: DicomSliceEntry[]): number {
  const spacings: number[] = [];
  for (let index = 1; index < sortedSlices.length; index += 1) {
    const step = Math.abs(
      sortedSlices[index].sliceLocation - sortedSlices[index - 1].sliceLocation,
    );
    if (step > 1e-6) spacings.push(step);
  }
  if (spacings.length === 0) {
    const first = sortedSlices[0]?.header;
    return first?.spacingBetweenSlices || first?.sliceThickness || 0;
  }
  spacings.sort((left, right) => left - right);
  return spacings[Math.floor(spacings.length / 2)];
}

