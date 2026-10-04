import { describe, expect, it } from 'vitest';
import { ScanFolderSourceKind, type ScanFolderSource } from '../../../../types';
import { parseDicomFolder } from './parser';

describe('parseDicomFolder', () => {
  it('routes ITK/GDCM through the client-side engine path', async () => {
    const source: ScanFolderSource = {
      kind: ScanFolderSourceKind.FileList,
      label: 'empty',
      entries: [],
    };

    await expect(
      parseDicomFolder(source, { dicomEngine: 'itk-gdcm' }),
    ).rejects.toMatchObject({
      code: 'E_DICOM_COUNT',
    });
  });
});

function dicomFile(z: number, slope = 1, bits = 16, padding?: number): File {
  const parts: Uint8Array[] = [];
  const add = (
    group: number,
    element: number,
    value: string | number | Uint8Array,
  ) => {
    let data: Uint8Array;
    if (typeof value === 'number') {
      data = new Uint8Array(2);
      new DataView(data.buffer).setUint16(0, value, true);
    } else if (typeof value === 'string')
      data = new TextEncoder().encode(value.length % 2 ? value + ' ' : value);
    else data = value;
    const header = new Uint8Array(8),
      v = new DataView(header.buffer);
    v.setUint16(0, group, true);
    v.setUint16(2, element, true);
    v.setUint32(4, data.length, true);
    parts.push(header, data);
  };
  add(0x28, 0x10, 2);
  add(0x28, 0x11, 2);
  add(0x28, 0x100, bits);
  add(0x28, 0x101, 12);
  add(0x28, 0x102, 11);
  add(0x28, 0x103, 1);
  add(0x20, 0x32, `0\\0\\${z}`);
  add(0x20, 0x37, '1\\0\\0\\0\\1\\0');
  add(0x28, 0x30, '.16\\.16');
  add(0x28, 0x1053, String(slope));
  add(0x28, 0x1052, '-1024');
  if (padding != null) add(0x28, 0x120, padding);
  add(0x7fe0, 0x10, new Uint8Array(8));
  return new File(parts as BlobPart[], `${z}.dcm`);
}
const stack = (files: File[]): ScanFolderSource => ({
  kind: ScanFolderSourceKind.FileList,
  label: 'test',
  entries: files.map((file) => ({
    name: file.name,
    relativePath: file.name,
    file,
  })),
});
describe('native DICOM fidelity guards', () => {
  it('retains sorted positions, bit placement and signed padding', async () => {
    const parsed = await parseDicomFolder(
      stack([
        dicomFile(0.32, 1, 16, 0x8000),
        dicomFile(0, 1, 16, 0x8000),
        dicomFile(0.16, 1, 16, 0x8000),
      ]),
    );
    expect(parsed.meta.dimensions).toEqual([2, 2, 3]);
    expect(parsed.meta.nativeGeometry).toMatchObject({
      bitsStored: 12,
      highBit: 11,
      paddingValue: -32768,
      origin: [0, 0, 0],
      calibration: { divisor: 1, slope: 1, intercept: -1024 },
    });
  });
  it('rejects a missing interior slice instead of joining its neighbours', async () => {
    await expect(
      parseDicomFolder(stack([0, 0.16, 0.48, 0.64].map((z) => dicomFile(z)))),
    ).rejects.toMatchObject({ code: 'E_DICOM_GAP' });
  });
  it('rejects inconsistent calibration within the selected stack', async () => {
    await expect(
      parseDicomFolder(
        stack([dicomFile(0), dicomFile(0.16, 2), dicomFile(0.32)]),
      ),
    ).rejects.toMatchObject({ code: 'E_DICOM_MISMATCH' });
  });
  it('rejects unsupported stored word widths', async () => {
    await expect(
      parseDicomFolder(stack([dicomFile(0, 1, 32), dicomFile(0.16, 1, 32)])),
    ).rejects.toMatchObject({ code: 'E_DICOM_PIXEL_TYPE' });
  });
});
