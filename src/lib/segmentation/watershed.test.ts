import { describe, expect, it } from 'vitest';
import { watershedSplit } from './watershed';

describe('watershedSplit', () => {
  it('uses provided marker labels as separate basins', () => {
    const dims: [number, number, number] = [1, 5, 8];
    const [, height, width] = dims;
    const mask = new Uint8Array(dims[0] * height * width);
    for (let x = 1; x <= 6; x += 1) mask[2 * width + x] = 1;

    const markers = new Uint16Array(mask.length);
    markers[2 * width + 2] = 10;
    markers[2 * width + 5] = 20;

    const { labels, components } = watershedSplit(mask, dims, {
      markerLabels: markers,
    });

    expect(labels[2 * width + 2]).toBe(10);
    expect(labels[2 * width + 5]).toBe(20);
    expect(components.map((component) => component.id).sort((a, b) => a - b)).toEqual([
      10,
      20,
    ]);
  });

  it('adds a fallback marker for unseeded foreground components', () => {
    const dims: [number, number, number] = [1, 5, 8];
    const [, height, width] = dims;
    const mask = new Uint8Array(dims[0] * height * width);
    mask[1 * width + 1] = 1;
    mask[1 * width + 2] = 1;
    mask[3 * width + 5] = 1;
    mask[3 * width + 6] = 1;

    const markers = new Uint16Array(mask.length);
    markers[1 * width + 1] = 7;

    const { components } = watershedSplit(mask, dims, {
      markerLabels: markers,
    });

    expect(components).toHaveLength(2);
    expect(components.some((component) => component.id === 7)).toBe(true);
  });
});
