import type { ScanBinding } from '../lib/case/types';
import Dexie, { type Table } from 'dexie';
import type { ScanStudy, StudyState, ViewerPreset } from '../domain/types';

export interface LocalProjectRecord {
  id: string;
  name: string;
  state: StudyState;
  binding?: ScanBinding;
  labelmaps?: Array<{ id: string; data: Uint8Array }>;
  predictions?: Array<{ id: string; data: Uint8Array }>;
  masks: Array<{ id: string; data: Uint8Array }>;
  surfaces: Array<{ id: string; data: Uint8Array }>;
  createdAt: number;
  updatedAt: number;
}

/** Edits to a streamed case, kept on this device (see lib/case/caseEdits). */
export interface CaseEditsRecord {
  key: string;
  updatedAt: number;
  edits: unknown;
}

export class CBCTerDexie extends Dexie {
  studies!: Table<ScanStudy, string>;
  presets!: Table<ViewerPreset, string>;
  projects!: Table<LocalProjectRecord, string>;
  caseEdits!: Table<CaseEditsRecord, string>;

  constructor() {
    super('cbcter-local');

    this.version(1).stores({
      studies:
        'id, source, status, updatedAt, deletedAt, studyInstanceUid, seriesInstanceUid',
      presets: 'id, studyId, updatedAt, deletedAt',
    });
    this.version(2).stores({
      studies:
        'id, source, status, updatedAt, deletedAt, studyInstanceUid, seriesInstanceUid',
      presets: 'id, studyId, updatedAt, deletedAt',
      projects: 'id, updatedAt',
    });
    this.version(3).stores({
      studies:
        'id, source, status, updatedAt, deletedAt, studyInstanceUid, seriesInstanceUid',
      presets: 'id, studyId, updatedAt, deletedAt',
      projects: 'id, updatedAt',
      caseEdits: 'key, updatedAt',
    });
  }
}

export const db = new CBCTerDexie();
