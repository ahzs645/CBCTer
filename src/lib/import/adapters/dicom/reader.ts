import type {
  ReadonlyVec3,
  ScanFolderEntry,
  ScanFolderSource,
  Vec3,
} from '../../../../types';

const DICM_MAGIC = 'DICM';
const HEADER_READ_BYTES = 8192;
const UNDEFINED_LENGTH = 0xffffffff;

const TAG_BITS_ALLOCATED = '00280100';
const TAG_BITS_STORED = '00280101';
const TAG_COLUMNS = '00280011';
const TAG_IMAGE_ORIENTATION = '00200037';
const TAG_IMAGE_POSITION = '00200032';
const TAG_IMAGE_TYPE = '00080008';
const TAG_IMAGER_PIXEL_SPACING = '00181164';
const TAG_INSTANCE_NUMBER = '00200013';
const TAG_MODALITY = '00080060';
const TAG_NUMBER_OF_FRAMES = '00280008';
const TAG_PATIENT_ID = '00100020';
const TAG_PATIENT_NAME = '00100010';
const TAG_PIXEL_DATA = '7fe00010';
const TAG_PIXEL_REPRESENTATION = '00280103';
const TAG_PIXEL_SPACING = '00280030';
const TAG_PHOTOMETRIC_INTERPRETATION = '00280004';
const TAG_RESCALE_INTERCEPT = '00281052';
const TAG_RESCALE_SLOPE = '00281053';
const TAG_ROWS = '00280010';
const TAG_SAMPLES_PER_PIXEL = '00280002';
const TAG_SERIES_INSTANCE_UID = '0020000e';
const TAG_SERIES_DESCRIPTION = '0008103e';
const TAG_SLICE_THICKNESS = '00180050';
const TAG_SOP_CLASS_UID = '00080016';
const TAG_SPACING_BETWEEN_SLICES = '00180088';
const TAG_STUDY_DATE = '00080020';
const TAG_STUDY_ID = '00200010';
const TAG_STUDY_INSTANCE_UID = '0020000d';
const TAG_STUDY_TIME = '00080030';
const TAG_TRANSFER_SYNTAX_UID = '00020010';
const TAG_WINDOW_CENTER = '00281050';
const TAG_WINDOW_WIDTH = '00281051';

const IMPLICIT_LITTLE_ENDIAN = '1.2.840.10008.1.2';
const EXPLICIT_LITTLE_ENDIAN = '1.2.840.10008.1.2.1';

const LONG_VR = new Set([
  'OB',
  'OD',
  'OF',
  'OL',
  'OV',
  'OW',
  'SQ',
  'UC',
  'UN',
  'UR',
  'UT',
]);

export interface DicomHeader {
  bitsAllocated: number;
  bitsStored: number;
  columns: number;
  framePositions?: Vec3[];
  imageOrientationPatient: [number, number, number, number, number, number];
  imagePositionPatient: Vec3;
  instanceNumber?: number;
  modality?: string;
  numberOfFrames?: number;
  patientId?: string;
  patientName?: string;
  pixelDataLength: number;
  pixelDataOffset: number;
  pixelRepresentation: number;
  pixelSpacing: [number, number];
  photometricInterpretation?: string;
  rescaleIntercept: number;
  rescaleSlope: number;
  rows: number;
  samplesPerPixel: number;
  seriesDescription?: string;
  seriesInstanceUid?: string;
  sliceThickness?: number;
  spacingBetweenSlices?: number;
  studyDate?: string;
  studyId?: string;
  studyInstanceUid?: string;
  studyTime?: string;
  transferSyntaxUid: string;
  windowCenter?: number;
  windowWidth?: number;
}

interface ParseDicomOptions {
  requirePixelData?: boolean;
}

export interface DicomSliceEntry {
  entry: ScanFolderEntry;
  header: DicomHeader;
  sliceLocation: number;
}

export interface EnhancedDicomHeader extends DicomHeader {
  framePositions: Vec3[];
  modality?: string;
  numberOfFrames: number;
  sopClassUid?: string;
}

