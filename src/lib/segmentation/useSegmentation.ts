import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { LoadedVolume } from '../../types';
import { type GenerateProgress, generateLibrary } from './generateLibrary';
import type { ToothRoi } from './roi';
import {
  getManualToothRevision,
  listManualToothItems,
  subscribeManualToothItems,
} from './manualToothLibrary';
import {
  type ReviewOverride,
  SEGMENTATION_ASSET_ROOTS,
  type SegmentationAlgorithm,
  type SegmentationItem,
  type SegmentationManifest,
} from './types';

export interface SegmentationCounts {
  separated: number;
  accepted: number;
  review: number;
  hidden: number;
  candidates: number;
}

export interface UseSegmentation {
  algorithm: SegmentationAlgorithm;
  setAlgorithm: (algorithm: SegmentationAlgorithm) => void;
  manifest: SegmentationManifest | null;
  loading: boolean;
  error: string | null;
  /** True while an in-browser library is being generated. */
  generating: boolean;
  /** Progress of the in-browser generation, or null when idle. */
  genProgress: GenerateProgress | null;
  /** Run the UNet over `roi` and build a library entirely in the browser.
   * `coreThreshold` tunes watershed separation granularity (voxels). */
  generate: (
    volume: LoadedVolume,
    roi: ToothRoi,
    coreThreshold?: number,
  ) => Promise<void>;
  assetRoot: string;
  visibleItems: SegmentationItem[];
  selectedItem: SegmentationItem | null;
  selectedStl: string | null;
  selectLabel: (label: number) => void;
  reviewStatus: (item: SegmentationItem) => ReviewOverride;
  setReview: (label: number, status: ReviewOverride) => void;
  counts: SegmentationCounts;
}

/**
 * Loads and manages the separated-tooth segmentation manifest for a chosen
 * algorithm, plus per-label review overrides and derived counts. Keeps the
 * tooth-extraction page a thin view over this state.
 */
export function useSegmentation(
  initialAlgorithm: SegmentationAlgorithm = 'toothseg',
): UseSegmentation {
  const [algorithm, setAlgorithm] =
    useState<SegmentationAlgorithm>(initialAlgorithm);
  const [manifest, setManifest] = useState<SegmentationManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<GenerateProgress | null>(null);
  // Non-null while a generated (in-browser) manifest is active; its asset root
  // is '' because item URLs are already absolute blob/data URLs.
  const [assetRootOverride, setAssetRootOverride] = useState<string | null>(
    null,
  );
  const [selectedLabel, setSelectedLabel] = useState<number | null>(null);
  const [reviewOverrides, setReviewOverrides] = useState<
    Record<number, ReviewOverride>
  >({});
  useSyncExternalStore(
    subscribeManualToothItems,
    getManualToothRevision,
    getManualToothRevision,
  );

  // Object URLs from the active generated library, revoked on replace/unmount.
  const generatedUrls = useRef<string[]>([]);
  const revokeGenerated = useCallback(() => {
    for (const url of generatedUrls.current) URL.revokeObjectURL(url);
    generatedUrls.current = [];
  }, []);

  const loadAlgorithm = useCallback(
    async (next: SegmentationAlgorithm) => {
      setLoading(true);
      setError(null);
      // Switching to a prebuilt set discards any generated library.
      revokeGenerated();
      setAssetRootOverride(null);
      try {
        const response = await fetch(
          `${SEGMENTATION_ASSET_ROOTS[next]}manifest.json`,
        );
        const contentType = response.headers.get('content-type') ?? '';
        // A missing asset is served as the SPA index.html fallback (HTML, 200),
        // so guard on content-type instead of trusting response.ok alone.
        if (!response.ok || !contentType.includes('json')) {
          throw new Error('Segmentation manifest is not available.');
        }
        const data = (await response.json()) as SegmentationManifest;
        setManifest(data);
        setSelectedLabel(data.items[0]?.label ?? null);
        setReviewOverrides({});
      } catch (cause) {
        setManifest(null);
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to load segmentation manifest.',
        );
      } finally {
        setLoading(false);
      }
    },
    [revokeGenerated],
  );

  const generate = useCallback(
    async (volume: LoadedVolume, roi: ToothRoi, coreThreshold?: number) => {
      setGenerating(true);
      setError(null);
      setGenProgress(null);
      revokeGenerated();
      try {
        const { manifest: built, urls } = await generateLibrary(
          volume,
          roi,
          setGenProgress,
          { coreThreshold, fdi: { jaw: 'both' } },
        );
        generatedUrls.current = urls;
        setManifest(built);
        setAssetRootOverride('');
        setSelectedLabel(built.items[0]?.label ?? null);
        setReviewOverrides({});
      } catch (cause) {
        setManifest(null);
        setAssetRootOverride(null);
        setError(
          cause instanceof Error
            ? cause.message
            : 'In-browser segmentation failed.',
        );
      } finally {
        setGenerating(false);
        setGenProgress(null);
      }
    },
    [revokeGenerated],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void loadAlgorithm(algorithm);
    });
    return () => controller.abort();
  }, [algorithm, loadAlgorithm]);

  // Revoke any generated object URLs when the page unmounts.
  useEffect(() => () => revokeGenerated(), [revokeGenerated]);

  const assetRoot = assetRootOverride ?? SEGMENTATION_ASSET_ROOTS[algorithm];

  const reviewStatus = useCallback(
    (item: SegmentationItem): ReviewOverride =>
      reviewOverrides[item.label] ?? item.qualityStatus ?? 'accepted',
    [reviewOverrides],
  );

  const manualItems = listManualToothItems();

  const allItems = useMemo(() => {
    const base = manifest?.items ?? [];
    if (manualItems.length === 0) return base;
    const byFdi = new Map<number, SegmentationItem>();
    const noFdi: SegmentationItem[] = [];
    for (const item of base) {
      if (typeof item.fdi === 'number') byFdi.set(item.fdi, item);
      else noFdi.push(item);
    }
    for (const item of manualItems) {
      if (typeof item.fdi === 'number') byFdi.set(item.fdi, item);
      else noFdi.push(item);
    }
    return [...noFdi, ...byFdi.values()].sort(
      (a, b) => (a.fdi ?? a.label) - (b.fdi ?? b.label),
    );
  }, [manualItems, manifest]);

  const visibleItems = useMemo(
    () =>
      allItems.filter(
        (item) => reviewOverrides[item.label] !== 'rejected',
      ),
    [allItems, reviewOverrides],
  );

  const selectedItem =
    visibleItems.find((item) => item.label === selectedLabel) ??
    visibleItems[0] ??
    null;
  const selectedStl = selectedItem
    ? `${assetRoot}${selectedItem.stl}`
    : null;

  const counts = useMemo<SegmentationCounts>(
    () => ({
      separated: visibleItems.length,
      accepted: visibleItems.filter((item) => reviewStatus(item) === 'accepted')
        .length,
      review: visibleItems.filter((item) => reviewStatus(item) === 'review')
        .length,
      hidden: allItems.length - visibleItems.length,
      candidates: allItems.length,
    }),
    [allItems.length, reviewStatus, visibleItems],
  );

  const setReview = useCallback((label: number, status: ReviewOverride) => {
    setReviewOverrides((current) => ({ ...current, [label]: status }));
  }, []);

  return {
    algorithm,
    setAlgorithm,
    manifest,
    loading,
    error,
    generating,
    genProgress,
    generate,
    assetRoot,
    visibleItems,
    selectedItem,
    selectedStl,
    selectLabel: setSelectedLabel,
    reviewStatus,
    setReview,
    counts,
  };
}
