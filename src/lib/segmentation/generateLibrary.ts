import type { LoadedVolume } from '../../types';
import { maskProjectionDataUrl } from './maskPreview';
import { maskToBinaryStl } from './maskMesh';
import type { ToothRoi } from './roi';
import { segmentToothROI } from './toothInference';
import { assignFdiToItems, defaultArchAxes, type ToothFdiOptions } from './toothFdi';
import type { SegmentationItem, SegmentationManifest } from './types';
import { watershedSplit } from './watershed';

/** Tints reused from ToothArchViewport so previews match the 3D arch colors. */
const TOOTH_COLORS = [
  0xe95d5d, 0x54b6e8, 0x70d878, 0xf0c64d, 0xa879f2, 0xea76bd, 0x5bc8bd,
  0xf28a4d, 0x9bd45f, 0xf2f2f2,
];

/** Components below this are treated as noise and never counted as candidates. */
const NOISE_FLOOR = 200;
/** Mirrors the Python audit `--min-voxels` default for tooth candidacy. */
const MIN_TOOTH_VOXELS = 4000;
/** Safety cap on emitted instances (keeps meshing/preview work bounded). */
const MAX_ITEMS = 64;

export interface GenerateProgress {
  phase: 'inference' | 'separation' | 'meshing';
  completed: number;
  total: number;
}

export interface GeneratedLibrary {
  manifest: SegmentationManifest;
  /** Object URLs created for tooth STLs; revoke when the library is replaced. */
  urls: string[];
}

interface Quality {
  status: 'accepted' | 'review';
  reasons: string[];
  score: number;
}

/**
 * Port of `scripts/curate_tooth_separation.py::quality_status`. Thresholds are
 * in the full-volume voxel frame, matching how `centroidZYX`/`extentZYX` are
 * reported, so accepted/review semantics line up with the offline pipeline.
 */
function quality(
  voxels: number,
  extentZYX: [number, number, number],
  centroidZYX: [number, number, number],
): Quality {
  const reasons: string[] = [];
  if (voxels < 10_000) reasons.push('low-volume');
  if (voxels > 140_000) reasons.push('high-volume');
  if (Math.min(...extentZYX) < 18) reasons.push('flat-or-clipped');
  if (extentZYX[0] > 115 || extentZYX[1] > 95 || extentZYX[2] > 100) {
    reasons.push('oversized');
  }
  if (centroidZYX[0] < 55 || centroidZYX[0] > 260) reasons.push('off-arch-z');
  if (centroidZYX[1] < 55 || centroidZYX[1] > 380) reasons.push('off-arch-y');
  if (centroidZYX[2] < 95 || centroidZYX[2] > 520) reasons.push('off-arch-x');

  let score = 1.0 - 0.18 * reasons.length;
  if (voxels >= 18_000 && voxels <= 120_000) score += 0.12;
  const limits = [105, 90, 95];
  if (extentZYX.every((value, i) => value >= 22 && value <= limits[i])) {
    score += 0.12;
  }
  score = Math.max(0, Math.min(1, score));
  return {
    status: reasons.length === 0 ? 'accepted' : 'review',
    reasons,
    score: Math.round(score * 1000) / 1000,
  };
}

/**
 * Generate a separated-tooth library entirely in the browser: run the UNet over
 * an arch ROI, split the foreground into instances, then build a manifest whose
 * `preview`/`stl` are inline data/object URLs (so the existing library UI works
 * with no `fetch()` and no Python pipeline). `assetRoot` for this manifest is
 * the empty string — URLs are already absolute.
 */
export interface GenerateOptions {
  /** Watershed core threshold (voxels): lower merges touching teeth (coarser),
   * higher separates them (finer). */
  coreThreshold?: number;
  /**
   * Assign FDI (ISO 3950) tooth numbers to the separated instances. When set,
   * each manifest item gets `fdi`/`fdiName`/`quadrant`. Axes default to the
   * volume voxel frame (see `toothFdi.ts`); override them here for scans with a
   * known anatomical orientation. Omit to skip numbering (default).
   */
  fdi?: ToothFdiOptions;
}

