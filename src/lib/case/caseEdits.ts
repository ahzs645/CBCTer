import type { Vec3 } from '../../types';

/**
 * Corrections made to a streamed (read-only) case: kept on this device per
 * scan, and the small ones (numbering swap, merges) also carried in share
 * links, so whoever opens the link sees the same teeth.
 */
export interface AddedTooth {
  id: string;
  fdi: number | null;
  /** Box (voxels, scan frame) the mask covers. */
  start: Vec3;
  shape: Vec3;
  /** Run-length encoded 0/1 mask over the box (see growTooth.encodeMask). */
  runs: number[];
  voxels: number;
  centroid: Vec3;
  bounds: { min: Vec3; max: Vec3 };
}

export interface CaseEdits {
  /** Show left/right tooth numbers swapped (the model mirrored them). */
  swapSides?: boolean;
  /** Pairs of tooth ids shown and exported as one tooth. */
  mergedPairs?: Array<[string, string]>;
  /** Teeth the model missed, outlined by hand. */
  addedTeeth?: AddedTooth[];
  hiddenTeeth?: string[];
  toothColors?: Record<string, string>;
}

/** A stable key for a scan package: the hash of its voxel data. */
export function caseKey(volumeSha256: string, name: string) {
  return `${volumeSha256 || 'nohash'}:${name}`;
}

export function hasEdits(edits: CaseEdits) {
  return Boolean(
    edits.swapSides ||
    edits.mergedPairs?.length ||
    edits.addedTeeth?.length ||
    edits.hiddenTeeth?.length ||
    (edits.toothColors && Object.keys(edits.toothColors).length),
  );
}

function sanitize(value: unknown): CaseEdits {
  if (!value || typeof value !== 'object') return {};
  const v = value as Record<string, unknown>;
  const out: CaseEdits = {};
  if (v.swapSides === true) out.swapSides = true;
  if (Array.isArray(v.mergedPairs))
    out.mergedPairs = v.mergedPairs.filter(
      (p): p is [string, string] =>
        Array.isArray(p) &&
        p.length === 2 &&
        typeof p[0] === 'string' &&
        typeof p[1] === 'string',
    );
  if (Array.isArray(v.addedTeeth))
    out.addedTeeth = (v.addedTeeth as AddedTooth[]).filter(
      (t) =>
        t &&
        typeof t.id === 'string' &&
        Array.isArray(t.runs) &&
        Array.isArray(t.start) &&
        Array.isArray(t.shape),
    );
  if (Array.isArray(v.hiddenTeeth))
    out.hiddenTeeth = v.hiddenTeeth.filter((id) => typeof id === 'string');
  if (v.toothColors && typeof v.toothColors === 'object')
    out.toothColors = Object.fromEntries(
      Object.entries(v.toothColors as Record<string, unknown>).filter(
        ([, c]) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c),
      ),
    ) as Record<string, string>;
  return out;
}

export async function loadCaseEdits(key: string): Promise<CaseEdits> {
  try {
    const { db } = await import('../../local-dexie/db');
    const record = await db.caseEdits.get(key);
    return sanitize(record?.edits);
  } catch {
    return {};
  }
}

export async function saveCaseEdits(key: string, edits: CaseEdits) {
  const { db } = await import('../../local-dexie/db');
  if (!hasEdits(edits)) await db.caseEdits.delete(key);
  else await db.caseEdits.put({ key, updatedAt: Date.now(), edits });
}

/**
 * The share-link part of the edits: `swap=1` and `merge=a~b,c~d`. Hand-drawn
 * teeth are too large for a link and stay on the device.
 */
export function editsToLinkParams(edits: CaseEdits): Record<string, string> {
  const params: Record<string, string> = {};
  if (edits.swapSides) params.swap = '1';
  if (edits.mergedPairs?.length)
    params.merge = edits.mergedPairs.map(([a, b]) => `${a}~${b}`).join(',');
  return params;
}

export function editsFromLinkParams(params: URLSearchParams): CaseEdits {
  const edits: CaseEdits = {};
  if (params.get('swap') === '1') edits.swapSides = true;
  const merge = params.get('merge');
  if (merge)
    edits.mergedPairs = merge
      .split(',')
      .map((pair) => pair.split('~'))
      .filter(
        (pair): pair is [string, string] =>
          pair.length === 2 && !!pair[0] && !!pair[1],
      );
  return edits;
}

/**
 * Labels of hand-added teeth over a box (tooth k has value k + 1), so they
 * can be read like any other label layer. `masks` holds decoded masks by id.
 */
export function addedTeethRegion(
  teeth: AddedTooth[],
  masks: Map<string, Uint8Array>,
  start: Vec3,
  shape: Vec3,
): Uint16Array {
  const out = new Uint16Array(shape[0] * shape[1] * shape[2]);
  teeth.forEach((tooth, k) => {
    const mask = masks.get(tooth.id);
    if (!mask) return;
    const lo = [0, 1, 2].map((a) => Math.max(start[a], tooth.start[a]));
    const hi = [0, 1, 2].map((a) =>
      Math.min(start[a] + shape[a], tooth.start[a] + tooth.shape[a]),
    );
    if (lo.some((v, a) => v >= hi[a])) return;
    for (let z = lo[2]; z < hi[2]; z++)
      for (let y = lo[1]; y < hi[1]; y++) {
        const src =
          ((z - tooth.start[2]) * tooth.shape[1] + (y - tooth.start[1])) *
          tooth.shape[0];
        const dst = ((z - start[2]) * shape[1] + (y - start[1])) * shape[0];
        for (let x = lo[0]; x < hi[0]; x++)
          if (mask[src + x - tooth.start[0]]) out[dst + x - start[0]] = k + 1;
      }
  });
  return out;
}
