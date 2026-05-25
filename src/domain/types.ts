import type { AppId } from "./ids";

export type StorageMode = "local" | "convex";

export type ScanImportStatus = "queued" | "indexed" | "failed";

export type ScanStudy = {
  id: AppId;
  name: string;
  source: "local-folder" | "local-files" | "sample" | "cloud";
  fileCount: number;
  totalBytes: number;
  modality?: string;
  manufacturer?: string;
  seriesInstanceUid?: string;
  studyInstanceUid?: string;
  status: ScanImportStatus;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type ViewerPreset = {
  id: AppId;
  studyId: AppId;
  name: string;
  windowCenter: number;
  windowWidth: number;
  opacity: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type CreateStudyInput = {
  name: string;
  source: ScanStudy["source"];
  fileCount: number;
  totalBytes: number;
  modality?: string;
  manufacturer?: string;
  seriesInstanceUid?: string;
  studyInstanceUid?: string;
};

export type UpdateStudyInput = Partial<
  Pick<
    ScanStudy,
    | "name"
    | "fileCount"
    | "totalBytes"
    | "modality"
    | "manufacturer"
    | "seriesInstanceUid"
    | "studyInstanceUid"
    | "status"
  >
>;

export type CreatePresetInput = {
  studyId: AppId;
  name: string;
  windowCenter: number;
  windowWidth: number;
  opacity: number;
};
