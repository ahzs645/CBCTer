import { describe, expect, it } from 'vitest';
import {
  buildDentalSegmentGroup,
  summarizeDentalLabels,
} from './dentalSegmentGroup';

describe('dental segment group', () => {
  it('counts voxels and volumes per class', () => {
    // labels: 1×skull, 2×mandible, 3×upper-teeth, others 0.
    const labelmap = new Uint16Array([0, 1, 2, 2, 3, 3, 3, 0]);
    const stats = summarizeDentalLabels(labelmap, [2, 1, 1]); // 2 mm³/voxel
    const byValue = Object.fromEntries(stats.map((s) => [s.value, s]));
    expect(byValue[1].voxelCount).toBe(1);
    expect(byValue[1].volumeMm3).toBe(2);
    expect(byValue[2].voxelCount).toBe(2);
    expect(byValue[3].voxelCount).toBe(3);
    expect(byValue[3].volumeMm3).toBe(6);
    // Canal (5) absent → zero, still listed.
    expect(byValue[5].voxelCount).toBe(0);
    expect(stats).toHaveLength(5);
  });

  it('builds a 5-segment group from stats', () => {
    const stats = summarizeDentalLabels(new Uint16Array([1, 2, 3, 4, 5]), [1, 1, 1]);
    const group = buildDentalSegmentGroup('study-1', 'image-1', stats);
    expect(group.segments).toHaveLength(5);
    expect(group.segments.map((s) => s.value)).toEqual([1, 2, 3, 4, 5]);
    expect(group.segments[0].name).toBe('Upper Skull');
    expect(group.activeSegmentValue).toBe(1);
  });
});
