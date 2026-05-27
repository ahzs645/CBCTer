import { describe, expect, it } from 'vitest';
import { VolumeAxis } from '../../types';
import { labelmapToMask, paintLabelmapStroke } from './paintBrush';

describe('paintLabelmapStroke', () => {
  it('paints the active segment and preserves locked labels', () => {
    const labelmap = new Uint16Array(5 * 5 * 1);
    labelmap[12] = 7;
    const touched = new Set<number>();

    paintLabelmapStroke(labelmap, undefined, [2, 2, 0], touched, {
      axis: VolumeAxis.Axial,
      cursor: { x: 2, y: 2, z: 0 },
      dimensions: [5, 5, 1],
      spacing: [1, 1, 1],
      brushSizeMm: 3,
      brushShape: 'circle',
      operation: 'draw',
      thresholdRange: [-1000, 3000],
      segmentValue: 3,
      lockedValues: new Set([7]),
    });

    expect(labelmap[12]).toBe(7);
    expect(labelmap[7]).toBe(3);
    expect(touched.size).toBeGreaterThan(0);
  });

  it('erases only the active segment value to zero', () => {
    const labelmap = new Uint16Array(5 * 5 * 1);
    labelmap[12] = 3;
    labelmap[13] = 4;

    paintLabelmapStroke(labelmap, undefined, [2, 2, 0], new Set(), {
      axis: VolumeAxis.Axial,
      cursor: { x: 2, y: 2, z: 0 },
      dimensions: [5, 5, 1],
      spacing: [1, 1, 1],
      brushSizeMm: 1,
      brushShape: 'circle',
      operation: 'erase',
      thresholdRange: [-1000, 3000],
      segmentValue: 3,
    });

    expect(labelmap[12]).toBe(0);
    expect(labelmap[13]).toBe(4);
    expect(labelmapToMask(labelmap, 3)[12]).toBe(0);
  });
});

