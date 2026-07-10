/**
 * Adapter that connects generated tooth-library instances to the generic FDI
 * numbering in `fdiNumbering.ts`. Kept separate so `fdiNumbering.ts` stays a
 * pure geometric utility (no dependency on `SegmentationItem` / volume meta) and
 * `generateLibrary.ts` stays lean — this is the only place that knows how a
 * library item's `centroidZYX` maps into the FDI arch frame.
 */
import {
  LPS_CANONICAL_PATIENT_AXES,
  type ParsedVolumeMeta,
  type Vec3,
} from '../../types';
import { assignFdiNumbers, type Jaw } from './fdiNumbering';
import type { SegmentationItem } from './types';

export interface ArchAxes {
  /** Unit axis toward the patient's LEFT (separates quadrants L/R). */
  leftAxis: Vec3;
  /** Unit axis toward ANTERIOR / the incisors. */
  anteriorAxis: Vec3;
  /** Unit axis toward SUPERIOR (used to split the upper/lower jaw). */
  superiorAxis: Vec3;
}

/**
 * Resolve arch axes from the volume meta. Prefers `meta.patientAxes` (derived by
 * the importer from DICOM ImageOrientationPatient); otherwise uses the importer's
 * LPS-canonical convention (+x = Left, +y = Posterior so anterior = −y, +z =
 * Superior). Getting `anterior` right is what makes FDI number incisor→molar
 * rather than backwards.
 */
export function archAxesFromMeta(meta?: ParsedVolumeMeta): ArchAxes {
  const axes = meta?.patientAxes ?? LPS_CANONICAL_PATIENT_AXES;
  return {
    leftAxis: axes.left,
    anteriorAxis: axes.anterior,
    superiorAxis: axes.superior,
  };
}

export interface ToothFdiOptions extends Partial<ArchAxes> {
  /**
   * Which jaw the instances belong to. `'both'` splits them by the superior
   * axis (median) and numbers each jaw independently. Default `'both'`.
   */
  jaw?: Jaw | 'both';
}

/** `centroidZYX` (full-volume voxels, [z, y, x]) → arch-frame position [x, y, z]. */
function itemPosition(item: SegmentationItem): Vec3 {
  const [z, y, x] = item.centroidZYX;
  return [x, y, z];
}

/**
 * Assign FDI numbers to tooth-library items, returning new items with
 * `fdi`/`fdiName`/`quadrant` populated. Input order is preserved. Pure — does
 * not mutate the input.
 */
export function assignFdiToItems(
  items: SegmentationItem[],
  options: ToothFdiOptions = {},
): SegmentationItem[] {
  if (items.length === 0) return items;

  const leftAxis = options.leftAxis ?? LPS_CANONICAL_PATIENT_AXES.left;
  const anteriorAxis = options.anteriorAxis ?? LPS_CANONICAL_PATIENT_AXES.anterior;
  const superiorAxis = options.superiorAxis ?? LPS_CANONICAL_PATIENT_AXES.superior;
  const jaw = options.jaw ?? 'both';

  const annotate = (indices: number[], jawSide: Jaw) => {
    const assigned = assignFdiNumbers(
      indices.map((index) => ({ position: itemPosition(items[index]) })),
      { jaw: jawSide, leftAxis, anteriorAxis },
    );
    indices.forEach((itemIndex, order) => {
      const a = assigned[order];
      result[itemIndex] = {
        ...items[itemIndex],
        fdi: a.fdi,
        fdiName: a.fdiName,
        quadrant: a.quadrant,
      };
    });
  };

  const result = items.slice();

  if (jaw !== 'both') {
    annotate(
      items.map((_, index) => index),
      jaw,
    );
    return result;
  }

  // Split into upper/lower at the largest superior-axis gap. Unlike a median
  // split, this does not assume both jaws contain the same number of teeth.
  const projections = items.map(
    (item) =>
      itemPosition(item)[0] * superiorAxis[0] +
      itemPosition(item)[1] * superiorAxis[1] +
      itemPosition(item)[2] * superiorAxis[2],
  );
  const sorted = projections
    .map((projection, index) => ({ projection, index }))
    .sort((a, b) => a.projection - b.projection);
  let splitIndex = Math.floor(sorted.length / 2);
  if (sorted.length >= 4) {
    let largestGap = -Infinity;
    // Keep at least two candidates in each jaw; tiny outliers should not define
    // the anatomical split.
    for (let index = 2; index <= sorted.length - 2; index += 1) {
      const gap = sorted[index].projection - sorted[index - 1].projection;
      if (gap > largestGap) {
        largestGap = gap;
        splitIndex = index;
      }
    }
  }
  const lowerSet = new Set(sorted.slice(0, splitIndex).map((entry) => entry.index));
  const upper: number[] = [];
  const lower: number[] = [];
  items.forEach((_, index) => {
    if (lowerSet.has(index)) lower.push(index);
    else upper.push(index);
  });
  if (upper.length) annotate(upper, 'upper');
  if (lower.length) annotate(lower, 'lower');
  return result;
}
