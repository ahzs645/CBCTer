import { createAppId } from "./ids";
import type {
  CropBounds,
  DicomImportEngine,
  MaskWorkflowState,
  ScanStudy,
  StudyAnnotation,
  StudyImageLayer,
  StudyMeasurement,
  StudyMask,
  StudySegment,
  StudySegmentGroup,
  StudySurface,
  StudyState,
  ViewerLayoutPreset,
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
    segmentGroups: [],
    surfaces: [],
    measurements: [],
    annotations: [],
    activeTool: "crosshair",
    dicomImportEngine: "custom",
    layoutPreset: "mpr-3d",
    maskWorkflow: { ...DEFAULT_MASK_WORKFLOW },
  };
}

function normalizeAnnotation(
  annotation: Partial<StudyAnnotation>,
): StudyAnnotation | null {
  if (!annotation.id || !annotation.studyId || !annotation.name || !annotation.point) {
    return null;
  }
  const now = Date.now();
  return {
    id: annotation.id,
    studyId: annotation.studyId,
    kind: annotation.kind ?? "point",
    name: annotation.name,
    point: annotation.point,
    text: annotation.text ?? annotation.name,
    measurementId: annotation.measurementId,
    color: annotation.color ?? "#38bdf8",
    visible: annotation.visible ?? true,
    selected: annotation.selected ?? false,
    createdAt: annotation.createdAt ?? now,
    updatedAt: annotation.updatedAt ?? now,
  };
}

export function normalizeStudyState(input: Partial<StudyState>): StudyState {
  const base = createEmptyStudyState(input.study ?? null);
  return {
    ...base,
    ...input,
    images: input.images ?? [],
    masks: input.masks ?? [],
    segmentGroups: input.segmentGroups ?? [],
    surfaces: input.surfaces ?? [],
    measurements: input.measurements ?? [],
    annotations: (input.annotations ?? [])
      .map((annotation) => normalizeAnnotation(annotation))
      .filter((annotation): annotation is StudyAnnotation => annotation != null),
    dicomImportEngine:
      input.dicomImportEngine === "itk-gdcm" ? "itk-gdcm" : "custom",
    layoutPreset: input.layoutPreset ?? "mpr-3d",
    maskWorkflow: {
      ...DEFAULT_MASK_WORKFLOW,
      ...(input.maskWorkflow ?? {}),
    },
  };
}

export function createFullCropBounds(
  dimensions: [number, number, number],
  enabled = false,
): CropBounds {
  return {
    min: [0, 0, 0],
    max: [
      Math.max(0, dimensions[0] - 1),
      Math.max(0, dimensions[1] - 1),
      Math.max(0, dimensions[2] - 1),
    ],
    enabled,
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

export function createStudySegment(
  input: Pick<StudySegment, "value" | "name" | "color"> &
    Partial<
      Pick<
        StudySegment,
        "opacity" | "visible" | "locked" | "maskId" | "voxelCount"
      >
    >,
): StudySegment {
  const now = Date.now();
  return {
    id: createAppId("segment"),
    opacity: 1,
    visible: true,
    locked: false,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

export function createStudySegmentGroup(
  studyId: string,
  imageId: string,
  input: Pick<StudySegmentGroup, "name"> &
    Partial<Pick<StudySegmentGroup, "visible" | "opacity" | "segments">>,
): StudySegmentGroup {
  const now = Date.now();
  const segments = input.segments ?? [];
  return {
    id: createAppId("segment-group"),
    studyId,
    imageId,
    visible: true,
    opacity: 0.6,
    activeSegmentValue: segments[0]?.value,
    createdAt: now,
    updatedAt: now,
    ...input,
    segments,
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

export function createStudyAnnotation(
  studyId: string,
  input: Pick<StudyAnnotation, "name" | "point" | "text"> &
    Partial<
      Pick<
        StudyAnnotation,
        "kind" | "measurementId" | "color" | "visible" | "selected"
      >
    >,
): StudyAnnotation {
  const now = Date.now();
  return {
    id: createAppId("annotation"),
    studyId,
    kind: "point",
    color: "#38bdf8",
    visible: true,
    selected: false,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

export function isDicomImportEngine(value: string): value is DicomImportEngine {
  return value === "custom" || value === "itk-gdcm";
}

export function isViewerLayoutPreset(value: string): value is ViewerLayoutPreset {
  return value === "mpr-3d" || value === "mpr-only" || value === "single";
}
