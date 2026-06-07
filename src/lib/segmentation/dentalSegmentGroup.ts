/**
 * Turn a DentalSegmentator multi-class labelmap into the app's segment-group
 * domain model. Pure (except the id/timestamp helpers), so the per-class stats
 * are unit-testable and the segment group can be persisted by any caller.
 */
import { createStudySegment, createStudySegmentGroup } from '../../domain/studyState';
import type { StudySegment, StudySegmentGroup } from '../../domain/types';
import type { Vec3 } from '../../types';
import {
  DENTAL_SEGMENTATOR_LABELS,
  type DentalSegmentatorLabel,
} from './dentalSegmentator';
import {
  getDentalSegVariant,
  type DentalSegVariantId,
} from './dentalSegVariants';

export interface DentalClassStat {
  value: number;
  key: string;
  name: string;
  color: string;
  voxelCount: number;
  volumeMm3: number;
}

/**
 * Per-class voxel counts and physical volumes for a set of labels. Defaults to
 * the base DentalSegmentator labels; pass a variant's labels for pediatric /
 * universal. Classes absent from the labelmap are reported with a zero count.
 */
export function summarizeDentalLabels(
  labelmap: Uint16Array,
  spacing: Vec3,
  labels: DentalSegmentatorLabel[] = DENTAL_SEGMENTATOR_LABELS,
): DentalClassStat[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < labelmap.length; i += 1) {
    const value = labelmap[i];
    if (value !== 0) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const voxelMm3 = spacing[0] * spacing[1] * spacing[2];
  return labels.map((label) => {
    const voxelCount = counts.get(label.value) ?? 0;
    return { ...label, voxelCount, volumeMm3: voxelCount * voxelMm3 };
  });
}

/** Per-class stats for a named model variant. */
export function summarizeDentalVariant(
  labelmap: Uint16Array,
  spacing: Vec3,
  variantId: DentalSegVariantId,
): DentalClassStat[] {
  return summarizeDentalLabels(labelmap, spacing, getDentalSegVariant(variantId).labels);
}

export function buildDentalSegments(stats: DentalClassStat[]): StudySegment[] {
  return stats.map((stat) =>
    createStudySegment({
      value: stat.value,
      name: stat.name,
      color: stat.color,
      voxelCount: stat.voxelCount,
    }),
  );
}

/** Build a multi-label StudySegmentGroup from the per-class stats. */
export function buildDentalSegmentGroup(
  studyId: string,
  imageId: string,
  stats: DentalClassStat[],
  name = 'Full anatomy (DentalSegmentator)',
): StudySegmentGroup {
  return createStudySegmentGroup(studyId, imageId, {
    name,
    segments: buildDentalSegments(stats),
  });
}
