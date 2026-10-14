import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../types';
import {
  archModelStl,
  biteContacts,
  buildArchModelMask,
  components3d,
  orientStl,
  type CrownCut,
} from './archModel';
import type { ToothInstance } from './types';

function tooth(
  value: number,
  fdi: number | null,
  centroidZ = 0,
): ToothInstance {
  return {
    id: `t${value}`,
    groupId: 'g',
    value,
    fdi,
    review: 'unreviewed',
    centroid: [0, 0, centroidZ],
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    voxelCount: 1,
    source: 'model',
  };
}

const SHAPE: Vec3 = [120, 80, 80];
const SPACING: Vec3 = [0.2, 0.2, 0.2];
const GUM = 45;
const CENTRES = [20, 36, 52, 68, 84, 100].map(
  (x) => [x, Math.round(20 + 0.015 * (x - 60) ** 2)] as const,
);

/** Six cylinder "teeth" (radius 6 voxels) on a parabola, z 0..74. */
function lowerArch(centres = CENTRES, radius = 6) {
  const [w, h] = SHAPE;
  const words = new Uint16Array(SHAPE[0] * SHAPE[1] * SHAPE[2]);
  centres.forEach(([cx, cy], k) => {
    for (let z = 0; z < 75; z++)
      for (let y = cy - radius; y <= cy + radius; y++)
        for (let x = cx - radius; x <= cx + radius; x++)
          if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius)
            words[(z * h + y) * w + x] = k + 1;
  });
  const fdis = [33, 32, 31, 41, 42, 43];
  const teeth = centres.map((_, k) => tooth(k + 1, fdis[k]));
  const crowns = new Map<string, CrownCut>(
    teeth.map((t) => [t.id, { gumline: GUM, crownDirection: 1 }]),
  );
  return { labels: [{ groupId: 'g', words }], words, teeth, crowns };
}

function at(mask: Uint8Array, shape: Vec3, x: number, y: number, z: number) {
  if (
    x < 0 ||
    y < 0 ||
    z < 0 ||
    x >= shape[0] ||
    y >= shape[1] ||
    z >= shape[2]
  )
    return 0;
  return mask[(z * shape[1] + y) * shape[0] + x];
}

