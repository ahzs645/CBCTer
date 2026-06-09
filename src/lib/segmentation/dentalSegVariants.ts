/**
 * DentalSegmentator model-variant registry. The "Full anatomy" feature can run
 * any of three nnU-Net models from DCBIA-OrthoLab/SlicerAutomatedDentalTools'
 * BATCHDENTALSEG module; each ships its own labels, spacing, patch size and
 * CTNormalization constants (read from its `plans.json` / `dataset.json`).
 *
 *  - **full** — base DentalSegmentator (`Dataset112`, Zenodo CC-BY-4.0):
 *    5 anatomical classes (skull/mandible/upper-teeth/lower-teeth/canal).
 *  - **pediatric** — PediatricDentalSegmentator: same 5 anatomical classes,
 *    retrained for primary/mixed dentition.
 *  - **universal** — UniversalLabDentalSegmentator: 55 classes = per-tooth FDI
 *    (permanent + primary) plus mandible/maxilla/canal. ResEnc-L architecture.
 *
 * Weight licensing for pediatric/universal is the 3D Slicer Software License
 * Agreement (see THIRD_PARTY_NOTICES.md) — not CC-BY like the base model.
 */
import {
  DENTAL_SEGMENTATOR_CANAL_LABEL,
  DENTAL_SEGMENTATOR_CLASS_COUNT,
  DENTAL_SEGMENTATOR_LABELS,
  DENTAL_SEGMENTATOR_PATCH_SIZE,
  DENTAL_SEGMENTATOR_SPACING,
  type DentalSegmentatorLabel,
} from './dentalSegmentator';
import { fdiToothName } from './fdiNumbering';
import {
  DENTAL_SEGMENTATOR_CT_NORMALIZATION,
  PEDIATRIC_DENTAL_SEG_CT_NORMALIZATION,
  UNIVERSAL_DENTAL_SEG_CT_NORMALIZATION,
  type CtNormalizationParams,
} from '../volume/intensityNormalization';

export type DentalSegVariantId = 'full' | 'pediatric' | 'universal';

export interface DentalSegVariantConfig {
  id: DentalSegVariantId;
  /** Short display name for the variant selector. */
  name: string;
  /** i18n key suffix under `anatomy.variants`. */
  i18nKey: string;
  /** ONNX file under the models base (see modelUrl). */
  modelFile: string;
  /** Output classes (excluding background), in argmax channel order. */
  labels: DentalSegmentatorLabel[];
  /** Channel count including background (= labels.length + 1). */
  classCount: number;
  /** Sliding-window patch `[d, h, w]` from plans.json. */
  patchSize: [number, number, number];
  /** Target voxel spacing `[x, y, z]` from plans.json. */
  spacing: [number, number, number];
  /** nnU-Net CTNormalization constants. */
  normalization: CtNormalizationParams;
  /** Thin canal class to skip in small-component cleanup, if any. */
  canalLabel?: number;
  /** Name for the resulting StudySegmentGroup. */
  groupName: string;
}

