import { AsyncZipDeflate, Zip } from 'fflate';
import type { Vec3 } from '../../types';
import { maskToSurface, orientMesh } from '../surface/maskSurface';
import {
  DEFAULT_MAX_ERROR_MM,
  DEFAULT_TARGET_RATIO,
  indexedToStl,
  simplifyClosedMesh,
  type IndexedMesh,
} from '../surface/simplifyClosed';
import {
  archModelMesh,
  biteContacts,
  type ArchModelOptions,
} from './archModel';
import { meshToBinaryStl, type TriMesh } from '../ios/meshIo';
import {
  crownDirectionFor,
  estimateGumline,
  selectionBounds,
  toothLabel,
  toothMask,
  toothValues,
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
  /** Also write one printable model: the crowns joined on a horseshoe base. */
  archModel?: boolean;
  /** Base height of the printable model, mm. */
  baseHeightMm?: number;
  /** Simplify the closed surfaces (sub-voxel error) for smaller files. */
  smaller?: boolean;
  /** An intraoral scan aligned to these crowns, to ship alongside them. */
  intraoral?: { crowns: TriMesh; note: string };
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

/** One tooth's crop and how to cut it; plain data so it can go to a worker. */
export interface ToothPartInput {
  scan: ArrayLike<number>;
  labels: Uint16Array;
  shape: Vec3;
  start: Vec3;
  spacing: Vec3;
  values: number[];
  crownDirection: 1 | -1;
  crownOnly: boolean;
  gumOffsetMm: number;
  /** Simplify the closed surface to save space (sub-voxel error). */
  smaller?: boolean;
}

export interface ToothPartResult {
  /** Oriented binary STL, or null when the tooth has no voxels. */
  stl: Uint8Array | null;
  /** Gumline (absolute z index) when the crown was cut. */
  cut: { gumline: number; crownDirection: 1 | -1; measured: boolean } | null;
}

/** Mesh one tooth (or its crown above the estimated gumline). */
export async function meshToothPart(
  input: ToothPartInput,
): Promise<ToothPartResult> {
  const { shape, start, spacing } = input;
  let estimate: GumlineEstimate | null = null;
  if (input.crownOnly)
    estimate = estimateGumline({
      scan: input.scan,
      labels: input.labels,
      shape,
      spacing,
      value: input.values,
      crownDirection: input.crownDirection,
      gumOffsetMm: input.gumOffsetMm,
    });
  const { mask, voxels } = toothMask(
    input.labels,
    shape,
    input.values,
    estimate ?? undefined,
  );
  const cut = estimate
    ? {
        gumline: estimate.gumline + start[2],
        crownDirection: estimate.crownDirection,
        measured: estimate.measured,
      }
    : null;
  if (!voxels) return { stl: null, cut };
  const mesh = maskToSurface(mask, shape, spacing, start, 8);
  orientMesh(mesh);
  return {
    stl: indexedToStl(input.smaller ? shrink(mesh, spacing) : mesh),
    cut,
  };
}

/** The printable arch model's STL, optionally simplified. */
export async function archModelPart(
  options: ArchModelOptions & { smaller?: boolean },
): Promise<Uint8Array> {
  const mesh = archModelMesh(options);
  return indexedToStl(options.smaller ? shrink(mesh, options.spacing) : mesh);
}

/**
 * Simplify a closed, oriented surface (it stays closed and printable). The
 * error bound is a fraction of the voxel size, so detail the scan resolves
 * is kept.
 */
function shrink(mesh: IndexedMesh, spacing: Vec3): IndexedMesh {
  return simplifyClosedMesh(mesh, {
    targetRatio: DEFAULT_TARGET_RATIO,
    maxErrorMm: Math.max(DEFAULT_MAX_ERROR_MM, 0.3 * Math.min(...spacing)),
  });
}

/** Where the heavy steps run: in this thread by default, or a worker. */
export interface ToothExportCompute {
  part: (input: ToothPartInput) => Promise<ToothPartResult>;
  arch: (
    options: ArchModelOptions & { smaller?: boolean },
  ) => Promise<Uint8Array>;
}

const localCompute: ToothExportCompute = {
  part: meshToothPart,
  arch: archModelPart,
};

/**
 * Writes a ZIP as it goes: each file is compressed as soon as it exists, so
 * the whole archive is never held twice in memory.
 */
class StreamingZip {
  private chunks: Uint8Array[] = [];
  private zip: Zip;
  private done: Promise<void>;
  constructor() {
    let finish!: () => void, fail!: (error: Error) => void;
    this.done = new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    this.zip = new Zip((error, chunk, final) => {
      if (error) return fail(error);
      this.chunks.push(chunk);
      if (final) finish();
    });
  }
  /** `keep`: the caller still needs `data` (compression takes ownership). */
  add(name: string, data: Uint8Array, keep = false) {
    this.addParts(name, [data], keep);
  }
  addParts(name: string, parts: Uint8Array[], keep = false) {
    // Compression runs off the main thread and detaches what it is given.
    const file = new AsyncZipDeflate(name, { level: 6 });
    this.zip.add(file);
    if (!parts.length) file.push(new Uint8Array(0), true);
    parts.forEach((part, i) =>
      file.push(keep ? part.slice() : part, i === parts.length - 1),
    );
  }
  async finish(): Promise<Blob> {
    this.zip.end();
    await this.done;
    return new Blob(this.chunks as Uint8Array<ArrayBuffer>[], {
      type: 'application/zip',
    });
  }
}

/** A binary STL header for `count` triangles, to stream parts after it. */
function stlHeader(count: number) {
  const header = new Uint8Array(84);
  header.set(new TextEncoder().encode('CBCTer combined teeth'));
  new DataView(header.buffer).setUint32(80, count, true);
  return header;
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
  compute?: ToothExportCompute;
  /** Labels only, for the box around all teeth (saves reading the scan). */
  readLabels?: (groupId: string, start: Vec3, shape: Vec3) => Promise<Uint16Array>;
}): Promise<{ zip: Blob; reports: ToothModelReport[] }> {
  const { teeth, dims, spacing, model } = options;
  const compute = options.compute ?? localCompute;
  if (!teeth.length) throw new Error('Choose at least one tooth to export.');
  const zip = new StreamingZip();
  const crownCuts = new Map<
    string,
    { gumline: number; crownDirection: 1 | -1 }
  >();
  const parts: Uint8Array[] = [];
  const reports: ToothModelReport[] = [];
  for (const [index, tooth] of teeth.entries()) {
    const box = selectionBounds([tooth], dims, 6)!;
    const crop = await options.read(tooth.groupId, box.start, box.shape);
    const { stl, cut } = await compute.part({
      scan: crop.scan,
      labels: crop.labels,
      shape: box.shape,
      start: box.start,
      spacing,
      values: toothValues(tooth),
      crownDirection: crownDirectionFor(
        tooth,
        options.allTeeth,
        model.superiorSign ?? 1,
      ),
      crownOnly: model.crownOnly,
      gumOffsetMm: model.gumOffsetMm,
      smaller: model.smaller,
    });
    if (cut)
      crownCuts.set(tooth.id, {
        gumline: cut.gumline,
        crownDirection: cut.crownDirection,
      });
    options.onProgress?.(index + 1, teeth.length);
    if (!stl) continue;
    const name = toothLabel(tooth, index).toLowerCase().replace(/\s+/g, '-');
    const file = `teeth/${name}${model.crownOnly ? '-crown' : ''}.stl`;
    zip.add(file, stl, true);
    parts.push(stl);
    const tip = cut
      ? cut.crownDirection === 1
        ? tooth.bounds.max[2]
        : tooth.bounds.min[2]
      : null;
    reports.push({
      tooth: toothLabel(tooth, index),
      fdi: tooth.fdi,
      file,
      triangles: triangles(stl),
      ...(cut && tip !== null
        ? {
            crownHeightMm:
              Math.round(Math.abs(tip - cut.gumline) * spacing[2] * 10) / 10,
            gumlineMeasured: cut.measured,
          }
        : {}),
    });
  }
  if (!parts.length) throw new Error('The chosen teeth have no voxels.');
  const combined = model.crownOnly
    ? 'crowns-combined.stl'
    : 'teeth-combined.stl';
  // The combined file streams the per-tooth triangles after one header.
  zip.addParts(combined, [
    stlHeader(parts.reduce((n, stl) => n + triangles(stl), 0)),
    ...parts.map((stl) => stl.slice(84)),
  ]);
  parts.length = 0;
  const extra: string[] = [];
  // One crop over all chosen teeth for the bite check and the printable model.
  // The arch model grows its own box for the base, so a small pad is enough.
  // Very large selections can still exceed one read; those steps are then
  // skipped with a note rather than failing the whole export.
  const union = selectionBounds(teeth, dims, 8)!;
  const groupIds = [...new Set(teeth.map((t) => t.groupId))];
  let unionLabels: { groupId: string; words: Uint16Array }[] | null = null;
  try {
    unionLabels = await Promise.all(
      groupIds.map(async (groupId) => ({
        groupId,
        words: options.readLabels
          ? await options.readLabels(groupId, union.start, union.shape)
          : (await options.read(groupId, union.start, union.shape)).labels,
      })),
    );
  } catch (error) {
    extra.push(
      `Bite check${model.archModel && model.crownOnly ? ' and printable model' : ''} skipped: ${errorText(error)} Choose fewer teeth to include them.`,
    );
  }
  if (unionLabels) {
    const contacts = biteContacts({
      labels: unionLabels,
      shape: union.shape,
      spacing,
      teeth,
      superiorSign: model.superiorSign ?? 1,
    });
    extra.push(
      contacts.length
        ? `Bite: ${contacts.length} upper/lower pair(s) within 1 mm — the scan was taken with teeth close or touching; biting edges may be merged or clipped there.`
        : 'Bite: no upper and lower teeth within 1 mm of each other in this selection.',
    );
  }
  if (model.intraoral?.crowns.indices.length) {
    zip.add('intraoral-crowns.stl', meshToBinaryStl(model.intraoral.crowns));
    extra.push(`intraoral-crowns.stl: ${model.intraoral.note}`);
  }
  if (unionLabels && model.archModel && model.crownOnly) {
    const crowns = new Map(
      [...crownCuts].map(([id, cut]) => [
        id,
        {
          gumline: cut.gumline - union.start[2],
          crownDirection: cut.crownDirection,
        },
      ]),
    );
    try {
      zip.add(
        'arch-model.stl',
        await compute.arch({
        labels: unionLabels,
        shape: union.shape,
        start: union.start,
        spacing,
        teeth: teeth.filter((t) => crowns.has(t.id)),
        crowns,
        baseHeightMm: model.baseHeightMm ?? 8,
        smaller: model.smaller,
        }),
      );
      extra.push(
        `arch-model.stl: the crowns joined on a ${model.baseHeightMm ?? 8} mm horseshoe base, one closed printable piece. The base top follows each tooth's estimated gumline in flat steps; it is not a gum contour.`,
      );
    } catch (error) {
      extra.push(`Printable model skipped: ${errorText(error)}`);
    }
  }
  zip.add(
    'README.txt',
    new TextEncoder().encode(
      readme(options.scanName, model, spacing, reports, combined, extra),
    ),
  );
  return { zip: await zip.finish(), reports };
}

function readme(
  scanName: string,
  model: ToothModelOptions,
  spacing: Vec3,
  reports: ToothModelReport[],
  combined: string,
  extra: string[] = [],
) {
  const lines = [
    `CBCTer tooth model export — ${scanName}`,
    `Created ${new Date().toISOString()}`,
    '',
    `Files: ${combined} (all teeth in one file) and teeth/*.stl (one per tooth).`,
    'Units: millimetres, in the scan coordinate frame (teeth keep their arch positions).',
    `Voxel size: ${spacing.map((s) => s.toFixed(3)).join(' × ')} mm.`,
    ...(model.smaller
      ? [
          `Surfaces simplified to about a tenth of the triangles; they stay closed and within ${Math.max(0.05, 0.3 * Math.min(...spacing)).toFixed(2)} mm of the unsimplified surface.`,
        ]
      : []),
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
    ...(extra.length ? ['', ...extra] : []),
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

function errorText(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
