import type { AppId } from "./ids";

export type StorageMode = "local" | "convex";
export type DicomImportEngine = "custom" | "itk-gdcm";
export type ViewerLayoutPreset = "mpr-3d" | "mpr-only" | "single";

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

export type StudyTool =
  | "pan"
  | "zoom"
  | "window-level"
  | "crosshair"
  | "measure-distance"
  | "measure-angle"
  | "measure-ellipse"
  | "measure-polygon"
  | "mask-brush"
  | "mask-erase"
  | "mask-threshold"
  | "mask-region-grow"
  | "mask-watershed-seed"
  | "surface-select";

export type MaskOperation = "draw" | "erase" | "threshold";
export type MaskBrushShape = "circle" | "square";
export type WatershedSeedKind = "foreground" | "background" | "erase";

export type StudyImageLayer = {
  id: AppId;
  studyId: AppId;
  name: string;
  source: ScanStudy["source"];
  dimensions: [number, number, number];
  spacing: [number, number, number];
  visible: boolean;
  opacity: number;
};

export type StudyMask = {
  id: AppId;
  studyId: AppId;
  imageId: AppId;
  name: string;
  color: string;
  opacity: number;
  visible: boolean;
  thresholdRange?: [number, number];
  edited: boolean;
  voxelCount?: number;
  createdAt: number;
  updatedAt: number;
};

export type StudySegment = {
  id: AppId;
  value: number;
  name: string;
  color: string;
  opacity: number;
  visible: boolean;
  locked: boolean;
  maskId?: AppId;
  voxelCount?: number;
  createdAt: number;
  updatedAt: number;
};

export type StudySegmentGroup = {
  id: AppId;
  studyId: AppId;
  imageId: AppId;
  name: string;
  visible: boolean;
  opacity: number;
  activeSegmentValue?: number;
  segments: StudySegment[];
  createdAt: number;
  updatedAt: number;
};

export type StudySurface = {
  id: AppId;
  studyId: AppId;
  maskId?: AppId;
  name: string;
  color: string;
  opacity: number;
  visible: boolean;
  areaMm2?: number;
  volumeMm3?: number;
  vertexCount?: number;
  triangleCount?: number;
  createdAt: number;
  updatedAt: number;
};

export type StudyMeasurementKind =
  | "distance"
  | "angle"
  | "ellipse"
  | "polygon"
  | "density";

export type StudyMeasurement = {
  id: AppId;
  studyId: AppId;
  kind: StudyMeasurementKind;
  name: string;
  points: [number, number, number][];
  value: number;
  unit: "mm" | "degrees" | "mm2" | "HU";
  visible: boolean;
  createdAt: number;
  updatedAt: number;
};

export type StudyAnnotation = {
  id: AppId;
  studyId: AppId;
  kind: "point" | "measurement";
  name: string;
  point: [number, number, number];
  text: string;
  measurementId?: AppId;
  color: string;
  visible: boolean;
  selected: boolean;
  createdAt: number;
  updatedAt: number;
};

export type CropBounds = {
  min: [number, number, number];
  max: [number, number, number];
  enabled: boolean;
};

export type MaskWorkflowState = {
  brushShape: MaskBrushShape;
  brushSizeMm: number;
  operation: MaskOperation;
  thresholdRange: [number, number];
  watershedSeedKind: WatershedSeedKind;
  watershedSeeds: Array<{
    id: AppId;
    kind: WatershedSeedKind;
    point: [number, number, number];
  }>;
  canUndo: boolean;
  canRedo: boolean;
};

export type StudyState = {
  study: ScanStudy | null;
  images: StudyImageLayer[];
  masks: StudyMask[];
  segmentGroups: StudySegmentGroup[];
  surfaces: StudySurface[];
  measurements: StudyMeasurement[];
  annotations: StudyAnnotation[];
  activeTool: StudyTool;
  activeImageId?: AppId;
  activeMaskId?: AppId;
  activeSegmentGroupId?: AppId;
  activeSurfaceId?: AppId;
  activeMeasurementId?: AppId;
  activeAnnotationId?: AppId;
  displayPreset?: ViewerPreset;
  dicomImportEngine: DicomImportEngine;
  cropBounds?: CropBounds;
  layoutPreset: ViewerLayoutPreset;
  maskWorkflow: MaskWorkflowState;
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
