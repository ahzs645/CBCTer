import { createAppId } from "./ids";
import type {
  MaskWorkflowState,
  ScanStudy,
  StudyImageLayer,
  StudyMeasurement,
  StudyMask,
  StudySurface,
  StudyState,
} from "./types";

export const DEFAULT_MASK_WORKFLOW: MaskWorkflowState = {
  brushShape: "circle",
  brushSizeMm: 2,
  operation: "draw",
  thresholdRange: [300, 3000],
  watershedSeedKind: "foreground",
  watershedSeeds: [],
  canUndo: false,
  canRedo: false,
};

export function createEmptyStudyState(study: ScanStudy | null = null): StudyState {
  return {
    study,
    images: [],
    masks: [],
    surfaces: [],
    measurements: [],
    annotations: [],
    activeTool: "crosshair",
    maskWorkflow: { ...DEFAULT_MASK_WORKFLOW },
  };
}

export function createStudyImageLayer(
  studyId: string,
  input: Omit<StudyImageLayer, "id" | "studyId" | "visible" | "opacity"> &
    Partial<Pick<StudyImageLayer, "visible" | "opacity">>,
): StudyImageLayer {
  return {
    id: createAppId("image"),
    studyId,
    visible: true,
    opacity: 1,
    ...input,
  };
}

export function createStudyMask(
  studyId: string,
  imageId: string,
  input: Pick<StudyMask, "name" | "color"> &
    Partial<
      Pick<StudyMask, "opacity" | "visible" | "thresholdRange" | "voxelCount">
    >,
): StudyMask {
  const now = Date.now();
  return {
    id: createAppId("mask"),
    studyId,
    imageId,
    opacity: 0.45,
    visible: true,
    edited: false,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

export function createStudySurface(
  studyId: string,
  input: Pick<StudySurface, "name" | "color"> &
    Partial<
      Pick<
        StudySurface,
        | "maskId"
        | "opacity"
        | "visible"
        | "areaMm2"
        | "volumeMm3"
        | "vertexCount"
        | "triangleCount"
      >
    >,
): StudySurface {
  const now = Date.now();
  return {
    id: createAppId("surface"),
    studyId,
    opacity: 1,
    visible: true,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

export function createStudyMeasurement(
  studyId: string,
  input: Pick<StudyMeasurement, "kind" | "name" | "points" | "value" | "unit"> &
    Partial<Pick<StudyMeasurement, "visible">>,
): StudyMeasurement {
  const now = Date.now();
  return {
    id: createAppId("measurement"),
    studyId,
    visible: true,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}