export interface DicomOverview {
  bitsAllocated?: number;
  columns?: number;
  imageType?: string;
  modality?: string;
  numberOfFrames?: number;
  patientId?: string;
  patientName?: string;
  photometricInterpretation?: string;
  rows?: number;
  samplesPerPixel?: number;
  seriesDescription?: string;
  sopClassUid?: string;
  studyInstanceUid?: string;
  transferSyntaxUid: string;
}

interface DicomElementHeader {
  group: number;
  element: number;
  length: number;
  tag: string;
  valueOffset: number;
  vr?: string;
}

type DicomElementVisitor = (header: DicomElementHeader) => boolean | undefined;

function decodeAscii(
  bytes: Uint8Array,
  offset: number,
  length: number,
): string {
  return new TextDecoder('ascii')
    .decode(bytes.subarray(offset, offset + length))
    .replace(/\0/g, '')
    .trim();
}

function parseNumberList(value: string): number[] {
  return value
    .split('\\')
    .map((item) => Number.parseFloat(item.trim()))
    .filter((item) => Number.isFinite(item));
}

function isPositiveSpacing(value: [number, number] | undefined): boolean {
  return Boolean(value?.every((item) => Number.isFinite(item) && item > 0));
}

function parseTag(group: number, element: number): string {
  return ((group << 16) | element).toString(16).padStart(8, '0');
}

function readElementHeader(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  explicitVr: boolean,
): DicomElementHeader {
  const group = view.getUint16(offset, true);
  const element = view.getUint16(offset + 2, true);
  const tag = parseTag(group, element);

  if (!explicitVr) {
    return {
      group,
      element,
      length: view.getUint32(offset + 4, true),
      tag,
      valueOffset: offset + 8,
    };
  }

  const vr = decodeAscii(bytes, offset + 4, 2);
  if (LONG_VR.has(vr)) {
    return {
      group,
      element,
      length: view.getUint32(offset + 8, true),
      tag,
      valueOffset: offset + 12,
      vr,
    };
  }

  return {
    group,
    element,
    length: view.getUint16(offset + 6, true),
    tag,
    valueOffset: offset + 8,
    vr,
  };
}

function skipUndefinedLengthValue(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  explicitVr: boolean,
): number {
  let cursor = offset;

  while (cursor + 8 <= bytes.byteLength) {
    const group = view.getUint16(cursor, true);
    const element = view.getUint16(cursor + 2, true);
    const itemLength = view.getUint32(cursor + 4, true);

    if (group === 0xfffe && element === 0xe0dd) {
      return cursor + 8 + (itemLength === UNDEFINED_LENGTH ? 0 : itemLength);
    }

    if (group === 0xfffe && element === 0xe00d) {
      return cursor + 8 + (itemLength === UNDEFINED_LENGTH ? 0 : itemLength);
    }

    if (group === 0xfffe && element === 0xe000) {
      cursor += 8;
      cursor =
        itemLength === UNDEFINED_LENGTH
          ? skipUndefinedLengthValue(bytes, view, cursor, explicitVr)
          : cursor + itemLength;
      continue;
    }

    const header = readElementHeader(bytes, view, cursor, explicitVr);
    cursor = header.valueOffset;
    if (header.length === UNDEFINED_LENGTH) {
      cursor = skipUndefinedLengthValue(bytes, view, cursor, explicitVr);
      continue;
    }
    cursor += header.length;
  }

  return bytes.byteLength;
}