export async function generateLibrary(
  volume: LoadedVolume,
  roi: ToothRoi,
  onProgress?: (progress: GenerateProgress) => void,
  options: GenerateOptions = {},
): Promise<GeneratedLibrary> {
  const segmentation = await segmentToothROI(volume, roi, (p) =>
    onProgress?.({
      phase: 'inference',
      completed: p.completed,
      total: p.total,
    }),
  );

  onProgress?.({ phase: 'separation', completed: 0, total: 1 });
  const { mask, dims, origin, spacing, voxelCount } = segmentation;
  const [, height, width] = dims;
  // Watershed on the distance transform splits touching teeth that plain
  // connected-components would merge into a single blob.
  const { labels, components } = watershedSplit(mask, dims, {
    coreThreshold: options.coreThreshold,
  });

  const candidateCount = components.filter(
    (component) => component.voxels >= NOISE_FLOOR,
  ).length;
  const kept = components
    .filter((component) => component.voxels >= MIN_TOOTH_VOXELS)
    .sort((a, b) => b.voxels - a.voxels)
    .slice(0, MAX_ITEMS);

  const items: SegmentationItem[] = [];
  const urls: string[] = [];
  let qualityAccepted = 0;
  let qualityReview = 0;

  kept.forEach((component, index) => {
    onProgress?.({ phase: 'meshing', completed: index, total: kept.length });
    const label = index + 1;
    const [z0, y0, x0, z1, y1, x1] = component.bbox;
    const sd = z1 - z0;
    const sh = y1 - y0;
    const sw = x1 - x0;

    // Extract just this component into its bbox-sized submask.
    const sub = new Uint8Array(sd * sh * sw);
    for (let z = 0; z < sd; z += 1) {
      for (let y = 0; y < sh; y += 1) {
        const srcRow = ((z + z0) * height + (y + y0)) * width + x0;
        const dstRow = (z * sh + y) * sw;
        for (let x = 0; x < sw; x += 1) {
          if (labels[srcRow + x] === component.id) sub[dstRow + x] = 1;
        }
      }
    }

    // Report geometry in the full-volume voxel frame (origin is [x, y, z]).
    const centroidZYX: [number, number, number] = [
      Math.round(origin[2] + component.centroid[0]),
      Math.round(origin[1] + component.centroid[1]),
      Math.round(origin[0] + component.centroid[2]),
    ];
    const bboxZYX: [number, number, number, number, number, number] = [
      origin[2] + z0,
      origin[1] + y0,
      origin[0] + x0,
      origin[2] + z1,
      origin[1] + y1,
      origin[0] + x1,
    ];
    const extentZYX: [number, number, number] = [sd, sh, sw];
    const { status, reasons, score } = quality(
      component.voxels,
      extentZYX,
      centroidZYX,
    );
    if (status === 'accepted') qualityAccepted += 1;
    else qualityReview += 1;

    const color = TOOTH_COLORS[index % TOOTH_COLORS.length];
    // Offset the mesh by its ROI-local bbox origin so every tooth keeps its
    // relative position in the shared arch frame. Large teeth get a coarser
    // mesh (adaptive quality) to keep face counts and GPU load reasonable.
    const meshStride = Math.max(sd, sh, sw) > 96 ? 2 : 1;
    const stlBlob = maskToBinaryStl(
      sub,
      [sd, sh, sw],
      spacing,
      [x0, y0, z0],
      meshStride,
    );
    const stlUrl = URL.createObjectURL(stlBlob);
    urls.push(stlUrl);

    items.push({
      label,
      name: `tooth-${label}`,
      preview: maskProjectionDataUrl(sub, [sd, sh, sw], color),
      stl: stlUrl,
      assignedVoxels: component.voxels,
      centroidZYX,
      bboxZYX,
      extentZYX,
      qualityStatus: status,
      qualityReasons: reasons,
      qualityScore: score,
    });
  });

  const numbered = options.fdi
    ? assignFdiToItems(items, { ...defaultArchAxes(), ...options.fdi })
    : items;

  const manifest: SegmentationManifest = {
    source: 'in-browser',
    preview: '',
    contactSheet: '',
    labels: '',
    acceptedInstances: numbered.length,
    candidateCount,
    positiveVoxels: voxelCount,
    qualityAccepted,
    qualityReview,
    spacing,
    items: numbered,
  };

  return { manifest, urls };
}