describe('buildArchModelMask', () => {
  const arch = lowerArch();
  const start: Vec3 = [10, 20, 30];
  const model = buildArchModelMask({
    ...arch,
    shape: SHAPE,
    start,
    spacing: SPACING,
    baseHeightMm: 6,
  });
  const o = [0, 1, 2].map((a) => start[a] - model.start[a]);
  const get = (x: number, y: number, z: number) =>
    at(model.mask, model.shape, x + o[0], y + o[1], z + o[2]);
  const bottom = GUM - 30; // 6 mm at 0.2 mm
  const collarTop = GUM + 5; // 1 mm

  it('keeps every crown voxel and nothing of the crowns below the base', () => {
    const [w, h] = SHAPE;
    let crown = 0,
      missing = 0,
      rootBelow = 0;
    for (let z = 0; z < SHAPE[2]; z++)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (!arch.words[(z * h + y) * w + x]) continue;
          if (z >= GUM) {
            crown++;
            if (!get(x, y, z)) missing++;
          } else if (z < bottom && get(x, y, z)) rootBelow++;
        }
    expect(crown).toBeGreaterThan(0);
    expect(missing).toBe(0);
    expect(rootBelow).toBe(0);
  });

  it('is crowns only above the collar and nothing below the flat bottom', () => {
    expect(model.bottom).toBe(bottom + o[2]);
    let extra = 0,
      below = 0;
    for (let z = 0; z < model.shape[2]; z++)
      for (let y = 0; y < model.shape[1]; y++)
        for (let x = 0; x < model.shape[0]; x++) {
          if (!at(model.mask, model.shape, x, y, z)) continue;
          const sz = z - o[2],
            sy = y - o[1],
            sx = x - o[0];
          if (sz < bottom) below++;
          const label =
            sx >= 0 &&
            sy >= 0 &&
            sx < SHAPE[0] &&
            sy < SHAPE[1] &&
            sz < SHAPE[2]
              ? arch.words[(sz * SHAPE[1] + sy) * SHAPE[0] + sx]
              : 0;
          if (sz > collarTop && !label) extra++;
        }
    expect(below).toBe(0);
    expect(extra).toBe(0);
  });

  it('has a flat bottom under a footprint that covers the arch', () => {
    let bottomColumns = 0,
      footprintMismatch = 0;
    for (let y = 0; y < model.shape[1]; y++)
      for (let x = 0; x < model.shape[0]; x++) {
        const base = at(model.mask, model.shape, x, y, model.bottom);
        if (base) bottomColumns++;
        // Every base column runs solid from the bottom to the collar top.
        for (let z = model.bottom; z <= collarTop + o[2]; z++)
          if (at(model.mask, model.shape, x, y, z) !== base)
            footprintMismatch++;
      }
    expect(bottomColumns).toBeGreaterThan(0);
    expect(footprintMismatch).toBe(0);
    // Within the 1.5 mm rim of every tooth (radius 6 + 7 voxels).
    for (const [cx, cy] of CENTRES)
      for (const [dx, dy] of [
        [12, 0],
        [-12, 0],
        [0, 12],
        [0, -12],
        [9, 9],
      ])
        expect(get(cx + dx, cy + dy, bottom)).toBe(1);
    // Gaps between neighbouring teeth are filled.
    for (let k = 0; k + 1 < CENTRES.length; k++) {
      const mx = (CENTRES[k][0] + CENTRES[k + 1][0]) / 2,
        my = Math.round((CENTRES[k][1] + CENTRES[k + 1][1]) / 2);
      expect(get(mx, my, collarTop)).toBe(1);
    }
    // Not filled far from the teeth (inside the horseshoe, 5+ mm away).
    expect(get(60, 55, bottom)).toBe(0);
    expect(get(60, 70, bottom)).toBe(0);
  });

  it('is one connected solid', () => {
    expect(components3d(model.mask, model.shape).sizes.length).toBe(2);
    expect(model.bridges).toBe(0);
    expect(model.droppedVoxels).toBe(0);
  });

  it('grows the crop when the base needs room below it', () => {
    const tall = buildArchModelMask({
      ...arch,
      shape: SHAPE,
      start,
      spacing: SPACING,
      baseHeightMm: 12,
    });
    // 12 mm = 60 voxels below the gumline at 45 → scan z 30 + 45 - 60 = 15.
    expect(tall.start[2] + tall.bottom).toBe(start[2] + GUM - 60);
    expect(tall.start[2]).toBeLessThan(start[2]);
    expect(components3d(tall.mask, tall.shape).sizes.length).toBe(2);
  });

  it('bridges a wide gap such as a missing tooth', () => {
    const gapped = lowerArch([CENTRES[0], CENTRES[1], CENTRES[5]]);
    const model = buildArchModelMask({
      ...gapped,
      shape: SHAPE,
      start: [0, 0, 0],
      spacing: SPACING,
    });
    expect(model.bridges).toBeGreaterThanOrEqual(1);
    expect(components3d(model.mask, model.shape).sizes.length).toBe(2);
  });

  it('builds an upper arch with the base above the crowns', () => {
    const upperCrowns = new Map<string, CrownCut>(
      arch.teeth.map((t) => [t.id, { gumline: 30, crownDirection: -1 }]),
    );
    const upperTeeth = arch.teeth.map((t) => ({ ...t, fdi: t.fdi! - 20 }));
    const model = buildArchModelMask({
      ...arch,
      teeth: upperTeeth,
      crowns: upperCrowns,
      shape: SHAPE,
      start: [0, 0, 0],
      spacing: SPACING,
    });
    // 8 mm default base = 40 voxels above the gumline at z 30.
    expect(model.start[2] + model.bottom).toBe(70);
    expect(model.start[2]).toBe(0);
    expect(components3d(model.mask, model.shape).sizes.length).toBe(2);
  });

  it('refuses to mix upper and lower teeth', () => {
    const mixed = arch.teeth.map((t, k) => (k ? t : { ...t, fdi: 13 }));
    expect(() =>
      buildArchModelMask({
        ...arch,
        teeth: mixed,
        shape: SHAPE,
        start,
        spacing: SPACING,
      }),
    ).toThrow(/upper and lower/);
    const crowns = new Map(arch.crowns);
    crowns.set('t1', { gumline: GUM, crownDirection: -1 });
    expect(() =>
      buildArchModelMask({
        ...arch,
        crowns,
        shape: SHAPE,
        start,
        spacing: SPACING,
      }),
    ).toThrow(/upper and lower/);
  });
});

