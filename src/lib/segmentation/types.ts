export type SegmentationItem = {
  label: number;
  name: string;
  preview: string;
  stl: string;
  assignedVoxels: number;
  centroidZYX: [number, number, number];
  bboxZYX: [number, number, number, number, number, number];
  extentZYX: [number, number, number];
  qualityStatus?: 'accepted' | 'review';
  qualityReasons?: string[];
  qualityScore?: number;
  /** FDI (ISO 3950) tooth number 11–48, when arch numbering has been assigned. */
  fdi?: number;
  /** Human-readable FDI name, e.g. "Upper Left Central Incisor". */
  fdiName?: string;
  /** FDI quadrant 1–4. */
  quadrant?: number;
};

export type SegmentationManifest = {
  source: string;
  preview: string;
  contactSheet: string;
  labels: string;
  acceptedInstances: number;
  candidateCount: number;
  positiveVoxels: number;
  qualityAccepted?: number;
  qualityReview?: number;
  /** Voxel spacing in mm [x, y, z] for the volume these labels came from. */
  spacing?: [number, number, number];
  items: SegmentationItem[];
};

/** Tooth volume in mm³ from voxel count and spacing (mm per voxel). */
export function toothVolumeMm3(
  assignedVoxels: number,
  spacing: [number, number, number],
): number {
  return assignedVoxels * spacing[0] * spacing[1] * spacing[2];
}

/** Format a mm³ volume as cm³ (or mm³ when small) for display. */
export function formatVolume(mm3: number): string {
  if (mm3 >= 1000) return `${(mm3 / 1000).toFixed(2)} cm³`;
  return `${Math.round(mm3)} mm³`;
}

export type SegmentationAlgorithm = 'curated' | 'hybrid' | 'model' | 'watershed';
export type ReviewOverride = 'accepted' | 'review' | 'rejected';

export const SEGMENTATION_ALGORITHMS: {
  id: SegmentationAlgorithm;
  label: string;
}[] = [
  { id: 'curated', label: 'Curated' },
  { id: 'hybrid', label: 'Hybrid' },
  { id: 'model', label: 'ROI model' },
  { id: 'watershed', label: 'Watershed' },
];

export const SEGMENTATION_ASSET_ROOTS: Record<SegmentationAlgorithm, string> = {
  curated: '/sample-segmentation-curated/',
  hybrid: '/sample-segmentation-hybrid/',
  model: '/sample-segmentation/',
  watershed: '/sample-segmentation-watershed/',
};
