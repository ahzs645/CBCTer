import { describe, expect, it } from 'vitest';
import {
  DENTAL_SEG_VARIANTS,
  UNIVERSAL_FDI_BY_VALUE,
  getDentalSegVariant,
} from './dentalSegVariants';

describe('dentalSegVariants', () => {
  it('exposes three variants with consistent class counts', () => {
    expect(getDentalSegVariant('full').classCount).toBe(6);
    expect(getDentalSegVariant('pediatric').classCount).toBe(6);
    expect(getDentalSegVariant('universal').classCount).toBe(56);
    expect(getDentalSegVariant('universal').labels).toHaveLength(55);
  });

  it('maps universal label values to the correct FDI numbers', () => {
    // Permanent upper: value 1 → 18 (UR third molar), 8 → 11, 9 → 21, 16 → 28.
    expect(UNIVERSAL_FDI_BY_VALUE[1]).toBe(18);
    expect(UNIVERSAL_FDI_BY_VALUE[8]).toBe(11);
    expect(UNIVERSAL_FDI_BY_VALUE[9]).toBe(21);
    expect(UNIVERSAL_FDI_BY_VALUE[16]).toBe(28);
    // Permanent lower: 17 → 38, 24 → 31, 25 → 41, 32 → 48.
    expect(UNIVERSAL_FDI_BY_VALUE[17]).toBe(38);
    expect(UNIVERSAL_FDI_BY_VALUE[24]).toBe(31);
    expect(UNIVERSAL_FDI_BY_VALUE[25]).toBe(41);
    expect(UNIVERSAL_FDI_BY_VALUE[32]).toBe(48);
    // Primary: 33 → 55, 52 → 85.
    expect(UNIVERSAL_FDI_BY_VALUE[33]).toBe(55);
    expect(UNIVERSAL_FDI_BY_VALUE[52]).toBe(85);
    // 52 tooth values total (no value beyond 52 is a tooth).
    expect(Object.keys(UNIVERSAL_FDI_BY_VALUE)).toHaveLength(52);
  });

  it('labels the three universal anatomical structures', () => {
    const labels = getDentalSegVariant('universal').labels;
    const byValue = new Map(labels.map((l) => [l.value, l]));
    expect(byValue.get(53)?.key).toBe('mandible');
    expect(byValue.get(54)?.key).toBe('upperSkull');
    expect(byValue.get(55)?.key).toBe('mandibularCanal');
    // Canal is the variant's canalLabel (skipped in cleanup).
    expect(getDentalSegVariant('universal').canalLabel).toBe(55);
  });

  it('gives every label a valid hex color and a human-readable name', () => {
    for (const label of getDentalSegVariant('universal').labels) {
      expect(label.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(label.name.length).toBeGreaterThan(0);
    }
    // Spot-check an FDI display name.
    const central = getDentalSegVariant('universal').labels.find(
      (l) => l.key === 'tooth-11',
    );
    expect(central?.name).toContain('11');
    expect(central?.name).toContain('Central Incisor');
  });

  it('every variant points at a distinct ONNX file', () => {
    const files = Object.values(DENTAL_SEG_VARIANTS).map((v) => v.modelFile);
    expect(new Set(files).size).toBe(files.length);
  });
});