describe('archModelStl', () => {
  it('meshes the model in scan millimetres', async () => {
    const arch = lowerArch();
    const start: Vec3 = [10, 20, 30];
    const options = { ...arch, shape: SHAPE, start, spacing: SPACING };
    const model = buildArchModelMask(options);
    const stl = await archModelStl({ ...options, smoothIterations: 0 });
    const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
    const count = view.getUint32(80, true);
    expect(count).toBeGreaterThan(0);
    expect(stl.byteLength).toBe(84 + count * 50);
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let t = 0; t < count; t++)
      for (let v = 0; v < 3; v++)
        for (let a = 0; a < 3; a++) {
          const value = view.getFloat32(
            84 + t * 50 + 12 + v * 12 + a * 4,
            true,
          );
          min[a] = Math.min(min[a], value);
          max[a] = Math.max(max[a], value);
        }
    // Mask voxel i sits at (start + i) × spacing; the surface lies half a
    // voxel outside the outermost set voxels.
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    const [w, h, d] = model.shape;
    for (let z = 0; z < d; z++)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (model.mask[(z * h + y) * w + x])
            [x, y, z].forEach((p, a) => {
              lo[a] = Math.min(lo[a], p);
              hi[a] = Math.max(hi[a], p);
            });
    for (let a = 0; a < 3; a++) {
      expect(min[a]).toBeCloseTo(
        (model.start[a] + lo[a] - 0.5) * SPACING[a],
        3,
      );
      expect(max[a]).toBeCloseTo(
        (model.start[a] + hi[a] + 0.5) * SPACING[a],
        3,
      );
    }
    // Crown tips at z 74, bottom at 45 - 40 (8 mm): 70 voxels tall.
    expect(max[2] - min[2]).toBeCloseTo(70 * 0.2, 3);

    // Closed (every edge shared by exactly two triangles) and outward-facing.
    const edges = new Map<string, number>();
    let volume = 0;
    for (let t = 0; t < count; t++) {
      const v = [0, 1, 2].map((k) =>
        [0, 1, 2].map((a) =>
          view.getFloat32(84 + t * 50 + 12 + k * 12 + a * 4, true),
        ),
      );
      const keys = v.map((p) => p.join(','));
      for (let k = 0; k < 3; k++) {
        const edge = [keys[k], keys[(k + 1) % 3]].sort().join('|');
        edges.set(edge, (edges.get(edge) ?? 0) + 1);
      }
      volume +=
        (v[0][0] * (v[1][1] * v[2][2] - v[1][2] * v[2][1]) +
          v[0][1] * (v[1][2] * v[2][0] - v[1][0] * v[2][2]) +
          v[0][2] * (v[1][0] * v[2][1] - v[1][1] * v[2][0])) /
        6;
    }
    expect([...edges.values()].every((n) => n === 2)).toBe(true);
    const voxels = model.mask.reduce((n, v) => n + v, 0);
    expect(volume / (voxels * 0.008)).toBeGreaterThan(0.9);
    expect(volume / (voxels * 0.008)).toBeLessThan(1.1);
  });

  it('turns inward-facing triangles outward', () => {
    // A tetrahedron with one face wound the wrong way.
    const corners = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const faces = [
      [0, 2, 1],
      [0, 1, 3],
      [0, 3, 2],
      [1, 3, 2],
    ];
    const stl = new Uint8Array(84 + faces.length * 50);
    const view = new DataView(stl.buffer);
    view.setUint32(80, faces.length, true);
    faces.forEach((f, t) =>
      f.forEach((c, k) =>
        corners[c].forEach((x, a) =>
          view.setFloat32(84 + t * 50 + 12 + k * 12 + a * 4, x, true),
        ),
      ),
    );
    const fixed = new DataView(orientStl(stl).buffer);
    let volume = 0;
    for (let t = 0; t < faces.length; t++) {
      const v = [0, 1, 2].map((k) =>
        [0, 1, 2].map((a) =>
          fixed.getFloat32(84 + t * 50 + 12 + k * 12 + a * 4, true),
        ),
      );
      const signed =
        v[0][0] * (v[1][1] * v[2][2] - v[1][2] * v[2][1]) +
        v[0][1] * (v[1][2] * v[2][0] - v[1][0] * v[2][2]) +
        v[0][2] * (v[1][0] * v[2][1] - v[1][1] * v[2][0]);
      volume += signed / 6;
      // The stored normal points away from the solid's centre.
      const centre = [0, 1, 2].map((a) => (v[0][a] + v[1][a] + v[2][a]) / 3);
      const normal = [0, 1, 2].map((a) =>
        fixed.getFloat32(84 + t * 50 + a * 4, true),
      );
      const out = centre.reduce((s, c, a) => s + (c - 0.25) * normal[a], 0);
      expect(out).toBeGreaterThan(0);
    }
    expect(volume).toBeCloseTo(1 / 6, 6);
  });
});

