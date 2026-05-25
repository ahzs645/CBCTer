import { useLiveQuery } from "dexie-react-hooks";
import type { AppId } from "../domain/ids";
import type { ScanStudy } from "../domain/types";
import { db } from "../local-dexie/db";

export function useStudies() {
  return useLiveQuery(
    () =>
      db.studies
        .orderBy("updatedAt")
        .reverse()
        .filter((study) => !study.deletedAt)
        .toArray(),
    [],
    [] as ScanStudy[],
  );
}

export function usePresets(studyId: AppId | null) {
  return useLiveQuery(
    () => {
      if (!studyId) {
        return [];
      }

      return db.presets
        .where("studyId")
        .equals(studyId)
        .filter((preset) => !preset.deletedAt)
        .toArray();
    },
    [studyId],
    [],
  );
}
