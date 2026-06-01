export type FileMap = Map<string, File>;
export type Vec3 = [number, number, number];
export type ReadonlyVec3 = readonly [number, number, number];
export type AxisIndex = 0 | 1 | 2;
export type AxisSign = -1 | 1;

/** Anatomical directions expressed as unit vectors in the volume's voxel frame. */
export interface PatientAxes {
  /** Toward patient LEFT. */
  left: Vec3;
  /** ANTERIOR (toward the face / incisors). */
  anterior: Vec3;
  /** SUPERIOR (toward the top of the head). */
  superior: Vec3;
}

/**
 * The importer canonicalizes DICOM volumes to an LPS-aligned voxel frame
 * (+x = Left, +y = Posterior, +z = Superior), so patient-anterior is −y.
 */
export const LPS_CANONICAL_PATIENT_AXES: PatientAxes = {
  left: [1, 0, 0],
  anterior: [0, -1, 0],
  superior: [0, 0, 1],
};

export interface RangeBounds {
  min: number;
  max: number;
}

export enum ScanFolderSourceKind {
  DirectoryHandle = 'directory-handle',
  FileList = 'file-list',
}

export interface ScanFolderEntry {
  name: string;
  relativePath: string;
  file: File;
}

export interface ScanFolderSource {
  kind: ScanFolderSourceKind;
  label: string;
  entries: ScanFolderEntry[];
}

export interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}

export type ScanFormat = 'dicom' | 'galileos' | 'onevolume';

export enum ImportStage {
  Idle = 'idle',
  Scanning = 'scanning',
  ParsingMeta = 'parsing-meta',
  InflatingSlices = 'inflating-slices',
  Assembling = 'assembling',
  Preparing3D = 'preparing-3d',
  Ready = 'ready',
  Error = 'error',
}

export interface ParsedVolumeMeta {
  format: ScanFormat;
  formatLabel: string;
  scanId: string;
  dimensions: Vec3;
  sourceDimensions?: Vec3;
  sourceOffset?: Vec3;
  spacing: Vec3;
  scalarRange: [number, number];
  initialWindowLevel: SliceWindowLevel;
  nativeValueScale?: {
    slope: number;
    intercept: number;
  };
  sliceCount: number;
  bytesPerVoxel: number;
  headerFileName: string;
  slicePrefix: string;
  sliceFiles: string[];
  nativeAxis?: VolumeAxis;
  seriesChoices?: VolumeSeriesChoice[];
  dicomSourceAxisMap?: DicomSourceAxisMap;
  /** Anatomical axes in voxel space, when the importer could resolve orientation. */
  patientAxes?: PatientAxes;
}

export interface LoadedVolume {
  meta: ParsedVolumeMeta;
  voxels: Int16Array;
  histogram: Uint32Array;
}

export interface VolumeSeriesChoice {
  id: string;
  label: string;
  detail: string;
  dimensions: Vec3;
  spacing: Vec3;
  selected: boolean;
  nativeAxis?: VolumeAxis;
}

export interface DicomSourceAxisMap {
  sourceDimensions: Vec3;
  sourceToVolumeAxes: [AxisIndex, AxisIndex, AxisIndex];
  sourceToVolumeSigns: [AxisSign, AxisSign, AxisSign];
}

export interface ImportIssue {
  code: string;
  message: string;
}

export interface ImportProgress {
  stage: ImportStage;
  detailKey: string;
  detailValues?: Record<string, string | number>;
  completed: number;
  total: number;
}

export enum VolumeAxis {
  Axial = 'axial',
  Coronal = 'coronal',
  Sagittal = 'sagittal',
}

export interface VolumeCursor {
  x: number;
  y: number;
  z: number;
}

export interface SliceWindowLevel {
  window: number;
  level: number;
}

export interface SliceImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  displayAspect?: number;
  pixelated?: boolean;
}

export interface ViewerSlices {
  axial: SliceImage | null;
  coronal: SliceImage | null;
  sagittal: SliceImage | null;
}

export interface PreparedVolumeFor3D {
  dimensions: Vec3;
  sourceDimensions: Vec3;
  origin: Vec3;
  spacing: Vec3;
  voxels: Uint8Array;
  scalarRange: [number, number];
  downsampled: boolean;
  cropped: boolean;
  threshold: number;
}
