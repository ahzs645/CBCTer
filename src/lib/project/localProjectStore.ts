import type { ScanBinding } from '../case/types';
import { db, type LocalProjectRecord } from '../../local-dexie/db';
import { PROJECT_ARCHIVE_VERSION, type ProjectArchive } from './exportProject';
import type { StudyState } from '../../domain/types';
import { normalizeStudyState } from '../../domain/studyState';
import { sanitizePathSegment } from '../import/fileTypes';

export interface LocalProjectInput {
  state: StudyState;
  binding?: ScanBinding;
  labelmaps?: Array<{ id: string; data: Uint8Array }>;
  predictions?: Array<{ id: string; data: Uint8Array }>;
  masks: Array<{ id: string; data: Uint8Array }>;
  surfaces: Array<{ id: string; data: Uint8Array }>;
}

const LOCAL_PROJECT_ID = 'latest';

export async function saveLatestProject({
  state,
  masks,
  surfaces,
  labelmaps = [],
  predictions = [],
  binding,
}: LocalProjectInput): Promise<void> {
  const now = Date.now();
  const existing = await db.projects.get(LOCAL_PROJECT_ID);
  const record: LocalProjectRecord = {
    id: LOCAL_PROJECT_ID,
    name: state.study?.name ?? 'CBCTer project',
    state,
    masks,
    surfaces,
    labelmaps,
    predictions,
    binding,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.projects.put(record);
}

export async function loadLatestProject(): Promise<ProjectArchive | null> {
  const record = await db.projects.get(LOCAL_PROJECT_ID);
  if (!record) return null;
  return {
    manifest: {
      version: PROJECT_ARCHIVE_VERSION,
      app: 'CBCTer',
      binding: record.binding,
      exportedAt: new Date(record.updatedAt).toISOString(),
      predictions: (record.predictions ?? []).map((p) => ({
        id: p.id,
        path: `predictions/${sanitizePathSegment(p.id)}.uint16.raw`,
        bytes: p.data.length,
      })),
      dataSources: [
        ...(record.labelmaps ?? []).map((p) => ({
          id: p.id,
          kind: 'embedded' as const,
          role: 'labelmap' as const,
          path: `labelmaps/${sanitizePathSegment(p.id)}.uint16.raw`,
          bytes: p.data.length,
        })),
        ...(record.predictions ?? []).map((p) => ({
          id: p.id,
          kind: 'embedded' as const,
          role: 'prediction' as const,
          path: `predictions/${sanitizePathSegment(p.id)}.uint16.raw`,
          bytes: p.data.length,
        })),
        ...record.masks.map((mask) => ({
          id: mask.id,
          kind: 'embedded' as const,
          role: 'mask' as const,
          path: `masks/${sanitizePathSegment(mask.id)}.bin`,
          bytes: mask.data.byteLength,
        })),
        ...record.surfaces.map((surface) => ({
          id: surface.id,
          kind: 'embedded' as const,
          role: 'surface' as const,
          path: `surfaces/${sanitizePathSegment(surface.id)}.stl`,
          bytes: surface.data.byteLength,
        })),
      ],
      state: normalizeStudyState(record.state),
      masks: record.masks.map((mask) => ({
        id: mask.id,
        path: `masks/${sanitizePathSegment(mask.id)}.bin`,
        bytes: mask.data.byteLength,
      })),
      labelmaps: (record.labelmaps ?? []).map((labelmap) => ({
        id: labelmap.id,
        path: `labelmaps/${sanitizePathSegment(labelmap.id)}.uint16.raw`,
        bytes: labelmap.data.byteLength,
      })),
      surfaces: record.surfaces.map((surface) => ({
        id: surface.id,
        path: `surfaces/${sanitizePathSegment(surface.id)}.stl`,
        bytes: surface.data.byteLength,
      })),
    },
    predictions: record.predictions ?? [],
    masks: record.masks,
    labelmaps: record.labelmaps ?? [],
    surfaces: record.surfaces,
  };
}
