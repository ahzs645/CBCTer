import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../types';
import {
  decodeMask,
  encodeMask,
  growTooth,
  growToothFromClick,
} from './growTooth';

const SHAPE: Vec3 = [60, 60, 80];
const SPACING: Vec3 = [0.2, 0.2, 0.2];
const at = (x: number, y: number, z: number) =>
  z * SHAPE[0] * SHAPE[1] + y * SHAPE[0] + x;

/**
 * A lower tooth: a crown (radius 12 voxels, z 50–75) on a tapering root
 * (z 10–50) with a dark pulp, in a bone block (z < 45) that is fused to the
 * root on one side, so a plain threshold would spill into the bone.
 */
function phantom() {
  const scan = new Int16Array(SHAPE[0] * SHAPE[1] * SHAPE[2]).fill(0);
  const truth = new Uint8Array(scan.length);
  for (let z = 0; z < SHAPE[2]; z++)
    for (let y = 0; y < SHAPE[1]; y++)
      for (let x = 0; x < SHAPE[0]; x++) {
        const i = at(x, y, z);
        const r = Math.hypot(x - 30, y - 30);
        const radius = z >= 50 ? 12 : 4 + (8 * (z - 10)) / 40;
        if (z >= 10 && z <= 75 && r <= radius) {
          truth[i] = 1;
          scan[i] = r < 2 && z < 60 ? 300 : 2000;
        } else if (z < 45) {
          // Bone: dense, touching the root along x > 30 (no gap there).
          scan[i] = r <= radius + 1 && x < 30 ? 100 : 1500;
        }
      }
  return { scan, truth };
}

describe('growTooth', () => {
  it('outlines a tooth from a click without running into fused bone', () => {
    const { scan, truth } = phantom();
    const grown = growTooth({
      scan,
      shape: SHAPE,
      spacing: SPACING,
      seed: [30, 36, 62],
      crownDirection: 1,
    })!;
    expect(grown).not.toBeNull();
    let inter = 0,
      a = 0;
    for (let i = 0; i < truth.length; i++) {
      a += truth[i];
      inter += truth[i] & grown.mask[i];
    }
    const dice = (2 * inter) / (a + grown.voxels);
    expect(dice).toBeGreaterThan(0.8);
    // Where the bone is fused on, the root keeps its last width (no taper).
    expect(grown.voxels / a).toBeLessThan(1.25);
    // The pulp is filled in.
    expect(grown.mask[at(30, 30, 55)]).toBe(1);
    // No bone far from the root.
    expect(grown.mask[at(55, 30, 20)]).toBe(0);
    expect(grown.leaked).toBe(false);
  });

  it('outlines the whole tooth from a click near the biting edge', () => {
    const { scan, truth } = phantom();
    const grown = growToothFromClick({
      scan,
      shape: SHAPE,
      spacing: SPACING,
      seed: [30, 36, 73],
      crownDirection: 1,
    })!;
    let inter = 0,
      a = 0;
    for (let i = 0; i < truth.length; i++) {
      a += truth[i];
      inter += truth[i] & grown.mask[i];
    }
    expect((2 * inter) / (a + grown.voxels)).toBeGreaterThan(0.8);
  });

  it('leaves out voxels other teeth already have', () => {
    const { scan } = phantom();
    const taken = new Uint8Array(scan.length);
    for (let z = 0; z < SHAPE[2]; z++)
      for (let y = 0; y < SHAPE[1]; y++)
        for (let x = 30; x < SHAPE[0]; x++) taken[at(x, y, z)] = 1;
    const grown = growTooth({
      scan,
      taken,
      shape: SHAPE,
      spacing: SPACING,
      seed: [25, 30, 62],
      crownDirection: 1,
    })!;
    for (let i = 0; i < taken.length; i++)
      if (taken[i]) expect(grown.mask[i]).toBe(0);
  });

  it('returns null where there is no tooth', () => {
    const scan = new Int16Array(SHAPE[0] * SHAPE[1] * SHAPE[2]);
    expect(
      growTooth({ scan, shape: SHAPE, spacing: SPACING, seed: [30, 30, 40] }),
    ).toBeNull();
  });

  it('round-trips masks through run-length encoding', () => {
    const mask = new Uint8Array(1000);
    for (let i = 100; i < 400; i++) mask[i] = i % 7 ? 1 : 0;
    mask[999] = 1;
    expect(Array.from(decodeMask(encodeMask(mask), mask.length))).toEqual(
      Array.from(mask),
    );
  });
});
