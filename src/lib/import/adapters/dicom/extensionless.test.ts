import { describe, expect, it } from 'vitest';
import { ScanFolderSourceKind, type ScanFolderSource } from '../../../../types';
import { dicomFormatAdapter } from './adapter';
import { exposeExtensionlessDicomEntries } from './reader';

function dicomBytes(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(200);
  bytes.set([0x44, 0x49, 0x43, 0x4d], 128); // "DICM" after the 128-byte preamble
  return bytes;
}

function entry(relativePath: string, bytes: Uint8Array<ArrayBuffer>) {
  const name = relativePath.split('/').pop() ?? relativePath;
  return { name, relativePath, file: new File([bytes], name) };
}

describe('exposeExtensionlessDicomEntries', () => {
  // Sidexis-style DICOMDIR disc export: DICOM/DICOMRM/<date>/<study>/CT3/000, 001, ...
  const source: ScanFolderSource = {
    kind: ScanFolderSourceKind.FileList,
    label: 'CT3',
    entries: [
      entry('DICOM/DICOMDIR', dicomBytes()),
      entry('DICOM/CT3/000', dicomBytes()),
      entry('DICOM/CT3/001', dicomBytes()),
      entry('DICOM/Preview.jpg', new Uint8Array(200)),
      entry('DICOM/notes', new Uint8Array(200)),
    ],
  };

  it('exposes extensionless DICM files as .dcm so the DICOM adapter matches', async () => {
    expect(dicomFormatAdapter.matches(source)).toBe(false);
    const exposed = await exposeExtensionlessDicomEntries(source);
    expect(exposed.entries.map((item) => item.relativePath)).toEqual([
      'DICOM/DICOMDIR',
      'DICOM/CT3/000.dcm',
      'DICOM/CT3/001.dcm',
      'DICOM/Preview.jpg',
      'DICOM/notes',
    ]);
    expect(dicomFormatAdapter.matches(exposed)).toBe(true);
    // Same underlying File objects (no copies of large slice data).
    expect(exposed.entries[1].file).toBe(source.entries[1].file);
  });

  it('returns the source unchanged when nothing new is found', async () => {
    const plain: ScanFolderSource = { ...source, entries: [source.entries[3]] };
    await expect(exposeExtensionlessDicomEntries(plain)).resolves.toBe(plain);
  });
});
