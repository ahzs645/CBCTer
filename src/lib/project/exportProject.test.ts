import { describe, expect, it } from 'vitest';
import { createEmptyStudyState } from '../../domain/studyState';
import type { ScanStudy, StudyState } from '../../domain/types';
import {
  buildProjectArchive,
  parseProjectManifest,
  PROJECT_ARCHIVE_MANIFEST,
  PROJECT_ARCHIVE_VERSION,
  readProjectArchive,
} from './exportProject';

const study: ScanStudy = {
  id: 'study-1',
  name: 'Patient: Demo/CBCT',
  source: 'local-folder',
  fileCount: 2,
  totalBytes: 10,
  status: 'indexed',
  createdAt: 1,
  updatedAt: 2,
};

const state: StudyState = createEmptyStudyState(study);

describe('project archive export', () => {
  it('writes a versioned manifest with safe, deduplicated embedded paths', async () => {
    const archive = await buildProjectArchive({
      state,
      masks: [
        { id: 'Mask: left/right*?', data: new Uint8Array([1, 2]) },
        { id: 'Mask left right', data: new Uint8Array([3]) },
      ],
      surfaces: [{ id: 'Surface A', data: new Uint8Array([4, 5, 6]) }],
    });

    const { unzipSync } = await import('fflate');
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    const manifest = parseProjectManifest(
      new TextDecoder().decode(files[PROJECT_ARCHIVE_MANIFEST]),
    );

    expect(manifest.version).toBe(PROJECT_ARCHIVE_VERSION);
    expect(manifest.app).toBe('CBCTer');
    expect(manifest.labelmaps).toEqual([]);
    expect(manifest.masks.map((entry) => entry.path)).toEqual([
      'masks/Mask_left_right.bin',
      'masks/Mask_left_right_2.bin',
    ]);
    expect(Object.keys(files).sort()).toEqual([
      'masks/Mask_left_right.bin',
      'masks/Mask_left_right_2.bin',
      'study.json',
      'surfaces/Surface_A.stl',
    ]);
  });

  it('round-trips embedded masks and surfaces', async () => {
    const blob = await buildProjectArchive({
      state,
      masks: [{ id: 'mask-1', data: new Uint8Array([1, 2, 3]) }],
      surfaces: [{ id: 'surface-1', data: new Uint8Array([4]) }],
    });
    const file = new File([blob], 'demo.cbcter.zip');

    const archive = await readProjectArchive(file);

    expect(archive.manifest.state.study?.name).toBe('Patient: Demo/CBCT');
    expect([...archive.masks[0].data]).toEqual([1, 2, 3]);
    expect([...archive.surfaces[0].data]).toEqual([4]);
  });

  it('round-trips embedded labelmaps', async () => {
    const blob = await buildProjectArchive({
      state,
      masks: [],
      labelmaps: [{ id: 'labels:primary', data: new Uint8Array([1, 0, 2, 0]) }],
      surfaces: [],
    });
    const file = new File([blob], 'demo.cbcter.zip');

    const archive = await readProjectArchive(file);

    expect(archive.manifest.labelmaps[0].path).toBe(
      'labelmaps/labels_primary.uint16.raw',
    );
    expect([...archive.labelmaps[0].data]).toEqual([1, 0, 2, 0]);
  });

  it('migrates version 1 manifests into the current archive shape', () => {
    const manifest = parseProjectManifest(
      JSON.stringify({
        version: 1,
        exportedAt: '2026-01-01T00:00:00.000Z',
        state,
        masks: [{ id: 'mask', path: 'masks/mask.bin', bytes: 1 }],
        surfaces: [{ id: 'surface', path: 'surfaces/surface.stl', bytes: 2 }],
      }),
    );

    expect(manifest.version).toBe(PROJECT_ARCHIVE_VERSION);
    expect(manifest.app).toBe('CBCTer');
    expect(manifest.labelmaps).toEqual([]);
    expect(manifest.dataSources).toEqual([
      {
        id: 'mask',
        kind: 'embedded',
        role: 'mask',
        path: 'masks/mask.bin',
        bytes: 1,
      },
      {
        id: 'surface',
        kind: 'embedded',
        role: 'surface',
        path: 'surfaces/surface.stl',
        bytes: 2,
      },
    ]);
  });

  it('rejects unsupported or unsafe manifests', () => {
    expect(() =>
      parseProjectManifest(
        JSON.stringify({
          version: 99,
          app: 'CBCTer',
          state,
          masks: [],
          surfaces: [],
          dataSources: [],
        }),
      ),
    ).toThrow('Unsupported project package version');

    expect(() =>
      parseProjectManifest(
        JSON.stringify({
          version: PROJECT_ARCHIVE_VERSION,
          app: 'CBCTer',
          state,
          masks: [{ id: 'mask', path: 'masks/../mask.bin', bytes: 1 }],
          surfaces: [],
          dataSources: [],
        }),
      ),
    ).toThrow('unsafe path');
  });
});
