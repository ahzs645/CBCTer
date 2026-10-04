import type { StudyState } from '../../domain/types';
import type { Vec3, VolumeAxis } from '../../types';
import type { NativeVoxelMetadata } from '../volume/native';
import type { ChunkInfo } from '../import/chunked/manifest';
import type { ProjectExportInput } from '../project/exportProject';
import type { ArchCurve, PanoramicOptions } from '../panoramic/types';
export type Affine = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export interface ScanBinding {
  sha256: string;
  geometrySha256: string;
  geometry: Pick<
    NativeVoxelMetadata,
    'dimensions' | 'spacing' | 'origin' | 'direction' | 'coordinateSystem'
  >;
  displaySha256: string;
  displayDimensions: Vec3;
  displaySpacing: Vec3;
  displayToNative: Affine;
}
export interface AnalysisModel {
  id: string;
  name: string;
  version: string | null;
  weightsSha256: string | null;
  preprocessing: Record<string, string | number | number[]>;
  createdAt: number;
}
export interface ToothInstance {
  id: string;
  groupId: string;
  value: number;
  fdi: number | null;
  review: 'unreviewed' | 'accepted' | 'rejected' | 'corrected';
  centroid: Vec3;
  bounds: { min: Vec3; max: Vec3 };
  voxelCount: number;
  source: 'model' | 'manual' | 'separation';
  parentIds?: string[];
  confidence?: number;
}
export interface AnalysisRevision {
  id: string;
  at: number;
  action: string;
  instanceIds: string[];
  modelId?: string;
}
export interface AnalysisLayerMeta {
  id: string;
  role: 'anatomy' | 'teeth' | 'mask' | 'prediction' | 'labels';
  modelId?: string;
  predictionId?: string;
}
export interface CaseView {cursor:Vec3;axis:VolumeAxis;zoom:number;windowLevel:{window:number;level:number};invert:boolean}
export interface DentalArchState {
  curve: ArchCurve;
  options: PanoramicOptions;
  crossSection: { widthMm: number; angleDeg: number };
}
export interface CaseWorkspace extends ProjectExportInput {
  binding?: ScanBinding;
  predictions?: Array<{ id: string; data: Uint8Array }>;
}
export interface CaseLayer extends AnalysisLayerMeta {
  byteOrder:'little-endian';
  layout:'x-fastest';
  hashKind: 'ordered-chunk-sha256';
  dtype: 'uint16';
  dimensions: Vec3;
  sha256: string;
  chunks: ChunkInfo[];
}
export interface AnalysisManifest {
  format: 'cbcter-analysis';
  version: 1;
  scanSha256: string;
  geometrySha256: string;
  studyFile: 'study.json';
  studySha256: string;
  sourceGrid: { dimensions: Vec3; spacing: Vec3; toNative: Affine };
  layers: CaseLayer[];
  surfaces: Array<{ id: string; file: string; bytes: number; sha256: string }>;
}
export interface CaseMetadata {
  manifest: AnalysisManifest;
  state: StudyState;
}
