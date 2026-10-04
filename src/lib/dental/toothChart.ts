import type { ToothCondition, ToothFinding } from '../../domain/types';
import { fdiToothName } from '../segmentation/fdiNumbering';

/**
 * Odontogram layout in the conventional dental-chart orientation: the
 * patient's right is on the viewer's left, upper arch on top.
 */
export const PERMANENT_CHART_ROWS: { upper: number[]; lower: number[] } = {
  upper: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  lower: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
};

export const PRIMARY_CHART_ROWS: { upper: number[]; lower: number[] } = {
  upper: [55, 54, 53, 52, 51, 61, 62, 63, 64, 65],
  lower: [85, 84, 83, 82, 81, 71, 72, 73, 74, 75],
};

export interface ToothConditionDefinition {
  id: ToothCondition;
  /** Short chart code, printed on the tooth cell and in the report. */
  code: string;
  color: string;
}

export const TOOTH_CONDITIONS: ToothConditionDefinition[] = [
  { id: 'caries', code: 'C', color: '#f97316' },
  { id: 'periapical', code: 'PA', color: '#ef4444' },
  { id: 'rootCanal', code: 'RCT', color: '#a855f7' },
  { id: 'restoration', code: 'R', color: '#38bdf8' },
  { id: 'implant', code: 'I', color: '#94a3b8' },
  { id: 'missing', code: 'M', color: '#64748b' },
  { id: 'impacted', code: 'IMP', color: '#eab308' },
  { id: 'boneLoss', code: 'BL', color: '#f43f5e' },
  { id: 'fracture', code: 'FX', color: '#fb7185' },
  { id: 'resorption', code: 'RS', color: '#facc15' },
  { id: 'other', code: '?', color: '#22d3ee' },
];

const CONDITION_BY_ID = new Map(
  TOOTH_CONDITIONS.map((condition) => [condition.id, condition]),
);

export function toothConditionDefinition(
  id: ToothCondition,
): ToothConditionDefinition {
  return CONDITION_BY_ID.get(id) ?? TOOTH_CONDITIONS[TOOTH_CONDITIONS.length - 1];
}

export function toothName(fdi: number): string {
  return fdiToothName(fdi);
}

export function isPrimaryTooth(fdi: number): boolean {
  const quadrant = Math.floor(fdi / 10);
  return quadrant >= 5 && quadrant <= 8;
}

/** A finding with no conditions, no note, and no bookmark carries nothing. */
export function isEmptyFinding(finding: ToothFinding): boolean {
  return (
    finding.conditions.length === 0 &&
    finding.note.trim().length === 0 &&
    !finding.point
  );
}

/**
 * Apply a patch to the finding for `fdi`, creating it if needed and dropping
 * it once it becomes empty. Findings stay sorted by FDI number.
 */
export function upsertToothFinding(
  findings: ToothFinding[],
  fdi: number,
  patch: Partial<Omit<ToothFinding, 'fdi' | 'updatedAt'>>,
  now = Date.now(),
): ToothFinding[] {
  const existing = findings.find((finding) => finding.fdi === fdi);
  const next: ToothFinding = {
    fdi,
    conditions: existing?.conditions ?? [],
    note: existing?.note ?? '',
    point: existing?.point,
    ...patch,
    updatedAt: now,
  };
  const others = findings.filter((finding) => finding.fdi !== fdi);
  if (isEmptyFinding(next)) return others;
  return [...others, next].sort((left, right) => left.fdi - right.fdi);
}

export function toggleToothCondition(
  findings: ToothFinding[],
  fdi: number,
  condition: ToothCondition,
  now = Date.now(),
): ToothFinding[] {
  const current =
    findings.find((finding) => finding.fdi === fdi)?.conditions ?? [];
  const conditions = current.includes(condition)
    ? current.filter((item) => item !== condition)
    : [...current, condition];
  return upsertToothFinding(findings, fdi, { conditions }, now);
}

export function summarizeFinding(finding: ToothFinding): string {
  const codes = finding.conditions
    .map((condition) => toothConditionDefinition(condition).code)
    .join(', ');
  return [codes, finding.note.trim()].filter(Boolean).join(' — ');
}
