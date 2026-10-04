import type { LoadedVolume, SliceWindowLevel } from '../../types';

/**
 * Dental contrast presets (window/level) for the MPR slices.
 *
 * CBCT gray values are only loosely HU-calibrated and differ between
 * machines, field-of-view sizes and exports, so fixed HU windows look wrong
 * on many scans. Instead every preset is defined relative to the scan's own
 * intensity span: [low, high] = the 2nd and 99.9th percentiles of the
 * non-padding voxels. "Bone" keeps the bright part of that span, "Soft
 * tissue" the dark part, and so on, which behaves consistently across
 * vendors and value scales.
 */

export type DentalWindowPresetId =
  | 'scan'
  | 'auto'
  | 'bone'
  | 'teeth'
  | 'soft'
  | 'metal';

export interface DentalWindowPreset {
  id: DentalWindowPresetId;
  windowLevel: SliceWindowLevel;
}

/** Percentiles of the non-padding voxels that define the intensity span. */
export const DENTAL_SPAN_PERCENTILES: [number, number] = [2, 99.9];

/**
 * Each preset's display range as fractions of the span (0 = low, 1 = high).
 * Values outside 0–1 extend beyond the span (e.g. metal past the 99.9th).
 */
export const DENTAL_PRESET_FRACTIONS: Record<
  Exclude<DentalWindowPresetId, 'scan'>,
  [number, number]
> = {
  auto: [0, 1],
  bone: [0.2, 1],
  teeth: [0.42, 1],
  soft: [0, 0.55],
  metal: [0.65, 1.3],
};

export const DENTAL_PRESET_ORDER: DentalWindowPresetId[] = [
  'scan',
  'auto',
  'bone',
  'teeth',
  'soft',
  'metal',
];

const MAX_SAMPLES = 400_000;
/** A single value covering more than this share of samples is padding. */
const PADDING_SHARE = 0.03;

/**
 * Sorted sample of the volume's voxel values with constant padding (the area
 * outside a cylindrical CBCT field of view) removed.
 */
export function sampleVoxelValues(voxels: Int16Array): Int16Array {
  if (voxels.length === 0) return new Int16Array(0);
  const stride = Math.max(1, Math.floor(voxels.length / MAX_SAMPLES));
  const sample = new Int16Array(Math.ceil(voxels.length / stride));
  let count = 0;
  for (let index = 0; index < voxels.length; index += stride) {
    sample[count] = voxels[index];
    count += 1;
  }
  const sorted = sample.subarray(0, count).sort();
  const min = sorted[0];
  let minCount = 0;
  while (minCount < sorted.length && sorted[minCount] === min) minCount += 1;
  if (minCount / sorted.length > PADDING_SHARE && minCount < sorted.length) {
    return sorted.subarray(minCount);
  }
  return sorted;
}

export function percentileOfSorted(sorted: Int16Array, percent: number): number {
  if (sorted.length === 0) return 0;
  const clamped = Math.min(100, Math.max(0, percent));
  const index = Math.round((clamped / 100) * (sorted.length - 1));
  return sorted[index];
}

export function computeDentalWindowPresets(
  volume: Pick<LoadedVolume, 'voxels' | 'meta'>,
): DentalWindowPreset[] {
  const sorted = sampleVoxelValues(volume.voxels);
  const low = percentileOfSorted(sorted, DENTAL_SPAN_PERCENTILES[0]);
  const high = percentileOfSorted(sorted, DENTAL_SPAN_PERCENTILES[1]);
  const span = Math.max(1, high - low);
  // Never collapse a preset into a near-binary threshold.
  const minWindow = Math.max(1, Math.round(span * 0.05));

  return DENTAL_PRESET_ORDER.map((id): DentalWindowPreset => {
    if (id === 'scan') {
      return { id, windowLevel: { ...volume.meta.initialWindowLevel } };
    }
    const [from, to] = DENTAL_PRESET_FRACTIONS[id];
    const rangeLow = low + from * span;
    const rangeHigh = low + to * span;
    return {
      id,
      windowLevel: {
        window: Math.max(minWindow, Math.round(rangeHigh - rangeLow)),
        level: Math.round((rangeLow + rangeHigh) / 2),
      },
    };
  });
}
