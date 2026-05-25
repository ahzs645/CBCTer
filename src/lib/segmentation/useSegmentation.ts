import { useCallback, useEffect, useMemo, useState } from 'react';
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
  initialAlgorithm: SegmentationAlgorithm = 'curated',
): UseSegmentation {
  const [algorithm, setAlgorithm] =
    useState<SegmentationAlgorithm>(initialAlgorithm);
  const [manifest, setManifest] = useState<SegmentationManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<number | null>(null);
  const [reviewOverrides, setReviewOverrides] = useState<
    Record<number, ReviewOverride>
  >({});

  const loadAlgorithm = useCallback(async (next: SegmentationAlgorithm) => {
    setLoading(true);
    setError(null);
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
  }, []);

  useEffect(() => {
    void loadAlgorithm(algorithm);
  }, [algorithm, loadAlgorithm]);

  const assetRoot = SEGMENTATION_ASSET_ROOTS[algorithm];

  const reviewStatus = useCallback(
    (item: SegmentationItem): ReviewOverride =>
      reviewOverrides[item.label] ?? item.qualityStatus ?? 'accepted',
    [reviewOverrides],
  );

  const visibleItems = useMemo(
    () =>
      manifest?.items.filter(
        (item) => reviewOverrides[item.label] !== 'rejected',
      ) ?? [],
    [manifest, reviewOverrides],
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
      hidden: (manifest?.items.length ?? 0) - visibleItems.length,
      candidates: manifest?.candidateCount ?? 0,
    }),
    [manifest, reviewStatus, visibleItems],
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
