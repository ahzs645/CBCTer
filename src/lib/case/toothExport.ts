import { zipSync } from 'fflate';
import type { Vec3 } from '../../types';
import { maskToBinaryStl } from '../segmentation/maskMesh';
import {
  concatBinaryStl,
  crownDirectionFor,
  estimateGumline,
  selectionBounds,
  toothLabel,
  toothMask,
  type GumlineEstimate,
} from './toothSelection';
import type { ToothInstance } from './types';

/** Reads a scan crop and the label crop of one tooth group, x-fastest. */
export type ToothCropReader = (
  groupId: string,
  start: Vec3,
  shape: Vec3,
) => Promise<{ scan: ArrayLike<number>; labels: Uint16Array }>;

export interface ToothModelOptions {
  /** Keep only the crown above the estimated gumline. */
  crownOnly: boolean;
  /** Gingival margin distance crownward from the bone crest, in mm. */
  gumOffsetMm: number;
  /** Which way "superior" runs along the axial index (+1 = increasing). */
  superiorSign?: 1 | -1;
}

export interface ToothModelReport {
  tooth: string;
  fdi: number | null;
  file: string;
  triangles: number;
  crownHeightMm?: number;
  gumlineMeasured?: boolean;
}

function triangles(stl: Uint8Array) {
  return stl.byteLength >= 84
    ? new DataView(stl.buffer, stl.byteOffset, stl.byteLength).getUint32(
        80,
        true,
      )
    : 0;
}

/**
 * Builds a ZIP of STL surfaces (millimetres, scan frame) for the chosen teeth:
 * one file per tooth, one combined file, and a README that states how the
 * model was made and what it cannot be trusted for.
 */
export async function buildToothModelZip(options: {
  teeth: ToothInstance[];
  allTeeth: ToothInstance[];
  dims: Vec3;
  spacing: Vec3;
  read: ToothCropReader;
  model: ToothModelOptions;
  scanName: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ zip: Uint8Array; reports: ToothModelReport[] }> {
  const { teeth, dims, spacing, model } = options;
  if (!teeth.length) throw new Error('Choose at least one tooth to export.');
  const files: Record<string, Uint8Array> = {};
  const parts: Uint8Array[] = [];
  const reports: ToothModelReport[] = [];
  for (const [index, tooth] of teeth.entries()) {
    const box = selectionBounds([tooth], dims, 6)!;
    const crop = await options.read(tooth.groupId, box.start, box.shape);
    let estimate: GumlineEstimate | null = null;
    if (model.crownOnly) {
      estimate = estimateGumline({
        scan: crop.scan,
        labels: crop.labels,
        shape: box.shape,
        spacing,
        value: tooth.value,
        crownDirection: crownDirectionFor(
          tooth,
          options.allTeeth,
          model.superiorSign ?? 1,
        ),
        gumOffsetMm: model.gumOffsetMm,
      });
    }
    const { mask, voxels } = toothMask(
      crop.labels,
      box.shape,
      tooth.value,
      estimate ?? undefined,
    );
    options.onProgress?.(index + 1, teeth.length);
    if (!voxels) continue;
    const stl = new Uint8Array(
      await maskToBinaryStl(
        mask,
        [box.shape[2], box.shape[1], box.shape[0]],
        spacing,
        box.start,
        1,
        { extraction: 'iso', smoothIterations: 8, decimateReduction: 0.2 },
      ).arrayBuffer(),
    );
    const name = toothLabel(tooth, index).toLowerCase().replace(/\s+/g, '-');
    const file = `teeth/${name}${model.crownOnly ? '-crown' : ''}.stl`;
    files[file] = stl;
    parts.push(stl);
    const tipIndex =
      estimate &&
      (estimate.crownDirection === 1
        ? tooth.bounds.max[2] - box.start[2]
        : tooth.bounds.min[2] - box.start[2]);
    reports.push({
      tooth: toothLabel(tooth, index),
      fdi: tooth.fdi,
      file,
      triangles: triangles(stl),
      ...(estimate && tipIndex !== null
        ? {
            crownHeightMm:
              Math.round(
                Math.abs(tipIndex - estimate.gumline) * spacing[2] * 10,
              ) / 10,
            gumlineMeasured: estimate.measured,
          }
        : {}),
    });
  }
  if (!parts.length) throw new Error('The chosen teeth have no voxels.');
  const combined = model.crownOnly
    ? 'crowns-combined.stl'
    : 'teeth-combined.stl';
  files[combined] = concatBinaryStl(parts);
  files['README.txt'] = new TextEncoder().encode(
    readme(options.scanName, model, spacing, reports, combined),
  );
  return { zip: zipSync(files, { level: 6 }), reports };
}

function readme(
  scanName: string,
  model: ToothModelOptions,
  spacing: Vec3,
  reports: ToothModelReport[],
  combined: string,
) {
  const lines = [
    `CBCTer tooth model export — ${scanName}`,
    `Created ${new Date().toISOString()}`,
    '',
    `Files: ${combined} (all teeth in one file) and teeth/*.stl (one per tooth).`,
    'Units: millimetres, in the scan coordinate frame (teeth keep their arch positions).',
    `Voxel size: ${spacing.map((s) => s.toFixed(3)).join(' × ')} mm.`,
    model.crownOnly
      ? `Cut: crowns above an ESTIMATED gumline, ${model.gumOffsetMm} mm crownward of the detected bone crest.`
      : 'Cut: whole teeth, crowns and roots.',
    '',
    'Teeth:',
    ...reports.map(
      (r) =>
        `  ${r.tooth}: ${r.file}, ${r.triangles} triangles` +
        (r.crownHeightMm !== undefined
          ? `, crown ${r.crownHeightMm} mm${r.gumlineMeasured ? '' : ' (gumline guessed: no bone contact found)'}`
          : ''),
    ),
    '',
    'READ BEFORE USING FOR AN APPLIANCE',
    '- Reference only. Tooth outlines come from an AI proposal and are not a clinical record.',
    '- CBCT shows gums poorly. The gumline here is inferred from bone, not seen.',
    '- CBCT crown surfaces are typically 0.1–0.25 mm less accurate than an intraoral',
    '  scan, and edges, contacts and undercuts are blunted by the voxel size.',
    '- Scans taken with teeth closed fuse upper and lower biting surfaces; metal',
    '  (fillings, bonded retainer wire) causes streaks that distort nearby surfaces.',
    '- Teeth can move after the scan date. A retainer made from this model may not fit.',
    '- For a replacement retainer, ask your orthodontist or lab to verify fit or take a',
    '  new intraoral scan. This model is a fallback to show them, not a substitute.',
  ];
  return lines.join('\n') + '\n';
}
