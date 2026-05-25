import Dexie, { type Table } from "dexie";
import type { ScanStudy, ViewerPreset } from "../domain/types";

export class CBCTerDexie extends Dexie {
  studies!: Table<ScanStudy, string>;
  presets!: Table<ViewerPreset, string>;

  constructor() {
    super("cbcter-local");

    this.version(1).stores({
      studies:
        "id, source, status, updatedAt, deletedAt, studyInstanceUid, seriesInstanceUid",
      presets: "id, studyId, updatedAt, deletedAt",
    });
  }
}

export const db = new CBCTerDexie();