function walkDicomElements(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  end: number,
  explicitVr: boolean,
  visitor: DicomElementVisitor,
): number {
  let cursor = offset;

  while (cursor + 8 <= end && cursor + 8 <= bytes.byteLength) {
    const group = view.getUint16(cursor, true);
    const element = view.getUint16(cursor + 2, true);
    const itemLength = view.getUint32(cursor + 4, true);

    if (group === 0xfffe && element === 0xe0dd) {
      return cursor + 8 + (itemLength === UNDEFINED_LENGTH ? 0 : itemLength);
    }

    if (group === 0xfffe && element === 0xe00d) {
      return cursor + 8 + (itemLength === UNDEFINED_LENGTH ? 0 : itemLength);
    }

    if (group === 0xfffe && element === 0xe000) {
      const itemValueOffset = cursor + 8;
      cursor =
        itemLength === UNDEFINED_LENGTH
          ? walkDicomElements(
              bytes,
              view,
              itemValueOffset,
              end,
              explicitVr,
              visitor,
            )
          : walkDicomElements(
              bytes,
              view,
              itemValueOffset,
              Math.min(itemValueOffset + itemLength, end),
              explicitVr,
              visitor,
            );
      continue;
    }

    const header = readElementHeader(bytes, view, cursor, explicitVr);
    const valueEnd =
      header.length === UNDEFINED_LENGTH
        ? end
        : Math.min(header.valueOffset + header.length, end);

    if (visitor(header) === false) return cursor;

    if (header.vr === 'SQ' || header.length === UNDEFINED_LENGTH) {
      cursor = walkDicomElements(
        bytes,
        view,
        header.valueOffset,
        valueEnd,
        explicitVr,
        visitor,
      );
      continue;
    }

    cursor = valueEnd;
  }

  return cursor;
}

function readTextValue(
  bytes: Uint8Array,
  offset: number,
  length: number,
): string {
  if (length === UNDEFINED_LENGTH) return '';
  return decodeAscii(bytes, offset, length);
}

function readUint16Value(
  view: DataView,
  offset: number,
  length: number,
): number | undefined {
  if (length < 2) return undefined;
  return view.getUint16(offset, true);
}

function resolvePixelSpacing(
  pixelSpacing: [number, number] | undefined,
  imagerPixelSpacing: [number, number] | undefined,
): [number, number] | undefined {
  if (isPositiveSpacing(pixelSpacing)) return pixelSpacing;
  if (isPositiveSpacing(imagerPixelSpacing)) return imagerPixelSpacing;
  return undefined;
}

