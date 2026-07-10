/**
 * FDI (ISO 3950) tooth numbering for separated tooth instances — a capability
 * CBCTer had nowhere. Ported as a geometric heuristic from ToothGroupNetwork's
 * PCA centre-line + jaw-offset logic (`inference_pipeline_tgn` / `web_app.py`'s
 * `FDI_NUMBERING`): run PCA on the tooth centroids to get the arch's
 * left↔right and anterior↔posterior axes, split at the midline into quadrants,
 * then order each side from the central incisor outward to the third molar.
 *
 * This upgrades the watershed-separated voxel teeth from `tooth-1..N` labels to
 * clinical FDI numbers. It is a heuristic: for best results pass `leftAxis` /
 * `anteriorAxis` from the volume's known orientation (LPS/RAS). With the PCA
 * fallback the side (right/left) and order (incisor/molar) can be mirrored,
 * because raw principal-axis signs are arbitrary.
 */
import type { Vec3 } from '../../types';
import { dot, normalize, pca, subtract } from '../geometry/linalg';

export type Jaw = 'upper' | 'lower';

const POSITION_NAMES = [
  'Central Incisor',
  'Lateral Incisor',
  'Canine',
  'First Premolar',
  'Second Premolar',
  'First Molar',
  'Second Molar',
  'Third Molar',
];

const QUADRANT_NAMES: Record<number, string> = {
  1: 'Upper Right',
  2: 'Upper Left',
  3: 'Lower Left',
  4: 'Lower Right',
  // Primary (deciduous) dentition quadrants.
  5: 'Upper Right',
  6: 'Upper Left',
  7: 'Lower Left',
  8: 'Lower Right',
};

/** Primary dentition has 5 teeth per quadrant (no premolars/third molar). */
const PRIMARY_POSITION_NAMES = [
  'Central Incisor',
  'Lateral Incisor',
  'Canine',
  'First Molar',
  'Second Molar',
];

/** FDI tooth number (11–48) → human-readable name, e.g. 11 → "Upper Right Central Incisor". */
export const FDI_NUMBERING: Record<number, string> = (() => {
  const map: Record<number, string> = {};
  for (let quadrant = 1; quadrant <= 4; quadrant += 1) {
    for (let position = 1; position <= 8; position += 1) {
      map[quadrant * 10 + position] =
        `${QUADRANT_NAMES[quadrant]} ${POSITION_NAMES[position - 1]}`;
    }
  }
  return map;
})();

/** Primary FDI tooth number (51–85) → name, e.g. 51 → "Upper Right Central Incisor". */
export const PRIMARY_FDI_NUMBERING: Record<number, string> = (() => {
  const map: Record<number, string> = {};
  for (let quadrant = 5; quadrant <= 8; quadrant += 1) {
    for (let position = 1; position <= 5; position += 1) {
      map[quadrant * 10 + position] =
        `${QUADRANT_NAMES[quadrant]} ${PRIMARY_POSITION_NAMES[position - 1]}`;
    }
  }
  return map;
})();

/**
 * Name for any FDI number, permanent (11–48) or primary (51–85). Primary teeth
 * are suffixed "(primary)" so they read unambiguously in clinical UI.
 */
export function fdiToothName(fdi: number): string {
  if (FDI_NUMBERING[fdi]) return FDI_NUMBERING[fdi];
  if (PRIMARY_FDI_NUMBERING[fdi]) return `${PRIMARY_FDI_NUMBERING[fdi]} (primary)`;
  return `Tooth ${fdi}`;
}

export interface ToothInput {
  /** Tooth centroid in a consistent frame `[x, y, z]` (world mm or voxels). */
  position: Vec3;
}

export interface FdiFields {
  /** FDI tooth number 11–48. */
  fdi: number;
  /** Human-readable name from {@link FDI_NUMBERING}. */
  fdiName: string;
  /** FDI quadrant 1–4. */
  quadrant: number;
  /** 1 (central incisor) … 8 (third molar). */
  positionInQuadrant: number;
}

export interface FdiOptions {
  jaw: Jaw;
  /** Unit-ish axis pointing to the patient's LEFT. Defaults to PCA axis 0. */
  leftAxis?: Vec3;
  /** Unit-ish axis pointing ANTERIOR (toward the incisors). Defaults to PCA axis 1. */
  anteriorAxis?: Vec3;
}

interface ProjectedTooth {
  index: number;
  lr: number;
  ap: number;
}

