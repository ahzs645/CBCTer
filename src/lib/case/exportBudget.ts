/**
 * A rough memory plan for a tooth export, so a phone doesn't run out of
 * memory half way. Numbers come from measured exports: about 9.5 MB of
 * unsimplified STL per crown on a printable model, and a handful of
 * one-byte and two-byte arrays per voxel of the box around the selection.
 */
export interface ExportPlanInput {
  teeth: number;
  /** Voxels in the box around all chosen teeth. */
  unionVoxels: number;
  archModel: boolean;
  smaller: boolean;
  /** Memory the page can reasonably use, bytes. */
  budgetBytes: number;
}

export interface ExportPlan {
  estimateBytes: number;
  /** Whether to build the printable model (dropped when it won't fit). */
  archModel: boolean;
  /** Plain-language note when the plan was changed or is tight. */
  note: string | null;
}

const STL_PER_TOOTH = 9.5e6;
const ARCH_BYTES_PER_VOXEL = 12;
const MiB = 1024 * 1024;

export function planToothExport(input: ExportPlanInput): ExportPlan {
  const shrink = input.smaller ? 0.15 : 1;
  // Per-tooth STLs are kept for the combined file; the zip holds them again
  // compressed (about 60%).
  const teethBytes = input.teeth * STL_PER_TOOTH * shrink * 1.6;
  const archBytes = input.archModel
    ? input.unionVoxels * ARCH_BYTES_PER_VOXEL +
      input.teeth * STL_PER_TOOTH * shrink * 2
    : 0;
  const estimateBytes = Math.round(teethBytes + archBytes);
  if (estimateBytes <= input.budgetBytes)
    return { estimateBytes, archModel: input.archModel, note: null };
  if (input.archModel && teethBytes <= input.budgetBytes)
    return {
      estimateBytes: Math.round(teethBytes),
      archModel: false,
      note: `The printable model for ${input.teeth} teeth needs about ${Math.round(estimateBytes / MiB)} MB, more than this device can spare; exporting the teeth without it. Choose fewer teeth or use a computer for the model.`,
    };
  return {
    estimateBytes,
    archModel: false,
    note: `This export needs about ${Math.round(estimateBytes / MiB)} MB, which may be more than this device can spare. If the page reloads, choose fewer teeth${input.smaller ? '' : ' or turn on smaller files'}.`,
  };
}

/** Memory the page can use for an export on this device, bytes. */
export function exportBudgetBytes(): number {
  if (typeof navigator === 'undefined') return 1500 * MiB;
  const deviceGb = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;
  const phone =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(pointer: coarse)').matches &&
    Math.min(window.screen.width, window.screen.height) < 700;
  // Mobile browsers kill a tab well before the device's memory is used up.
  if (phone) return (deviceGb && deviceGb <= 3 ? 200 : 350) * MiB;
  if (deviceGb) return Math.min(2000, deviceGb * 250) * MiB;
  return 1500 * MiB;
}
