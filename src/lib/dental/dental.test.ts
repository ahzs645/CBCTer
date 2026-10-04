import { describe, expect, it } from 'vitest';
import type { StudyMeasurement } from '../../domain/types';
import {
  buildDentalReportHtml,
  escapeHtml,
  measurementSliceNumber,
  measurementsToCsv,
} from './report';
import {
  PERMANENT_CHART_ROWS,
  PRIMARY_CHART_ROWS,
  toggleToothCondition,
  upsertToothFinding,
} from './toothChart';
import {
  computeDentalWindowPresets,
  percentileOfSorted,
  sampleVoxelValues,
} from './windowPresets';

function fakeVolume(values: number[]) {
  return {
    voxels: Int16Array.from(values),
    meta: {
      scalarRange: [Math.min(...values), Math.max(...values)] as [number, number],
      initialWindowLevel: { window: 1000, level: 500 },
    },
  } as Parameters<typeof computeDentalWindowPresets>[0];
}

describe('dental window presets', () => {
  it('drops constant padding before taking percentiles', () => {
    const values = [
      ...Array.from({ length: 500 }, () => -1000),
      ...Array.from({ length: 1000 }, (_, index) => index),
    ];
    const sorted = sampleVoxelValues(Int16Array.from(values));
    expect(sorted[0]).toBe(0);
    expect(sorted.length).toBe(1000);
    expect(percentileOfSorted(sorted, 50)).toBeGreaterThanOrEqual(499);
    expect(percentileOfSorted(sorted, 50)).toBeLessThanOrEqual(500);
  });

  it('orders presets so teeth sit above bone and soft tissue below', () => {
    const values = Array.from({ length: 10_000 }, (_, index) => index);
    const presets = Object.fromEntries(
      computeDentalWindowPresets(fakeVolume(values)).map((preset) => [
        preset.id,
        preset.windowLevel,
      ]),
    );
    expect(presets.scan).toEqual({ window: 1000, level: 500 });
    // Auto spans the 2nd–99.9th percentile.
    expect(presets.auto.level - presets.auto.window / 2).toBeCloseTo(200, -1);
    expect(presets.auto.level + presets.auto.window / 2).toBeCloseTo(9990, -1);
    expect(presets.teeth.level).toBeGreaterThan(presets.bone.level);
    expect(presets.bone.level).toBeGreaterThan(presets.soft.level);
    expect(presets.metal.level).toBeGreaterThan(presets.teeth.level);
    for (const preset of Object.values(presets)) {
      expect(preset.window).toBeGreaterThan(0);
    }
  });
});

describe('tooth chart', () => {
  it('lays out 32 permanent and 20 primary teeth', () => {
    expect(new Set([...PERMANENT_CHART_ROWS.upper, ...PERMANENT_CHART_ROWS.lower]).size).toBe(32);
    expect(new Set([...PRIMARY_CHART_ROWS.upper, ...PRIMARY_CHART_ROWS.lower]).size).toBe(20);
    expect(PERMANENT_CHART_ROWS.upper[0]).toBe(18);
    expect(PERMANENT_CHART_ROWS.lower.at(-1)).toBe(38);
  });

  it('toggles conditions and removes findings that become empty', () => {
    let findings = toggleToothCondition([], 36, 'caries', 1);
    findings = toggleToothCondition(findings, 11, 'periapical', 2);
    expect(findings.map((finding) => finding.fdi)).toEqual([11, 36]);
    findings = toggleToothCondition(findings, 36, 'caries', 3);
    expect(findings.map((finding) => finding.fdi)).toEqual([11]);
  });

  it('keeps a bookmark-only finding', () => {
    const findings = upsertToothFinding([], 46, { point: [1, 2, 3] }, 5);
    expect(findings).toEqual([
      { fdi: 46, conditions: [], note: '', point: [1, 2, 3], updatedAt: 5 },
    ]);
    expect(upsertToothFinding(findings, 46, { point: undefined })).toEqual([]);
  });
});

describe('dental report', () => {
  const measurement: StudyMeasurement = {
    id: 'm1',
    studyId: 's1',
    kind: 'distance',
    name: 'Bone height, 36',
    points: [
      [10, 20, 30],
      [12, 22, 30],
    ],
    value: 11.234,
    unit: 'mm',
    plane: 'axial',
    visible: true,
    createdAt: 0,
    updatedAt: 0,
  };

  it('reports the slice the measurement was drawn on', () => {
    expect(measurementSliceNumber(measurement)).toBe(31);
    expect(measurementSliceNumber({ ...measurement, plane: 'coronal' })).toBe(21);
    expect(measurementSliceNumber({ ...measurement, plane: undefined })).toBeNull();
  });

  it('quotes CSV cells containing commas', () => {
    const csv = measurementsToCsv([measurement]).split('\n');
    expect(csv[0]).toBe('name,kind,value,unit,plane,slice,points_voxel,created');
    expect(csv[1].startsWith('"Bone height, 36",distance,11.234,mm,axial,31,')).toBe(true);
  });

  it('escapes user text in the HTML report', () => {
    expect(escapeHtml('<b>"x"</b>')).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
    const html = buildDentalReportHtml({
      title: 'Report',
      generatedAt: new Date(0),
      scan: { id: '<scan>', format: 'CT', dimensions: '1', voxelSize: '1' },
      snapshots: [],
      measurements: [],
      findings: [
        { fdi: 36, tooth: 'Lower Left First Molar', conditions: 'C', note: '<script>', bookmarked: true },
      ],
      caseNotes: 'Notes & plans',
      disclaimer: 'Reference only',
      labels: {
        scan: 'Scan', format: 'Format', dimensions: 'Dimensions', voxelSize: 'Voxel',
        generated: 'Generated', views: 'Views', measurements: 'Measurements',
        measurementName: 'Name', measurementValue: 'Value', measurementPlane: 'Plane',
        measurementSlice: 'Slice', noMeasurements: 'None', toothChart: 'Chart',
        tooth: 'Tooth', findings: 'Findings', note: 'Note', noFindings: 'None',
        caseNotes: 'Case notes', print: 'Print',
      },
    });
    expect(html).toContain('&lt;scan&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Notes &amp; plans');
    expect(html).toContain('<td colspan="4" class="empty">None</td>');
  });
});