/** Convert an HSL triple (h in [0,360), s/l in [0,100]) to a `#rrggbb` string. */
function hslToHex(h: number, s: number, l: number): string {
  const ln = l / 100;
  const a = (s * Math.min(ln, 1 - ln)) / 100;
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = ln - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Distinct, deterministic per-tooth color from the golden-angle hue sweep. */
function toothColor(index: number): string {
  return hslToHex((index * 137.508) % 360, 55, 62);
}

/**
 * UniversalLab label values → FDI tooth number. Order matches the model's
 * `dataset.json`: permanent upper (1–16), permanent lower (17–32), primary
 * (33–52), then mandible (53), maxilla (54), mandibular canal (55).
 */
export const UNIVERSAL_FDI_BY_VALUE: Record<number, number> = (() => {
  const permanentUpper = [
    18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28,
  ];
  const permanentLower = [
    38, 37, 36, 35, 34, 33, 32, 31, 41, 42, 43, 44, 45, 46, 47, 48,
  ];
  const primary = [
    55, 54, 53, 52, 51, 61, 62, 63, 64, 65, 75, 74, 73, 72, 71, 81, 82, 83,
    84, 85,
  ];
  const order = [...permanentUpper, ...permanentLower, ...primary];
  const map: Record<number, number> = {};
  order.forEach((fdi, i) => {
    map[i + 1] = fdi;
  });
  return map;
})();

const UNIVERSAL_LABELS: DentalSegmentatorLabel[] = (() => {
  const labels: DentalSegmentatorLabel[] = Object.entries(UNIVERSAL_FDI_BY_VALUE).map(
    ([value, fdi]) => {
      const v = Number(value);
      return {
        value: v,
        key: `tooth-${fdi}`,
        name: `${fdi} · ${fdiToothName(fdi)}`,
        color: toothColor(v),
      };
    },
  );
  // The three anatomical structures share the base model's palette.
  labels.push(
    { value: 53, key: 'mandible', name: 'Mandible', color: '#d4a1e6' },
    { value: 54, key: 'upperSkull', name: 'Maxilla & Upper Skull', color: '#e3dd90' },
    { value: 55, key: 'mandibularCanal', name: 'Mandibular canal', color: '#d8654f' },
  );
  return labels;
})();

export const DENTAL_SEG_VARIANTS: Record<DentalSegVariantId, DentalSegVariantConfig> = {
  full: {
    id: 'full',
    name: 'Full anatomy',
    i18nKey: 'full',
    modelFile: 'dentalsegmentator.onnx',
    labels: DENTAL_SEGMENTATOR_LABELS,
    classCount: DENTAL_SEGMENTATOR_CLASS_COUNT,
    patchSize: DENTAL_SEGMENTATOR_PATCH_SIZE,
    spacing: DENTAL_SEGMENTATOR_SPACING,
    normalization: DENTAL_SEGMENTATOR_CT_NORMALIZATION,
    canalLabel: DENTAL_SEGMENTATOR_CANAL_LABEL,
    groupName: 'Full anatomy (DentalSegmentator)',
  },
  pediatric: {
    id: 'pediatric',
    name: 'Pediatric',
    i18nKey: 'pediatric',
    modelFile: 'dentalsegmentator-pediatric.onnx',
    // Same 5 anatomical classes as the base model, retrained for primary teeth.
    labels: DENTAL_SEGMENTATOR_LABELS,
    classCount: DENTAL_SEGMENTATOR_CLASS_COUNT,
    patchSize: [128, 128, 128],
    spacing: [0.4, 0.4, 0.4],
    normalization: PEDIATRIC_DENTAL_SEG_CT_NORMALIZATION,
    canalLabel: DENTAL_SEGMENTATOR_CANAL_LABEL,
    groupName: 'Full anatomy (Pediatric)',
  },
  universal: {
    id: 'universal',
    name: 'Universal (per-tooth FDI)',
    i18nKey: 'universal',
    modelFile: 'dentalsegmentator-universal.onnx',
    labels: UNIVERSAL_LABELS,
    classCount: UNIVERSAL_LABELS.length + 1,
    // Trained at [160,192,192] but exported/run at [128,128,128] (÷32, FCN) so the
    // per-patch 56-class output tensor (~1.3GB→~0.47GB) fits the wasm heap. The
    // sliding window tiles to cover the volume. MUST match the export --patch.
    patchSize: [128, 128, 128],
    spacing: [0.4, 0.4, 0.4],
    normalization: UNIVERSAL_DENTAL_SEG_CT_NORMALIZATION,
    canalLabel: 55,
    groupName: 'Per-tooth FDI (Universal)',
  },
};

export const DEFAULT_DENTAL_SEG_VARIANT: DentalSegVariantId = 'full';

export function getDentalSegVariant(
  id: DentalSegVariantId = DEFAULT_DENTAL_SEG_VARIANT,
): DentalSegVariantConfig {
  return DENTAL_SEG_VARIANTS[id];
}
