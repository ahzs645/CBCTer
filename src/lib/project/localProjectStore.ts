import { db, type LocalProjectRecord } from '../../local-dexie/db';
import {
  PROJECT_ARCHIVE_VERSION,
  type ProjectArchive,
} from './exportProject';
import type { StudyState } from '../../domain/types';
import { sanitizePathSegment } from '../import/fileTypes';

export interface LocalProjectInput {
  state: StudyState;
  masks: Array<{ id: string; data: Uint8Array }>;
  surfaces: Array<{ id: string; data: Uint8Array }>;
}

const LOCAL_PROJECT_ID = 'latest';

export async function saveLatestProject({
  state,
  masks,
  surfaces,
}: LocalProjectInput): Promise<void> {
  const now = Date.now();
  const existing = await db.projects.get(LOCAL_PROJECT_ID);
  const record: LocalProjectRecord = {
    id: LOCAL_PROJECT_ID,
    name: state.study?.name ?? 'CBCTer project',
    state,
    masks,
    surfaces,
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
      exportedAt: new Date(record.updatedAt).toISOString(),
      dataSources: [
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
      state: record.state,
      masks: record.masks.map((mask) => ({
        id: mask.id,
        path: `masks/${sanitizePathSegment(mask.id)}.bin`,
        bytes: mask.data.byteLength,
      })),
      surfaces: record.surfaces.map((surface) => ({
        id: surface.id,
        path: `surfaces/${sanitizePathSegment(surface.id)}.stl`,
        bytes: surface.data.byteLength,
      })),
    },
    masks: record.masks,
    surfaces: record.surfaces,
  };
}
