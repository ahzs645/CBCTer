/**
 * Verified configuration for the DentalSegmentator nnU-Net model
 * (`Dataset112_DentalSegmentator_v100`, Zenodo DOI 10.5281/zenodo.10829674,
 * CC-BY-4.0), read from the model's shipped `plans.json` / `dataset.json`.
 *
 * This is the single source of truth for the model port (worker, ONNX export,
 * label rendering). Numbers here are from the model package — not guesses.
 */
import {
  DENTAL_SEGMENTATOR_CT_NORMALIZATION,
  type CtNormalizationParams,
} from '../volume/intensityNormalization';

export interface DentalSegmentatorLabel {
  /** Labelmap value emitted by argmax over the model's class channels. */
  value: number;
  /** Stable key for UI/i18n. */
  key: string;
  /** Display name (matches `dataset.json`). */
  name: string;
  /** Suggested overlay color. */
  color: string;
}

/** Output classes (0 = background), in channel order. */
export const DENTAL_SEGMENTATOR_LABELS: DentalSegmentatorLabel[] = [
  { value: 1, key: 'upperSkull', name: 'Upper Skull', color: '#d8c3a5' },
  { value: 2, key: 'mandible', name: 'Mandible', color: '#e8a87c' },
  { value: 3, key: 'upperTeeth', name: 'Upper Teeth', color: '#54b6e8' },
  { value: 4, key: 'lowerTeeth', name: 'Lower Teeth', color: '#70d878' },
  { value: 5, key: 'mandibularCanal', name: 'Mandibular canal', color: '#ea5d5d' },
];

/** Number of model output channels including background. */
export const DENTAL_SEGMENTATOR_CLASS_COUNT = DENTAL_SEGMENTATOR_LABELS.length + 1;

/** Sliding-window patch size `[d, h, w]` from `plans.json` (3d_fullres). */
export const DENTAL_SEGMENTATOR_PATCH_SIZE: [number, number, number] = [
  128, 160, 112,
];

/**
 * Target voxel spacing from `plans.json` (3d_fullres), in the nnU-Net plans axis
 * order. Match this to the volume's axis order before resampling — see
 * `docs/source-repos/PORTING-nnunet-dentalsegmentator.md`.
 */
export const DENTAL_SEGMENTATOR_SPACING: [number, number, number] = [
  0.43164101243019104, 0.31200000643730164, 0.43164101243019104,
];

/** The thin mandibular-canal class — skip it in small-component cleanup. */
export const DENTAL_SEGMENTATOR_CANAL_LABEL = 5;

export const DENTAL_SEGMENTATOR_NORMALIZATION: CtNormalizationParams =
  DENTAL_SEGMENTATOR_CT_NORMALIZATION;
