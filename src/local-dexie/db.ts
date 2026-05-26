import Dexie, { type Table } from "dexie";
import type { ScanStudy, StudyState, ViewerPreset } from "../domain/types";

export interface LocalProjectRecord {
  id: string;
  name: string;
  state: StudyState;
  masks: Array<{ id: string; data: Uint8Array }>;
  surfaces: Array<{ id: string; data: Uint8Array }>;
  createdAt: number;
  updatedAt: number;
}

export class CBCTerDexie extends Dexie {
  studies!: Table<ScanStudy, string>;
  presets!: Table<ViewerPreset, string>;
  projects!: Table<LocalProjectRecord, string>;

  constructor() {
    super("cbcter-local");

    this.version(1).stores({
      studies:
        "id, source, status, updatedAt, deletedAt, studyInstanceUid, seriesInstanceUid",
      presets: "id, studyId, updatedAt, deletedAt",
    });
    this.version(2).stores({
      studies:
        "id, source, status, updatedAt, deletedAt, studyInstanceUid, seriesInstanceUid",
      presets: "id, studyId, updatedAt, deletedAt",
      projects: "id, updatedAt",
    });
  }
}

export const db = new CBCTerDexie();
