import {
  formatVolume,
  type SegmentationManifest,
  toothVolumeMm3,
} from './types';

export interface ToothReportMeta {
  scanId?: string;
  sourceLabel?: string;
  algorithm?: string;
  dimensions?: [number, number, number];
  spacing?: [number, number, number];
}

function resolveSpacing(
  manifest: SegmentationManifest,
  meta: ToothReportMeta,
): [number, number, number] | undefined {
  return meta.spacing ?? manifest.spacing;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Clinical-style HTML summary of the separated teeth (reference only). */
export function buildToothReportHtml(
  manifest: SegmentationManifest,
  meta: ToothReportMeta = {},
): string {
  const spacing = resolveSpacing(manifest, meta);
  const generated = new Date().toLocaleString();
  const rows = manifest.items
    .map((item) => {
      const volume = spacing
        ? formatVolume(toothVolumeMm3(item.assignedVoxels, spacing))
        : '—';
      const status = item.qualityStatus ?? 'accepted';
      const reasons = item.qualityReasons?.length
        ? escapeHtml(item.qualityReasons.join(', '))
        : '';
      const fdi = item.fdi
        ? `${item.fdi}${item.fdiName ? ` ${escapeHtml(item.fdiName)}` : ''}`
        : '—';
      return `<tr>
        <td>${item.label}</td>
        <td>${fdi}</td>
        <td>${item.assignedVoxels.toLocaleString()}</td>
        <td>${volume}</td>
        <td>${item.centroidZYX.map((v) => Math.round(v)).join(', ')}</td>
        <td class="status ${status}">${status}</td>
        <td>${reasons}</td>
      </tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>CBCTer tooth report${meta.scanId ? ` — ${escapeHtml(meta.scanId)}` : ''}</title>
<style>
  body { font: 14px -apple-system, Segoe UI, sans-serif; color: #0f172a; margin: 2rem; }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  .meta { color: #475569; font-size: 12px; margin-bottom: 1rem; }
  .disclaimer { background: #fef3c7; border: 1px solid #f59e0b; color: #92400e;
    padding: .6rem .8rem; border-radius: 6px; font-size: 12px; margin-bottom: 1rem; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
  th { background: #f1f5f9; }
  .status.review { color: #b45309; font-weight: 600; }
  .status.accepted { color: #047857; }
  .summary { margin: 0 0 1rem; }
</style>
</head>
<body>
  <h1>CBCTer — Tooth separation report</h1>
  <div class="meta">
    ${meta.scanId ? `Scan: ${escapeHtml(meta.scanId)}<br/>` : ''}
    ${meta.sourceLabel ? `Source: ${escapeHtml(meta.sourceLabel)}<br/>` : ''}
    ${meta.algorithm ? `Method: ${escapeHtml(meta.algorithm)}<br/>` : ''}
    ${meta.dimensions ? `Dimensions: ${meta.dimensions.join(' × ')} voxels<br/>` : ''}
    ${spacing ? `Spacing: ${spacing.map((v) => v.toFixed(3)).join(' × ')} mm<br/>` : ''}
    Generated: ${generated}
  </div>
  <div class="disclaimer">
    Reference only. Not for diagnosis, treatment planning, measurements, or implant workflows.
  </div>
  <p class="summary">
    <strong>${manifest.items.length}</strong> separated teeth ·
    <strong>${manifest.acceptedInstances}</strong> accepted ·
    <strong>${manifest.candidateCount}</strong> candidates
    ${spacing ? ` · total tooth volume ${formatVolume(manifest.items.reduce((sum, item) => sum + toothVolumeMm3(item.assignedVoxels, spacing), 0))}` : ''}
  </p>
  <table>
    <thead>
      <tr><th>Label</th><th>FDI</th><th>Voxels</th><th>Volume</th><th>Centroid (z, y, x)</th><th>Quality</th><th>Notes</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`;
}

/** CSV of the separated teeth (one row per tooth). */
export function buildToothCsv(
  manifest: SegmentationManifest,
  meta: ToothReportMeta = {},
): string {
  const spacing = resolveSpacing(manifest, meta);
  const header = [
    'label',
    'fdi',
    'fdi_name',
    'voxels',
    'volume_mm3',
    'centroid_z',
    'centroid_y',
    'centroid_x',
    'quality',
    'notes',
  ];
  const lines = manifest.items.map((item) => {
    const volume = spacing
      ? toothVolumeMm3(item.assignedVoxels, spacing).toFixed(1)
      : '';
    const notes = (item.qualityReasons ?? []).join('; ').replace(/"/g, "'");
    return [
      item.label,
      item.fdi ?? '',
      `"${(item.fdiName ?? '').replace(/"/g, "'")}"`,
      item.assignedVoxels,
      volume,
      Math.round(item.centroidZYX[0]),
      Math.round(item.centroidZYX[1]),
      Math.round(item.centroidZYX[2]),
      item.qualityStatus ?? 'accepted',
      `"${notes}"`,
    ].join(',');
  });
  return [header.join(','), ...lines].join('\n');
}
