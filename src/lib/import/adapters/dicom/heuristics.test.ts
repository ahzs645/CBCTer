import { describe, expect, it } from 'vitest';
import { VolumeAxis } from '../../../../types';
import type { DicomHeader, DicomSliceEntry } from './reader';
import {
  estimateZSpacing,
  groupDicomSeries,
  resolveDicomOrientationLabel,
  selectPrimaryDicomSeries,
} from './heuristics';

function header(
  overrides: Partial<DicomHeader> = {},
): DicomHeader {
  return {
    bitsAllocated: 16,
    bitsStored: 16,
    columns: 2,
    imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    imagePositionPatient: [0, 0, 0],
    instanceNumber: 1,
    pixelDataLength: 8,
    pixelDataOffset: 0,
    pixelRepresentation: 1,
    pixelSpacing: [1, 1],
    photometricInterpretation: 'MONOCHROME2',
    rescaleIntercept: 0,
    rescaleSlope: 1,
    rows: 2,
    samplesPerPixel: 1,
    seriesInstanceUid: 'series-a',
    sliceThickness: 1,
    studyInstanceUid: 'study-a',
    transferSyntaxUid: '1.2.840.10008.1.2.1',
    ...overrides,
  };
}

function slice(
  sliceLocation: number,
  overrides: Partial<DicomHeader> = {},
): DicomSliceEntry {
  return {
    entry: {
      name: `${sliceLocation}.dcm`,
      relativePath: `${sliceLocation}.dcm`,
      file: new File([], `${sliceLocation}.dcm`),
    },
    header: header({
      imagePositionPatient: [0, 0, sliceLocation],
      instanceNumber: sliceLocation + 1,
      ...overrides,
    }),
    sliceLocation,
  };
}

describe('DICOM heuristics', () => {
  it('resolves orientation from image orientation patient', () => {
    expect(resolveDicomOrientationLabel(header())).toBe(VolumeAxis.Axial);
    expect(
      resolveDicomOrientationLabel(
        header({ imageOrientationPatient: [0, 1, 0, 0, 0, 1] }),
      ),
    ).toBe(VolumeAxis.Sagittal);
  });

  it('deduplicates repeated IPP positions inside a series group', () => {
    const groups = groupDicomSeries([
      slice(0),
      slice(1),
      slice(1, { instanceNumber: 99 }),
      slice(2),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].duplicatePositions).toBe(1);
    expect(groups[0].slices.map((item) => item.sliceLocation)).toEqual([
      0, 1, 2,
    ]);
  });

  it('prefers non-localizer series with more unique slices', () => {
    const selected = selectPrimaryDicomSeries([
      slice(0, { seriesInstanceUid: 'localizer', seriesDescription: 'Localizer' }),
      slice(0, { seriesInstanceUid: 'volume' }),
      slice(1, { seriesInstanceUid: 'volume' }),
    ]);
    expect(selected.map((item) => item.header.seriesInstanceUid)).toEqual([
      'volume',
      'volume',
    ]);
  });

  it('uses median IPP-derived spacing', () => {
    expect(estimateZSpacing([slice(0), slice(1), slice(2), slice(10)])).toBe(1);
  });
});
