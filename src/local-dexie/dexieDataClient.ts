import { createAppId, type AppId } from "../domain/ids";
import type {
  CreatePresetInput,
  CreateStudyInput,
  ScanStudy,
  UpdateStudyInput,
  ViewerPreset,
} from "../domain/types";
import { db } from "./db";

function now() {
  return Date.now();
}

export function createDexieDataClient() {
  return {
    studies: {
      async list() {
        return db.studies
          .orderBy("updatedAt")
          .reverse()
          .filter((study) => !study.deletedAt)
          .toArray();
      },
      async get(id: AppId) {
        const study = await db.studies.get(id);
        return study && !study.deletedAt ? study : null;
      },
      async create(input: CreateStudyInput) {
        const timestamp = now();
        const study: ScanStudy = {
          id: createAppId("study"),
          status: "indexed",
          createdAt: timestamp,
          updatedAt: timestamp,
          ...input,
        };

        await db.studies.add(study);
        return study;
      },
      async update(id: AppId, patch: UpdateStudyInput) {
        const existing = await db.studies.get(id);

        if (!existing || existing.deletedAt) {
          throw new Error("Study not found");
        }

        const next: ScanStudy = {
          ...existing,
          ...patch,
          updatedAt: now(),
        };

        await db.studies.put(next);
        return next;
      },
      async delete(id: AppId) {
        await db.studies.update(id, {
          deletedAt: now(),
          updatedAt: now(),
        });
      },
    },
    presets: {
      async listByStudy(studyId: AppId) {
        const presets = await db.presets
          .where("studyId")
          .equals(studyId)
          .toArray();

        return presets
          .filter((preset) => !preset.deletedAt)
          .sort((a, b) => b.updatedAt - a.updatedAt);
      },
      async create(input: CreatePresetInput) {
        const timestamp = now();
        const preset: ViewerPreset = {
          id: createAppId("preset"),
          createdAt: timestamp,
          updatedAt: timestamp,
          ...input,
        };

        await db.presets.add(preset);
        return preset;
      },
      async delete(id: AppId) {
        await db.presets.update(id, {
          deletedAt: now(),
          updatedAt: now(),
        });
      },
    },
  };
}
