import type {
  StudyMeasurement,
  ToothFinding,
} from '../../domain/types';
import { encodeQr, qrToSvg } from '../share/qr';

/**
 * Plain-data builders for the dentist-facing exports: a measurement CSV and a
 * self-contained, printable HTML case report. Everything user-facing is passed
 * in already translated so this module stays i18n- and DOM-free (testable in
 * node).
 */

export interface ReportSnapshot {
  label: string;
  dataUrl: string;
}

export interface ReportMeasurementRow {
  name: string;
  value: string;
  plane: string;
  slice: string;
}

export interface ReportFindingRow {
  fdi: number;
  tooth: string;
  conditions: string;
  note: string;
  bookmarked: boolean;
}

export interface DentalReportInput {
  title: string;
  generatedAt: Date;
  scan: {
    id: string;
    format: string;
    dimensions: string;
    voxelSize: string;
  };
  snapshots: ReportSnapshot[];
  measurements: ReportMeasurementRow[];
  findings: ReportFindingRow[];
  caseNotes: string;
  disclaimer: string;
  /** Public CBCTer link to this case; adds a scannable QR block when set. */
  shareUrl?: string;
  labels: {
    scan: string;
    format: string;
    dimensions: string;
    voxelSize: string;
    generated: string;
    views: string;
    measurements: string;
    measurementName: string;
    measurementValue: string;
    measurementPlane: string;
    measurementSlice: string;
    noMeasurements: string;
    toothChart: string;
    tooth: string;
    findings: string;
    note: string;
    noFindings: string;
    caseNotes: string;
    print: string;
    /** Caption under the share QR code (defaults to English). */
    shareQr?: string;
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatMeasurementValue(
  measurement: Pick<StudyMeasurement, 'value' | 'unit'>,
): string {
  switch (measurement.unit) {
    case 'degrees':
      return `${measurement.value.toFixed(1)}°`;
    case 'mm2':
      return `${measurement.value.toFixed(1)} mm²`;
    case 'HU':
      return `${Math.round(measurement.value)} (mean value)`;
    default:
      return `${measurement.value.toFixed(1)} mm`;
  }
}

/** 1-based slice number of the plane a measurement was drawn on. */
export function measurementSliceNumber(
  measurement: Pick<StudyMeasurement, 'plane' | 'points'>,
): number | null {
  const point = measurement.points[0];
  if (!point || !measurement.plane) return null;
  const index =
    measurement.plane === 'axial'
      ? point[2]
      : measurement.plane === 'coronal'
        ? point[1]
        : point[0];
  return index + 1;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function measurementsToCsv(measurements: StudyMeasurement[]): string {
  const header = ['name', 'kind', 'value', 'unit', 'plane', 'slice', 'points_voxel', 'created'];
  const rows = measurements.map((measurement) => [
    measurement.name,
    measurement.kind,
    Number(measurement.value.toFixed(3)),
    measurement.unit,
    measurement.plane ?? '',
    measurementSliceNumber(measurement) ?? '',
    measurement.points.map((point) => point.join(' ')).join('; '),
    new Date(measurement.createdAt).toISOString(),
  ]);
  return [header, ...rows]
    .map((row) => row.map((cell) => csvCell(cell)).join(','))
    .join('\n');
}

export function toothFindingsToCsv(
  findings: ToothFinding[],
  describe: (finding: ToothFinding) => { tooth: string; conditions: string },
): string {
  const header = ['fdi', 'tooth', 'findings', 'note', 'bookmark_voxel'];
  const rows = findings.map((finding) => {
    const described = describe(finding);
    return [
      finding.fdi,
      described.tooth,
      described.conditions,
      finding.note,
      finding.point ? finding.point.join(' ') : '',
    ];
  });
  return [header, ...rows]
    .map((row) => row.map((cell) => csvCell(cell)).join(','))
    .join('\n');
}

const DEFAULT_SHARE_CAPTION = 'Scan with a phone to open this case in CBCTer';

/** QR code + caption + link block, or '' when there is no share URL. */
function shareBlockHtml(shareUrl: string | undefined, caption: string): string {
  const url = shareUrl?.trim();
  if (!url) return '';
  const e = escapeHtml;
  let qr = '';
  try {
    qr = `<div class="share-qr">${qrToSvg(encodeQr(url, 'M'), { moduleSize: 4, margin: 4, title: caption })}</div>`;
  } catch {
    // Too long for a QR code: still print the link itself.
  }
  // Only http(s) links become clickable; anything else is shown as text.
  const link = /^https?:\/\//i.test(url)
    ? `<a href="${e(url)}">${e(url)}</a>`
    : e(url);
  return `
  <section class="share">
    ${qr}
    <div class="share-text">
      <p class="share-caption">${e(caption)}</p>
      <p class="share-link">${link}</p>
    </div>
  </section>`;
}

export function buildDentalReportHtml(input: DentalReportInput): string {
  const { labels } = input;
  const e = escapeHtml;
  const snapshots = input.snapshots
    .map(
      (snapshot) => `
        <figure>
          <img src="${e(snapshot.dataUrl)}" alt="${e(snapshot.label)}" />
          <figcaption>${e(snapshot.label)}</figcaption>
        </figure>`,
    )
    .join('');
  const measurementRows = input.measurements.length
    ? input.measurements
        .map(
          (row) => `
          <tr>
            <td>${e(row.name)}</td>
            <td class="num">${e(row.value)}</td>
            <td>${e(row.plane)}</td>
            <td class="num">${e(row.slice)}</td>
          </tr>`,
        )
        .join('')
    : `<tr><td colspan="4" class="empty">${e(labels.noMeasurements)}</td></tr>`;
  const findingRows = input.findings.length
    ? input.findings
        .map(
          (row) => `
          <tr>
            <td class="num"><strong>${row.fdi}</strong>${row.bookmarked ? ' ◆' : ''}</td>
            <td>${e(row.tooth)}</td>
            <td>${e(row.conditions)}</td>
            <td>${e(row.note)}</td>
          </tr>`,
        )
        .join('')
    : `<tr><td colspan="4" class="empty">${e(labels.noFindings)}</td></tr>`;
  const share = shareBlockHtml(input.shareUrl, labels.shareQr ?? DEFAULT_SHARE_CAPTION);
  const notes = input.caseNotes.trim()
    ? `<section><h2>${e(labels.caseNotes)}</h2><p class="notes">${e(input.caseNotes.trim())}</p></section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${e(input.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px; background: #fff; color: #0f172a;
    font: 13px/1.45 "Segoe UI", system-ui, sans-serif; }
  main { max-width: 960px; margin: 0 auto; }
  header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px;
    border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; }
  h1 { margin: 0; font-size: 20px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .08em; color: #334155;
    margin: 20px 0 8px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 8px 0 0; }
  dt { color: #64748b; } dd { margin: 0; }
  .views { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; }
  figure { margin: 0; background: #000; border-radius: 4px; overflow: hidden; }
  figure img { display: block; width: 100%; height: auto; }
  figcaption { background: #0f172a; color: #e2e8f0; padding: 4px 8px; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 600; }
  td.num { white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.empty { color: #64748b; font-style: italic; }
  .notes { white-space: pre-wrap; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px; }
  .disclaimer { margin-top: 24px; padding: 8px 10px; border: 1px solid #f59e0b; background: #fffbeb;
    border-radius: 4px; color: #78350f; font-size: 12px; }
  .print { border: 1px solid #0f172a; background: #0f172a; color: #fff; border-radius: 4px;
    padding: 8px 14px; font: inherit; cursor: pointer; min-height: 40px; }
  .table-wrap { overflow-x: auto; }
  .share { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 0 0 16px;
    padding: 8px; border: 1px solid #e2e8f0; border-radius: 4px; }
  .share-text { flex: 1 1 200px; min-width: 0; }
  .share-qr { flex: 0 0 auto; line-height: 0; }
  .share-qr svg { display: block; width: 32mm; height: 32mm;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .share p { margin: 0 0 4px; }
  .share-caption { font-weight: 600; }
  .share-link { font-family: ui-monospace, monospace; font-size: 11px; color: #334155;
    word-break: break-all; overflow-wrap: anywhere; }
  .share-link a { color: inherit; }
  @media print {
    body { padding: 0; } .print { display: none; }
    section, figure, tr { break-inside: avoid; }
  }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>${e(input.title)}</h1>
      <dl>
        <dt>${e(labels.scan)}</dt><dd>${e(input.scan.id)}</dd>
        <dt>${e(labels.format)}</dt><dd>${e(input.scan.format)}</dd>
        <dt>${e(labels.dimensions)}</dt><dd>${e(input.scan.dimensions)}</dd>
        <dt>${e(labels.voxelSize)}</dt><dd>${e(input.scan.voxelSize)}</dd>
        <dt>${e(labels.generated)}</dt><dd>${e(input.generatedAt.toLocaleString())}</dd>
      </dl>
    </div>
    <div><button class="print" type="button" onclick="window.print()">${e(labels.print)}</button></div>
  </header>${share}
  ${snapshots ? `<section><h2>${e(labels.views)}</h2><div class="views">${snapshots}</div></section>` : ''}
  <section>
    <h2>${e(labels.measurements)}</h2>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>${e(labels.measurementName)}</th><th>${e(labels.measurementValue)}</th>
        <th>${e(labels.measurementPlane)}</th><th>${e(labels.measurementSlice)}</th>
      </tr></thead>
      <tbody>${measurementRows}</tbody>
    </table></div>
  </section>
  <section>
    <h2>${e(labels.toothChart)}</h2>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>FDI</th><th>${e(labels.tooth)}</th><th>${e(labels.findings)}</th><th>${e(labels.note)}</th>
      </tr></thead>
      <tbody>${findingRows}</tbody>
    </table></div>
  </section>
  ${notes}
  <p class="disclaimer">${e(input.disclaimer)}</p>
</main>
</body>
</html>`;
}
