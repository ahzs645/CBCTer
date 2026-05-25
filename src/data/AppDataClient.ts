import type { AppId } from "../domain/ids";
import type {
  CreatePresetInput,
  CreateStudyInput,
  ScanStudy,
  UpdateStudyInput,
  ViewerPreset,
} from "../domain/types";

export interface AppDataClient {
  studies: {
    list(): Promise<ScanStudy[]>;
    get(id: AppId): Promise<ScanStudy | null>;
    create(input: CreateStudyInput): Promise<ScanStudy>;
    update(id: AppId, patch: UpdateStudyInput): Promise<ScanStudy>;
    delete(id: AppId): Promise<void>;
  };
  presets: {
    listByStudy(studyId: AppId): Promise<ViewerPreset[]>;
    create(input: CreatePresetInput): Promise<ViewerPreset>;
    delete(id: AppId): Promise<void>;
  };
}
