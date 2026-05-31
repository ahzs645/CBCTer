import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../types';
import { assignFdiNumbers, FDI_NUMBERING } from './fdiNumbering';

describe('FDI numbering', () => {
  it('has the full permanent dentition with correct anchor names', () => {
    expect(Object.keys(FDI_NUMBERING)).toHaveLength(32);
    expect(FDI_NUMBERING[11]).toBe('Upper Right Central Incisor');
    expect(FDI_NUMBERING[28]).toBe('Upper Left Third Molar');
    expect(FDI_NUMBERING[48]).toBe('Lower Right Third Molar');
  });

  it('numbers a synthetic upper arch from incisor to molar per quadrant', () => {
    // Half-arch positions [x, y] from central incisor (front, near midline) to
    // third molar (back, lateral). +x = patient left, +y = anterior.
    const halfArch: Array<[number, number]> = [
      [3, 12],
      [6, 11],
      [9, 9],
      [11, 6],
      [12.5, 3],
      [13.5, -1],
      [14, -5],
      [14, -9],
    ];
    const teeth: { position: Vec3 }[] = [];
    for (const [x, y] of halfArch) teeth.push({ position: [x, y, 0] }); // left
    for (const [x, y] of halfArch) teeth.push({ position: [-x, y, 0] }); // right

    const result = assignFdiNumbers(teeth, {
      jaw: 'upper',
      leftAxis: [1, 0, 0],
      anteriorAxis: [0, 1, 0],
    });

    // Left central incisor (index 0) → quadrant 2, position 1 → FDI 21.
    expect(result[0].fdi).toBe(21);
    expect(result[0].fdiName).toBe('Upper Left Central Incisor');
    // Left third molar (index 7) → FDI 28.
    expect(result[7].fdi).toBe(28);
    // Right central incisor (index 8) → quadrant 1 → FDI 11.
    expect(result[8].fdi).toBe(11);
    // Right third molar (index 15) → FDI 18.
    expect(result[15].fdi).toBe(18);

    // Every assigned number is unique and within 11–48.
    const numbers = result.map((tooth) => tooth.fdi);
    expect(new Set(numbers).size).toBe(numbers.length);
    numbers.forEach((n) => expect(n >= 11 && n <= 48).toBe(true));
  });

  it('switches quadrants for the lower jaw', () => {
    const result = assignFdiNumbers(
      [
        { position: [3, 12, 0] },
        { position: [-3, 12, 0] },
      ],
      { jaw: 'lower', leftAxis: [1, 0, 0], anteriorAxis: [0, 1, 0] },
    );
    expect(result[0].quadrant).toBe(3); // lower left
    expect(result[1].quadrant).toBe(4); // lower right
  });
});
