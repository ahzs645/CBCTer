import { describe, expect, it } from 'vitest';
import { ScanFolderSourceKind, type ScanFolderSource } from '../../../../types';
import { parseDicomFolder } from './parser';

describe('parseDicomFolder', () => {
  it('keeps ITK/GDCM behind an explicit unavailable engine path', async () => {
    const source: ScanFolderSource = {
      kind: ScanFolderSourceKind.FileList,
      label: 'empty',
      entries: [],
    };

    await expect(
      parseDicomFolder(source, { dicomEngine: 'itk-gdcm' }),
    ).rejects.toMatchObject({
      code: 'E_DICOM_ENGINE_UNAVAILABLE',
    });
  });
});