describe('biteContacts', () => {
  const shape: Vec3 = [30, 30, 40];
  function boxes(lowerTop: number, upperBottom: number) {
    const [w, h] = shape;
    const a = new Uint16Array(w * h * shape[2]),
      b = new Uint16Array(w * h * shape[2]);
    for (let z = 0; z < shape[2]; z++)
      for (let y = 10; y < 20; y++)
        for (let x = 10; x < 20; x++) {
          if (z >= upperBottom && z < upperBottom + 10)
            a[(z * h + y) * w + x] = 1;
          if (z <= lowerTop && z > lowerTop - 10) b[(z * h + y) * w + x] = 2;
        }
    const upper = { ...tooth(1, 11, 30), groupId: 'a' };
    const lower = { ...tooth(2, 41, 10), groupId: 'b' };
    return {
      labels: [
        { groupId: 'a', words: a },
        { groupId: 'b', words: b },
      ],
      teeth: [upper, lower],
    };
  }

  it('measures the area of teeth touching face to face', () => {
    const contacts = biteContacts({
      ...boxes(19, 20),
      shape,
      spacing: [0.2, 0.2, 0.2],
    });
    expect(contacts).toHaveLength(1);
    expect(contacts[0].upper).toBe('t1');
    expect(contacts[0].lower).toBe('t2');
    expect(Math.abs(contacts[0].contactAreaMm2 - 4) / 4).toBeLessThan(0.1);
    expect(contacts[0].minGapMm).toBe(0);
    expect(contacts[0].closeAreaMm2).toBeCloseTo(4, 6);
  });

  it('reports the gap of teeth 0.5 mm apart', () => {
    const contacts = biteContacts({
      ...boxes(17, 20),
      shape,
      spacing: [0.25, 0.25, 0.25],
    });
    expect(contacts).toHaveLength(1);
    expect(contacts[0].contactAreaMm2).toBe(0);
    expect(contacts[0].minGapMm).toBeCloseTo(0.5, 6);
    expect(contacts[0].closeAreaMm2).toBe(0);
  });

  it('leaves out teeth far apart', () => {
    expect(
      biteContacts({ ...boxes(10, 25), shape, spacing: [0.2, 0.2, 0.2] }),
    ).toHaveLength(0);
  });

  it('sorts unnumbered teeth into arches by height', () => {
    const { labels, teeth } = boxes(19, 20);
    const unnumbered = teeth.map((t) => ({ ...t, fdi: null }));
    const contacts = biteContacts({
      labels,
      teeth: unnumbered,
      shape,
      spacing: [0.2, 0.2, 0.2],
    });
    expect(contacts.map((c) => [c.upper, c.lower])).toEqual([['t1', 't2']]);
  });
});
