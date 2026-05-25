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
  items: SegmentationItem[];
};

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