function parseIntegerText(
  bytes: Uint8Array,
  offset: number,
  length: number,
): number | undefined {
  const parsed = Number.parseInt(decodeAscii(bytes, offset, length), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseFloatText(
  bytes: Uint8Array,
  offset: number,
  length: number,
): number | undefined {
  const parsed = Number.parseFloat(decodeAscii(bytes, offset, length));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cross(a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: ReadonlyVec3, b: ReadonlyVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function resolveDicomHeaderReadLength(fileSize: number): number {
  return Math.min(fileSize, HEADER_READ_BYTES);
}

function readTransferSyntax(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
): { offset: number; transferSyntaxUid: string } {
  let cursor = offset;
  let transferSyntaxUid = IMPLICIT_LITTLE_ENDIAN;

  if (cursor === 132) {
    while (cursor + 8 <= bytes.byteLength) {
      const header = readElementHeader(bytes, view, cursor, true);
      if (header.group !== 0x0002) break;

      if (header.tag === TAG_TRANSFER_SYNTAX_UID) {
        transferSyntaxUid = readTextValue(
          bytes,
          header.valueOffset,
          header.length,
        );
      }

      if (header.length === UNDEFINED_LENGTH) break;
      cursor = header.valueOffset + header.length;
    }
  }

  return { offset: cursor, transferSyntaxUid };
}

export function readDicomOverview(buffer: ArrayBuffer): DicomOverview {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const startOffset =
    bytes.byteLength >= 132 && decodeAscii(bytes, 128, 4) === DICM_MAGIC
      ? 132
      : 0;
  const transferSyntax = readTransferSyntax(bytes, view, startOffset);
  const overview: DicomOverview = {
    transferSyntaxUid: transferSyntax.transferSyntaxUid,
  };
  const explicitVr = overview.transferSyntaxUid !== IMPLICIT_LITTLE_ENDIAN;
  let offset = transferSyntax.offset;

  while (offset + 8 <= buffer.byteLength) {
    const header = readElementHeader(bytes, view, offset, explicitVr);
    const { length, tag, valueOffset } = header;
    offset = valueOffset;

    if (tag === TAG_PIXEL_DATA) break;
    if (length !== UNDEFINED_LENGTH && offset + length > buffer.byteLength) {
      break;
    }

    if (tag === TAG_SOP_CLASS_UID)
      overview.sopClassUid = readTextValue(bytes, offset, length);
    else if (tag === TAG_IMAGE_TYPE)
      overview.imageType = readTextValue(bytes, offset, length);
    else if (tag === TAG_MODALITY)
      overview.modality = readTextValue(bytes, offset, length);
    else if (tag === TAG_PATIENT_ID)
      overview.patientId = readTextValue(bytes, offset, length);
    else if (tag === TAG_PATIENT_NAME)
      overview.patientName = readTextValue(bytes, offset, length);
    else if (tag === TAG_SERIES_DESCRIPTION)
      overview.seriesDescription = readTextValue(bytes, offset, length);
    else if (tag === TAG_STUDY_INSTANCE_UID)
      overview.studyInstanceUid = readTextValue(bytes, offset, length);
    else if (tag === TAG_NUMBER_OF_FRAMES)
      overview.numberOfFrames = parseIntegerText(bytes, offset, length);
    else if (tag === TAG_ROWS)
      overview.rows = readUint16Value(view, offset, length);
    else if (tag === TAG_COLUMNS)
      overview.columns = readUint16Value(view, offset, length);
    else if (tag === TAG_BITS_ALLOCATED)
      overview.bitsAllocated = readUint16Value(view, offset, length);
    else if (tag === TAG_SAMPLES_PER_PIXEL)
      overview.samplesPerPixel = readUint16Value(view, offset, length);
    else if (tag === TAG_PHOTOMETRIC_INTERPRETATION)
      overview.photometricInterpretation = readTextValue(bytes, offset, length);

    if (length === UNDEFINED_LENGTH) {
      offset = skipUndefinedLengthValue(bytes, view, offset, explicitVr);
    } else {
      offset += length;
    }
  }

  return overview;
}

export function parseEnhancedMultiframeDicom(
  buffer: ArrayBuffer,
  options?: ParseDicomOptions,
): EnhancedDicomHeader {
  const requirePixelData = options?.requirePixelData ?? true;
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const startOffset =
    bytes.byteLength >= 132 && decodeAscii(bytes, 128, 4) === DICM_MAGIC
      ? 132
      : 0;
  const transferSyntax = readTransferSyntax(bytes, view, startOffset);
  const transferSyntaxUid = transferSyntax.transferSyntaxUid;
  const explicitVr = transferSyntaxUid !== IMPLICIT_LITTLE_ENDIAN;

  let bitsAllocated = 16;
  let bitsStored = 16;
  let columns: number | undefined;
  const framePositions: Vec3[] = [];
  const imageOrientations: [number, number, number, number, number, number][] =
    [];
  let instanceNumber: number | undefined;
  let modality: string | undefined;
  let numberOfFrames: number | undefined;
  let patientId: string | undefined;
  let patientName: string | undefined;
  let pixelDataLength: number | undefined;
  let pixelDataOffset: number | undefined;
  let pixelRepresentation = 1;
  const pixelSpacings: [number, number][] = [];
  let photometricInterpretation: string | undefined;
  let rescaleIntercept = 0;
  let rescaleSlope = 1;
  let rows: number | undefined;
  let samplesPerPixel = 1;
  let seriesDescription: string | undefined;
  let seriesInstanceUid: string | undefined;
  let sliceThickness: number | undefined;
  let sopClassUid: string | undefined;
  let spacingBetweenSlices: number | undefined;
  let studyDate: string | undefined;
  let studyId: string | undefined;
  let studyInstanceUid: string | undefined;
  let studyTime: string | undefined;
  let windowCenter: number | undefined;
  let windowWidth: number | undefined;

  walkDicomElements(
    bytes,
    view,
    transferSyntax.offset,
    bytes.byteLength,
    explicitVr,
    (header) => {
      const { length, tag, valueOffset } = header;
      if (tag === TAG_PIXEL_DATA) {
        if (length === UNDEFINED_LENGTH && requirePixelData) {
          throw new Error('unsupported encapsulated DICOM pixel data');
        }
        pixelDataOffset = valueOffset;
        pixelDataLength = length;
        return false;
      }

      if (length !== UNDEFINED_LENGTH && valueOffset + length > bytes.length) {
        return false;
      }

      switch (tag) {
        case TAG_SOP_CLASS_UID:
          sopClassUid = readTextValue(bytes, valueOffset, length);
          break;
        case TAG_MODALITY:
          modality = readTextValue(bytes, valueOffset, length);
          break;
        case TAG_PATIENT_ID:
          patientId = readTextValue(bytes, valueOffset, length);
          break;
        case TAG_PATIENT_NAME:
          patientName = readTextValue(bytes, valueOffset, length);
          break;
        case TAG_SERIES_DESCRIPTION:
          seriesDescription = readTextValue(bytes, valueOffset, length);
          break;
        case TAG_NUMBER_OF_FRAMES:
          numberOfFrames = parseIntegerText(bytes, valueOffset, length);
          break;
        case TAG_ROWS:
          rows = readUint16Value(view, valueOffset, length);
          break;
        case TAG_COLUMNS:
          columns = readUint16Value(view, valueOffset, length);
          break;
        case TAG_BITS_ALLOCATED:
          bitsAllocated =
            readUint16Value(view, valueOffset, length) ?? bitsAllocated;
          break;
        case TAG_BITS_STORED:
          bitsStored = readUint16Value(view, valueOffset, length) ?? bitsStored;
          break;
        case TAG_PIXEL_REPRESENTATION:
          pixelRepresentation =
            readUint16Value(view, valueOffset, length) ?? pixelRepresentation;
          break;
        case TAG_SAMPLES_PER_PIXEL:
          samplesPerPixel =
            readUint16Value(view, valueOffset, length) ?? samplesPerPixel;
          break;
        case TAG_INSTANCE_NUMBER:
          instanceNumber = parseIntegerText(bytes, valueOffset, length);
          break;
        case TAG_STUDY_DATE:
          studyDate = readTextValue(bytes, valueOffset, length);
          break;
        case TAG_STUDY_ID:
          studyId = readTextValue(bytes, valueOffset, length);
          break;
        case TAG_STUDY_INSTANCE_UID:
          studyInstanceUid = readTextValue(bytes, valueOffset, length);
          break;
        case TAG_STUDY_TIME:
          studyTime = readTextValue(bytes, valueOffset, length);
          break;
        case TAG_SERIES_INSTANCE_UID:
          seriesInstanceUid = readTextValue(bytes, valueOffset, length);
          break;
        case TAG_PHOTOMETRIC_INTERPRETATION:
          photometricInterpretation = readTextValue(bytes, valueOffset, length);
          break;
        case TAG_PIXEL_SPACING:
        case TAG_IMAGER_PIXEL_SPACING: {
          const values = parseNumberList(
            readTextValue(bytes, valueOffset, length),
          );
          if (values.length >= 2) pixelSpacings.push([values[0], values[1]]);
          break;
        }
        case TAG_SLICE_THICKNESS:
          sliceThickness = parseFloatText(bytes, valueOffset, length);
          break;
        case TAG_SPACING_BETWEEN_SLICES:
          spacingBetweenSlices = parseFloatText(bytes, valueOffset, length);
          break;
        case TAG_IMAGE_POSITION: {
          const values = parseNumberList(
            readTextValue(bytes, valueOffset, length),
          );
          if (values.length >= 3) {
            framePositions.push([values[0], values[1], values[2]]);
          }
          break;
        }
        case TAG_IMAGE_ORIENTATION: {
          const values = parseNumberList(
            readTextValue(bytes, valueOffset, length),
          );
          if (values.length >= 6) {
            imageOrientations.push([
              values[0],
              values[1],
              values[2],
              values[3],
              values[4],
              values[5],
            ]);
          }
          break;
        }
        case TAG_WINDOW_CENTER:
          windowCenter = parseFloatText(bytes, valueOffset, length);
          break;
        case TAG_WINDOW_WIDTH:
          windowWidth = parseFloatText(bytes, valueOffset, length);
          break;
        case TAG_RESCALE_INTERCEPT:
          rescaleIntercept =
            parseFloatText(bytes, valueOffset, length) ?? rescaleIntercept;
          break;
        case TAG_RESCALE_SLOPE: {
          const parsed = parseFloatText(bytes, valueOffset, length);
          if (parsed != null && parsed !== 0) rescaleSlope = parsed;
          break;
        }
      }
    },
  );

  const pixelSpacing = pixelSpacings.find(isPositiveSpacing);
  const imageOrientationPatient = imageOrientations[0];
  const imagePositionPatient = framePositions[0];

  if (
    rows == null ||
    columns == null ||
    numberOfFrames == null ||
    pixelSpacing == null ||
    imagePositionPatient == null ||
    imageOrientationPatient == null
  ) {
    throw new Error('missing required enhanced DICOM metadata');
  }

  if (
    requirePixelData &&
    (pixelDataOffset == null || pixelDataLength == null)
  ) {
    throw new Error('missing DICOM pixel data');
  }

  return {
    bitsAllocated,
    bitsStored,
    columns,
    framePositions,
    imageOrientationPatient,
    imagePositionPatient,
    instanceNumber,
    modality,
    numberOfFrames,
    patientId,
    patientName,
    pixelDataLength: pixelDataLength ?? 0,
    pixelDataOffset: pixelDataOffset ?? 0,
    pixelRepresentation,
    pixelSpacing,
    photometricInterpretation,
    rescaleIntercept,
    rescaleSlope,
    rows,
    samplesPerPixel,
    seriesDescription,
    seriesInstanceUid,
    sliceThickness,
    sopClassUid,
    spacingBetweenSlices,
    studyDate,
    studyId,
    studyInstanceUid,
    studyTime,
    transferSyntaxUid,
    windowCenter,
    windowWidth,
  };
}

export function parseImplicitLittleEndianDicom(
  buffer: ArrayBuffer,
  options?: ParseDicomOptions,
): DicomHeader {
  const requirePixelData = options?.requirePixelData ?? true;
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let offset =
    bytes.byteLength >= 132 && decodeAscii(bytes, 128, 4) === DICM_MAGIC
      ? 132
      : 0;
  const transferSyntax = readTransferSyntax(bytes, view, offset);
  offset = transferSyntax.offset;
  const transferSyntaxUid = transferSyntax.transferSyntaxUid;

  const explicitVr = transferSyntaxUid !== IMPLICIT_LITTLE_ENDIAN;

  let bitsAllocated = 16;
  let bitsStored = 16;
  let columns: number | undefined;
  let imageOrientationPatient:
    | [number, number, number, number, number, number]
    | undefined;
  let imagePositionPatient: Vec3 | undefined;
  let instanceNumber: number | undefined;
  let imagerPixelSpacing: [number, number] | undefined;
  let patientId: string | undefined;
  let patientName: string | undefined;
  let pixelDataLength: number | undefined;
  let pixelDataOffset: number | undefined;
  let pixelRepresentation = 1;
  let pixelSpacing: [number, number] | undefined;
  let photometricInterpretation: string | undefined;
  let rescaleIntercept = 0;
  let rescaleSlope = 1;
  let rows: number | undefined;
  let samplesPerPixel = 1;
  let seriesDescription: string | undefined;
  let seriesInstanceUid: string | undefined;
  let sliceThickness: number | undefined;
  let studyDate: string | undefined;
  let studyId: string | undefined;
  let studyInstanceUid: string | undefined;
  let studyTime: string | undefined;
  let windowCenter: number | undefined;
  let windowWidth: number | undefined;

  while (offset + 8 <= buffer.byteLength) {
    const header = readElementHeader(bytes, view, offset, explicitVr);
    const { length, tag, valueOffset } = header;
    offset = valueOffset;

    if (length !== UNDEFINED_LENGTH && offset + length > buffer.byteLength) {
      if (!requirePixelData) break;
      throw new Error('truncated DICOM element');
    }

    if (tag === TAG_PIXEL_DATA) {
      if (length === UNDEFINED_LENGTH && requirePixelData) {
        throw new Error('unsupported encapsulated DICOM pixel data');
      }
      pixelDataOffset = offset;
      pixelDataLength = length;
      break;
    }

    if (tag === TAG_ROWS) rows = readUint16Value(view, offset, length);
    else if (tag === TAG_COLUMNS)
      columns = readUint16Value(view, offset, length);
    else if (tag === TAG_BITS_ALLOCATED)
      bitsAllocated = readUint16Value(view, offset, length) ?? bitsAllocated;
    else if (tag === TAG_BITS_STORED)
      bitsStored = readUint16Value(view, offset, length) ?? bitsStored;
    else if (tag === TAG_PIXEL_REPRESENTATION)
      pixelRepresentation =
        readUint16Value(view, offset, length) ?? pixelRepresentation;
    else if (tag === TAG_SAMPLES_PER_PIXEL)
      samplesPerPixel =
        readUint16Value(view, offset, length) ?? samplesPerPixel;
    else if (tag === TAG_INSTANCE_NUMBER) {
      const parsed = Number.parseInt(decodeAscii(bytes, offset, length), 10);
      if (Number.isFinite(parsed)) instanceNumber = parsed;
    } else if (tag === TAG_STUDY_DATE)
      studyDate = decodeAscii(bytes, offset, length);
    else if (tag === TAG_STUDY_ID) studyId = decodeAscii(bytes, offset, length);
    else if (tag === TAG_STUDY_INSTANCE_UID)
      studyInstanceUid = decodeAscii(bytes, offset, length);
    else if (tag === TAG_STUDY_TIME)
      studyTime = decodeAscii(bytes, offset, length);
    else if (tag === TAG_PATIENT_ID)
      patientId = decodeAscii(bytes, offset, length);
    else if (tag === TAG_PATIENT_NAME)
      patientName = decodeAscii(bytes, offset, length);
    else if (tag === TAG_SERIES_DESCRIPTION)
      seriesDescription = decodeAscii(bytes, offset, length);
    else if (tag === TAG_SERIES_INSTANCE_UID)
      seriesInstanceUid = decodeAscii(bytes, offset, length);
    else if (tag === TAG_PHOTOMETRIC_INTERPRETATION)
      photometricInterpretation = decodeAscii(bytes, offset, length);
    else if (tag === TAG_PIXEL_SPACING) {
      const values = parseNumberList(decodeAscii(bytes, offset, length));
      if (values.length >= 2) pixelSpacing = [values[0], values[1]];
    } else if (tag === TAG_IMAGER_PIXEL_SPACING) {
      const values = parseNumberList(decodeAscii(bytes, offset, length));
      if (values.length >= 2) imagerPixelSpacing = [values[0], values[1]];
    } else if (tag === TAG_SLICE_THICKNESS) {
      const parsed = Number.parseFloat(decodeAscii(bytes, offset, length));
      if (Number.isFinite(parsed)) sliceThickness = parsed;
    } else if (tag === TAG_IMAGE_POSITION) {
      const values = parseNumberList(decodeAscii(bytes, offset, length));
      if (values.length >= 3) {
        imagePositionPatient = [values[0], values[1], values[2]];
      }
    } else if (tag === TAG_IMAGE_ORIENTATION) {
      const values = parseNumberList(decodeAscii(bytes, offset, length));
      if (values.length >= 6) {
        imageOrientationPatient = [
          values[0],
          values[1],
          values[2],
          values[3],
          values[4],
          values[5],
        ];
      }
    } else if (tag === TAG_WINDOW_CENTER) {
      const parsed = Number.parseFloat(decodeAscii(bytes, offset, length));
      if (Number.isFinite(parsed)) windowCenter = parsed;
    } else if (tag === TAG_WINDOW_WIDTH) {
      const parsed = Number.parseFloat(decodeAscii(bytes, offset, length));
      if (Number.isFinite(parsed)) windowWidth = parsed;
    } else if (tag === TAG_RESCALE_INTERCEPT) {
      const parsed = Number.parseFloat(decodeAscii(bytes, offset, length));
      if (Number.isFinite(parsed)) rescaleIntercept = parsed;
    } else if (tag === TAG_RESCALE_SLOPE) {
      const parsed = Number.parseFloat(decodeAscii(bytes, offset, length));
      if (Number.isFinite(parsed) && parsed !== 0) rescaleSlope = parsed;
    }

    if (length === UNDEFINED_LENGTH) {
      offset = skipUndefinedLengthValue(bytes, view, offset, explicitVr);
    } else {
      offset += length;
    }
  }

  const resolvedPixelSpacing = resolvePixelSpacing(
    pixelSpacing,
    imagerPixelSpacing,
  );

  if (
    rows == null ||
    columns == null ||
    resolvedPixelSpacing == null ||
    imagePositionPatient == null ||
    imageOrientationPatient == null
  ) {
    throw new Error('missing required DICOM metadata');
  }

  if (
    requirePixelData &&
    (pixelDataOffset == null || pixelDataLength == null)
  ) {
    throw new Error('missing DICOM pixel data');
  }

  return {
    bitsAllocated,
    bitsStored,
    columns,
    imageOrientationPatient,
    imagePositionPatient,
    instanceNumber,
    patientId,
    patientName,
    pixelDataLength: pixelDataLength ?? 0,
    pixelDataOffset: pixelDataOffset ?? 0,
    pixelRepresentation,
    pixelSpacing: resolvedPixelSpacing,
    photometricInterpretation,
    rescaleIntercept,
    rescaleSlope,
    rows,
    samplesPerPixel,
    seriesDescription,
    seriesInstanceUid,
    sliceThickness,
    studyDate,
    studyId,
    studyInstanceUid,
    studyTime,
    transferSyntaxUid,
    windowCenter,
    windowWidth,
  };
}

export function computeDicomSliceLocation(header: DicomHeader): number {
  const row = header.imageOrientationPatient.slice(0, 3) as Vec3;
  const column = header.imageOrientationPatient.slice(3, 6) as Vec3;
  return dot(header.imagePositionPatient, cross(row, column));
}

export function sortDicomSlices(entries: DicomSliceEntry[]): DicomSliceEntry[] {
  return [...entries].sort((left, right) => {
    const delta = left.sliceLocation - right.sliceLocation;
    if (Math.abs(delta) > 1e-6) return delta;
    return (
      (left.header.instanceNumber ?? 0) - (right.header.instanceNumber ?? 0)
    );
  });
}

export function findDicomEntries(source: ScanFolderSource): ScanFolderEntry[] {
  return source.entries.filter((entry) => /\.dcm$/i.test(entry.name));
}

export function isNativeLittleEndianDicom(header: DicomHeader): boolean {
  return (
    (header.transferSyntaxUid === IMPLICIT_LITTLE_ENDIAN ||
      header.transferSyntaxUid === EXPLICIT_LITTLE_ENDIAN) &&
    header.samplesPerPixel === 1 &&
    (header.photometricInterpretation == null ||
      header.photometricInterpretation === 'MONOCHROME1' ||
      header.photometricInterpretation === 'MONOCHROME2')
  );
}
