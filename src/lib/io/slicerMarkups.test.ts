import { describe, expect, it } from 'vitest';
import {
  flipPointLpsRas,
  parseSlicerMarkups,
  serializeSlicerMarkups,
  type Landmark,
} from './slicerMarkups';

describe('slicer markups I/O', () => {
  const landmarks: Landmark[] = [
    { label: 'N', position: [1, 2, 3] },
    { label: 'Ba', position: [-4, 5, -6] },
  ];

  it('round-trips landmarks through serialise → parse', () => {
    const json = serializeSlicerMarkups(landmarks, { coordinateSystem: 'LPS' });
    const { landmarks: parsed, coordinateSystem } = parseSlicerMarkups(json);
    expect(coordinateSystem).toBe('LPS');
    expect(parsed).toHaveLength(2);
    expect(parsed[0].label).toBe('N');
    expect(parsed[0].position).toEqual([1, 2, 3]);
    expect(parsed[1].position).toEqual([-4, 5, -6]);
  });

  it('produces a schema-tagged Fiducial document', () => {
    const json = serializeSlicerMarkups(landmarks);
    const doc = JSON.parse(json);
    expect(doc['@schema']).toContain('markups-schema');
    expect(doc.markups[0].type).toBe('Fiducial');
    expect(doc.markups[0].controlPoints).toHaveLength(2);
  });

  it('converts LPS ↔ RAS on read when target system differs', () => {
    const lpsJson = serializeSlicerMarkups(landmarks, { coordinateSystem: 'LPS' });
    const { landmarks: ras } = parseSlicerMarkups(lpsJson, {
      targetSystem: 'RAS',
    });
    // RAS negates X and Y relative to LPS.
    expect(ras[0].position).toEqual(flipPointLpsRas([1, 2, 3]));
    expect(ras[0].position).toEqual([-1, -2, 3]);
  });

  it('reads control points from multiple markups in one file', () => {
    const doc = {
      markups: [
        {
          type: 'Fiducial',
          coordinateSystem: 'RAS',
          controlPoints: [{ label: 'A', position: [0, 0, 0] }],
        },
        {
          type: 'Fiducial',
          coordinateSystem: 'RAS',
          controlPoints: [{ label: 'B', position: [1, 1, 1] }],
        },
      ],
    };
    const { landmarks: parsed } = parseSlicerMarkups(doc);
    expect(parsed.map((p) => p.label)).toEqual(['A', 'B']);
  });
});
