import { describe, expect, it } from 'vitest';
import { VolumeAxis } from '../../types';
import {
  extractTissueOverlayImage,
  TISSUE_PRESETS,
} from './tissuePresets';

describe('tissue presets', () => {
  it('renders a tissue overlay for matching HU bands', () => {
    const soft = TISSUE_PRESETS.find((preset) => preset.id === 'softTissue');
    const compact = TISSUE_PRESETS.find((preset) => preset.id === 'compactBone');
    if (!soft || !compact) throw new Error('Missing presets');

    const overlay = extractTissueOverlayImage(
      new Int16Array([-500, 700, 50, 5000]),
      [
        { preset: soft, visible: true },
        { preset: compact, visible: true },
      ],
      VolumeAxis.Axial,
      { x: 0, y: 0, z: 0 },
      [2, 2, 1],
      [1, 1, 1],
    );

    expect(overlay?.width).toBe(2);
    expect(overlay?.height).toBe(2);
    expect(overlay?.data[3]).toBeGreaterThan(0);
    expect(overlay?.data[7]).toBeGreaterThan(0);
    expect(overlay?.data[11]).toBeGreaterThan(0);
    expect(overlay?.data[15]).toBe(0);
  });

  it('returns null when all tissue layers are hidden', () => {
    const preset = TISSUE_PRESETS[0];
    expect(
      extractTissueOverlayImage(
        new Int16Array([preset.range[0]]),
        [{ preset, visible: false }],
        VolumeAxis.Axial,
        { x: 0, y: 0, z: 0 },
        [1, 1, 1],
        [1, 1, 1],
      ),
    ).toBeNull();
  });
});
