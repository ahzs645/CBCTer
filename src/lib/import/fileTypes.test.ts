import { describe, expect, it } from 'vitest';
import { ScanFolderSourceKind, type ScanFolderSource } from '../../types';
import { expandArchiveEntries } from './archive';
import {
  getExtension,
  inferMimeType,
  normalizeArchivePath,
  sanitizeFileStem,
} from './fileTypes';

describe('import file type helpers', () => {
  it('normalizes archive paths without allowing parent traversal', () => {
    expect(normalizeArchivePath('scan\\nested/../slice.dcm')).toBe(
      'scan/nested/slice.dcm',
    );
  });

  it('recognizes compound extensions and image MIME types', () => {
    expect(getExtension('volume.nii.gz')).toBe('.nii.gz');
    expect(inferMimeType('mask.seg.nrrd')).toBe('application/vnd.nrrd');
    expect(inferMimeType('project.cbcter.zip')).toBe(
      'application/vnd.cbcter.project+zip',
    );
  });

  it('sanitizes file stems while preserving readable words', () => {
    expect(sanitizeFileStem('Liver: left/right*?')).toBe('Liver left right');
    expect(sanitizeFileStem('')).toBe('unnamed');
  });

  it('expands zip entries into virtual scan-folder entries', async () => {
    const { zipSync } = await import('fflate');
    const source: ScanFolderSource = {
      kind: ScanFolderSourceKind.FileList,
      label: 'upload',
      entries: [
        {
          name: 'scan.zip',
          relativePath: 'scan.zip',
          file: new File(
            [
              zipSync({
                'series/a.dcm': new Uint8Array([1, 2, 3]),
                'volume.nii.gz': new Uint8Array([4, 5, 6]),
              }),
            ],
            'scan.zip',
            { type: 'application/zip' },
          ),
        },
      ],
    };

    const expanded = await expandArchiveEntries(source);

    expect(expanded.entries.map((entry) => entry.relativePath).sort()).toEqual([
      'scan/series/a.dcm',
      'scan/volume.nii.gz',
    ]);
    expect(expanded.entries.find((entry) => entry.name === 'volume.nii.gz')?.file.type).toBe(
      'application/vnd.nifti',
    );
  });
});