/**
 * Infer interior missing-tooth slots from unusually large centroid gaps.
 *
 * This deliberately stays conservative: it never invents more missing slots
 * than the quadrant can contain, and it leaves ordinary/ambiguous spacing as
 * consecutive rank order. Semantic teacher probabilities can eventually
 * replace this geometry-only fallback with a full min-cost assignment.
 */
function inferArchSlots(sorted: ProjectedTooth[]): number[] {
  if (sorted.length < 3 || sorted.length >= 8) {
    return sorted.map((_, index) => index + 1);
  }

  const gaps = sorted.slice(1).map((entry, index) => {
    const previous = sorted[index];
    return Math.hypot(entry.lr - previous.lr, entry.ap - previous.ap);
  });
  const finite = gaps.filter((gap) => Number.isFinite(gap) && gap > 0).sort((a, b) => a - b);
  if (finite.length < 2) return sorted.map((_, index) => index + 1);

  // Estimate normal neighbor spacing from the smaller 60% so a true missing
  // tooth gap does not inflate the baseline.
  const normalCount = Math.max(2, Math.ceil(finite.length * 0.6));
  const normal = finite.slice(0, normalCount);
  const typical = normal[Math.floor(normal.length / 2)];
  if (!(typical > 0)) return sorted.map((_, index) => index + 1);

  const availableMissingSlots = 8 - sorted.length;
  const candidates = gaps
    .map((gap, index) => ({
      index,
      ratio: gap / typical,
      requested: Math.min(2, Math.max(0, Math.round(gap / typical) - 1)),
    }))
    .filter((candidate) => candidate.ratio >= 1.65 && candidate.requested > 0)
    .sort((a, b) => b.ratio - a.ratio);

  const extraAfter = new Int8Array(gaps.length);
  let remaining = availableMissingSlots;
  for (const candidate of candidates) {
    if (remaining <= 0) break;
    const add = Math.min(candidate.requested, remaining);
    extraAfter[candidate.index] = add;
    remaining -= add;
  }

  const slots = [1];
  for (let index = 0; index < gaps.length; index += 1) {
    slots.push(slots[slots.length - 1] + 1 + extraAfter[index]);
  }
  return slots;
}

/**
 * Assign FDI numbers to a set of tooth instances. Input order is preserved in
 * the output; each entry is augmented with {@link FdiFields}.
 */
export function assignFdiNumbers<T extends ToothInput>(
  teeth: T[],
  options: FdiOptions,
): Array<T & FdiFields> {
  if (teeth.length === 0) return [];

  const positions = teeth.map((tooth) => tooth.position);
  const principal = pca(positions);
  const left = options.leftAxis ? normalize(options.leftAxis) : principal.axes[0];
  const anterior = options.anteriorAxis
    ? normalize(options.anteriorAxis)
    : principal.axes[1];

  const leftQuadrant = options.jaw === 'upper' ? 2 : 3;
  const rightQuadrant = options.jaw === 'upper' ? 1 : 4;

  // Project each tooth onto the left↔right and anterior↔posterior axes.
  const projected: ProjectedTooth[] = teeth.map((tooth, index) => {
    const d = subtract(tooth.position, principal.center);
    const lr = dot(d, left);
    const ap = dot(d, anterior);
    return { index, lr, ap };
  });

  // Order within a side by sweep angle from the anterior midline: the central
  // incisor (anterior, near midline) is angle ≈ 0; molars sweep toward ±180°.
  const rank = (
    side: typeof projected,
    quadrant: number,
    out: (T & FdiFields)[],
  ) => {
    const sorted = side.slice().sort(
      (a, b) =>
        Math.atan2(Math.abs(a.lr), a.ap) - Math.atan2(Math.abs(b.lr), b.ap),
    );
    const slots = inferArchSlots(sorted);
    sorted.forEach((entry, order) => {
        const positionInQuadrant = slots[order];
        const fdi = quadrant * 10 + positionInQuadrant;
        out[entry.index] = {
          ...teeth[entry.index],
          fdi,
          fdiName: FDI_NUMBERING[fdi],
          quadrant,
          positionInQuadrant,
        };
      });
  };

  const result = new Array<T & FdiFields>(teeth.length);
  rank(projected.filter((p) => p.lr >= 0), leftQuadrant, result);
  rank(projected.filter((p) => p.lr < 0), rightQuadrant, result);
  return result;
}
