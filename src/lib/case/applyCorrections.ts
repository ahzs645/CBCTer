import type { Vec3 } from '../../types';
import { decodeMask } from '../dental/growTooth';
import type { CaseEdits } from './caseEdits';
import { mirrorFdi } from './toothSelection';
import { summarizeTeeth } from './teeth';
import type { ToothInstance } from './types';

/**
 * Bake corrections made in the streamed viewer (numbering swap, merged split
 * teeth, hand-added teeth) into full-volume label grids and tooth instances,
 * so opening the full editor keeps them. Label grids are x-fastest over the
 * whole scan, one per tooth group; changed grids are returned as copies.
 */
export function applyStreamedCorrections(options: {
  instances: ToothInstance[];
  labels: Record<string, Uint16Array>;
  dims: Vec3;
  edits: CaseEdits;
}): {
  instances: ToothInstance[];
  labels: Record<string, Uint16Array>;
  changedGroups: string[];
  /** Label values added per group, with the FDI number each belongs to. */
  added: Array<{ groupId: string; value: number; fdi: number | null }>;
} {
  const { dims, edits } = options;
  const labels: Record<string, Uint16Array> = { ...options.labels };
  const changed = new Set<string>();
  const writable = (groupId: string) => {
    if (!changed.has(groupId)) {
      labels[groupId] = new Uint16Array(labels[groupId]);
      changed.add(groupId);
    }
    return labels[groupId];
  };
  let instances = options.instances.map((tooth) => ({ ...tooth }));

  // Merges: the part with the lower FDI number keeps its identity.
  for (const [aId, bId] of edits.mergedPairs ?? []) {
    const a = instances.find((t) => t.id === aId),
      b = instances.find((t) => t.id === bId);
    if (!a || !b || a.groupId !== b.groupId || !labels[a.groupId]) continue;
    const [keep, drop] = (a.fdi ?? 99) <= (b.fdi ?? 99) ? [a, b] : [b, a];
    const grid = writable(keep.groupId);
    for (let i = 0; i < grid.length; i++)
      if (grid[i] === drop.value) grid[i] = keep.value;
    keep.parentIds = [keep.id, drop.id];
    keep.review = 'corrected';
    instances = instances.filter((t) => t !== drop);
  }

  // Hand-added teeth go into the main tooth group with fresh label values.
  const added: Array<{ groupId: string; value: number; fdi: number | null }> =
    [];
  const target = instances[0]?.groupId;
  if (edits.addedTeeth?.length && target && labels[target]) {
    const grid = writable(target);
    // Voxels of listed teeth are off limits, as in the streamed viewer;
    // label values no tooth uses (leftovers) can be claimed.
    const owned = new Set(
      instances.filter((t) => t.groupId === target).map((t) => t.value),
    );
    let next = 1;
    for (let i = 0; i < grid.length; i++)
      if (grid[i] >= next) next = grid[i] + 1;
    const plane = dims[0] * dims[1];
    for (const tooth of edits.addedTeeth) {
      if (next > 65535) break;
      const mask = decodeMask(
        tooth.runs,
        tooth.shape[0] * tooth.shape[1] * tooth.shape[2],
      );
      let wrote = 0;
      for (let z = 0; z < tooth.shape[2]; z++)
        for (let y = 0; y < tooth.shape[1]; y++)
          for (let x = 0; x < tooth.shape[0]; x++) {
            if (!mask[(z * tooth.shape[1] + y) * tooth.shape[0] + x]) continue;
            const gx = tooth.start[0] + x,
              gy = tooth.start[1] + y,
              gz = tooth.start[2] + z;
            if (gx >= dims[0] || gy >= dims[1] || gz >= dims[2]) continue;
            const i = gz * plane + gy * dims[0] + gx;
            if (owned.has(grid[i])) continue;
            grid[i] = next;
            wrote++;
          }
      if (wrote) {
        added.push({ groupId: target, value: next, fdi: tooth.fdi });
        next++;
      }
    }
  }

  // Re-measure changed groups (centroids, bounds, voxel counts).
  for (const groupId of changed) {
    const fresh = summarizeTeeth(
      labels[groupId],
      dims,
      groupId,
      instances,
      'manual',
    ).map((tooth) => {
      const add = added.find(
        (item) => item.groupId === groupId && item.value === tooth.value,
      );
      return add
        ? { ...tooth, fdi: add.fdi, review: 'corrected' as const }
        : tooth;
    });
    instances = [...instances.filter((t) => t.groupId !== groupId), ...fresh];
  }

  if (edits.swapSides)
    instances = instances.map((t) => ({ ...t, fdi: mirrorFdi(t.fdi) }));
  return { instances, labels, changedGroups: [...changed], added };
}
