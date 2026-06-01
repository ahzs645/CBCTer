/**
 * Configuration for the AMASSS SKIN model (soft-tissue head/face), read from the
 * model's plans.json (`Dataset001_myseg`, AMASSS_CBCT release). A binary nnU-Net
 * that segments the patient's soft tissue — its surface is the 3-D face.
 *
 * ⚠️ The AMASSS weights have no clear license (unlike DentalSegmentator's
 * CC-BY-4.0); the model is not committed and not hosted publicly until that is
 * clarified — see `docs/source-repos/LICENSING.md`.
 */
import type { Vec3 } from '../../types';
import type { CtNormalizationParams } from '../volume/intensityNormalization';

export const AMASSS_SKIN_MODEL_FILE = 'amasss-skin.onnx';

/** nnU-Net CTNormalization constants from the SKIN model's plans.json. */
export const AMASSS_SKIN_NORMALIZATION: CtNormalizationParams = {
  lowerBound: -931,
  upperBound: 1543,
  mean: 12.869,
  std: 370.557,
};

/** Target voxel spacing (isotropic) from the SKIN plans. */
export const AMASSS_SKIN_SPACING: Vec3 = [0.4, 0.4, 0.4];

/** Sliding-window patch size `[d, h, w]`. */
export const AMASSS_SKIN_PATCH: [number, number, number] = [128, 128, 128];

/** Output channels including background (binary). */
export const AMASSS_SKIN_CLASS_COUNT = 2;

/** Foreground (skin) label value. */
export const AMASSS_SKIN_LABEL = 1;

/** Display color for the face surface. */
export const AMASSS_SKIN_COLOR = '#e8b48c';
