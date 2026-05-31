/**
 * Adapter that connects generated tooth-library instances to the generic FDI
 * numbering in `fdiNumbering.ts`. Kept separate so `fdiNumbering.ts` stays a
 * pure geometric utility (no dependency on `SegmentationItem` / volume meta) and
 * `generateLibrary.ts` stays lean — this is the only place that knows how a
 * library item's `centroidZYX` maps into the FDI arch frame.
 */
import type { Vec3 } from '../../types';
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
 * Default arch axes in the volume's voxel frame: x = left↔right, y =
 * anterior↔posterior, z = superior↔inferior.
 *
 * NOTE: this is the voxel-frame assumption, not true anatomical orientation —
 * CBCTer's `ParsedVolumeMeta` does not yet carry DICOM ImageOrientationPatient,
 * so anterior/left/superior signs may be flipped for some scans. Callers with a
 * known orientation should pass explicit axes to {@link assignFdiToItems}. When
 * volume meta later exposes orientation, give this a `meta` argument and derive
 * the axes from it so every caller benefits.
 */
export function defaultArchAxes(): ArchAxes {
  return {
    leftAxis: [1, 0, 0],
    anteriorAxis: [0, 1, 0],
    superiorAxis: [0, 0, 1],
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

  const leftAxis = options.leftAxis ?? [1, 0, 0];
  const anteriorAxis = options.anteriorAxis ?? [0, 1, 0];
  const superiorAxis = options.superiorAxis ?? [0, 0, 1];
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

  // Split into upper/lower by the superior-axis projection (median threshold).
  const projections = items.map(
    (item) =>
      itemPosition(item)[0] * superiorAxis[0] +
      itemPosition(item)[1] * superiorAxis[1] +
      itemPosition(item)[2] * superiorAxis[2],
  );
  const sorted = [...projections].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const upper: number[] = [];
  const lower: number[] = [];
  items.forEach((_, index) => {
    if (projections[index] >= median) upper.push(index);
    else lower.push(index);
  });
  if (upper.length) annotate(upper, 'upper');
  if (lower.length) annotate(lower, 'lower');
  return result;
}
