import debounce from 'lodash/debounce';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_MPR_ZOOM,
  DEFAULT_WINDOW_LEVEL,
  EMPTY_SLICES,
  IDLE_PROGRESS,
} from '../constants';
import { loadVolumeFromFolder } from '../lib/import/load-volume';
import type { ScanFolderPicker } from '../lib/import/source-picker';
import type { ImportParseOptions } from '../lib/import/types';
import { loadSample as loadSampleVolume } from '../viewer/sampleBridge';
import { loadNifti } from '../viewer/niftiLoader';
import {
  clamp,
  extractAxialImage,
  extractCoronalImage,
  extractSagittalImage,
} from '../lib/volume';
import {
  type ImportIssue,
  type ImportProgress,
  ImportStage,
  type LoadedVolume,
  type PreparedVolumeFor3D,
  type RangeBounds,
  type ScanFolderSource,
  type SliceWindowLevel,
  type Vec3,
  type ViewerSlices,
  VolumeAxis,
  type VolumeCursor,
  type VolumeSeriesChoice,
} from '../types';
import {
  createCenterCursor,
  isAbortError,
  isBusy,
  makeImportIssue,
  resolveLevelBounds,
  resolveWindowBounds,
} from './helpers';
import { isCompactViewerLayout } from './viewer-layout';

export interface ViewerApp {
  axisViewsVisible: boolean;
  busy: boolean;
  cursor: VolumeCursor | null;
  directorySupported: boolean;
  dimensions: Vec3;
  downsampled3D: boolean;
  issue: ImportIssue | null;
  levelBounds: RangeBounds;
  mprZoom: number;
  prepared3D: PreparedVolumeFor3D | null;
  progress: ImportProgress;
  selectedAxis: VolumeAxis;
  sidebarVisible: boolean;
  slices: ViewerSlices;
  sourceLabel: string;
  spacing: Vec3;
  selectedSeriesId: string;
  seriesChoices: VolumeSeriesChoice[];
  volume: LoadedVolume | null;
  windowBounds: RangeBounds;
  windowLevelDraft: SliceWindowLevel;
  handleLevelChange: (value: number) => void;
  handleLevelCommit: (value: number) => void;
  handleWindowChange: (value: number) => void;
  handleWindowCommit: (value: number) => void;
  openDirectory: () => Promise<void>;
  openSample: () => Promise<void>;
  openNifti: (file: File) => Promise<void>;
  resetViewer: () => void;
  setAxisViewsVisible: (visible: boolean) => void;
  setDownsampled3D: (downsampled: boolean) => void;
  setMprZoom: (zoom: number) => void;
  setSelectedAxis: (axis: VolumeAxis) => void;
  setSidebarVisible: (visible: boolean) => void;
  selectSeries: (seriesId: string) => Promise<void>;
  updateCursor: (
    axis: VolumeAxis,
  ) => (point: { xRatio: number; yRatio: number }) => void;
}

export interface ViewerAppDependencies {
  sourcePicker: ScanFolderPicker;
}

export function useViewerApp({
  sourcePicker,
}: ViewerAppDependencies): ViewerApp {
  const defaultSidebarVisible = () => !isCompactViewerLayout();
  const [progress, setProgress] = useState<ImportProgress>(IDLE_PROGRESS);
  const [issue, setIssue] = useState<ImportIssue | null>(null);
  const [currentSource, setCurrentSource] = useState<ScanFolderSource | null>(
    null,
  );
  const [sourceLabel, setSourceLabel] = useState('');
  const [volume, setVolume] = useState<LoadedVolume | null>(null);
  const [cursor, setCursor] = useState<VolumeCursor | null>(null);
  const [windowLevelDraft, setWindowLevelDraft] =
    useState<SliceWindowLevel>(DEFAULT_WINDOW_LEVEL);
  const [windowLevel, setWindowLevel] =
    useState<SliceWindowLevel>(DEFAULT_WINDOW_LEVEL);
  const [mprZoom, setMprZoom] = useState(DEFAULT_MPR_ZOOM);
  const [downsampled3D, setDownsampled3D] = useState(false);
  const [prepared3D, setPrepared3D] = useState<PreparedVolumeFor3D | null>(
    null,
  );
  const [axisViewsVisible, setAxisViewsVisible] = useState(true);
  const [selectedAxis, setSelectedAxis] = useState(VolumeAxis.Coronal);
  const [sidebarVisible, setSidebarVisible] = useState(defaultSidebarVisible);
  const directorySupported = sourcePicker.supported;
  const busy = isBusy(progress);
  const debouncedCommitWindowLevel = useMemo(
    () =>
      debounce((next: SliceWindowLevel) => {
        setWindowLevel(next);
      }, 96),
    [],
  );

  useEffect(
    () => () => debouncedCommitWindowLevel.cancel(),
    [debouncedCommitWindowLevel],
  );

  const resetViewer = useCallback(() => {
    debouncedCommitWindowLevel.cancel();
    setIssue(null);
    setCurrentSource(null);
    setSourceLabel('');
    setVolume(null);
    setCursor(null);
    setWindowLevelDraft(DEFAULT_WINDOW_LEVEL);
    setWindowLevel(DEFAULT_WINDOW_LEVEL);
    setMprZoom(DEFAULT_MPR_ZOOM);
    setPrepared3D(null);
    setDownsampled3D(false);
    setAxisViewsVisible(true);
    setSelectedAxis(VolumeAxis.Coronal);
    setSidebarVisible(defaultSidebarVisible());
    setProgress(IDLE_PROGRESS);
  }, [debouncedCommitWindowLevel]);

  const loadSource = useCallback(
    async (source: ScanFolderSource, options?: ImportParseOptions) => {
      resetViewer();
      setCurrentSource(source);
      setSourceLabel(source.label);

      try {
        const loaded = await loadVolumeFromFolder(source, setProgress, options);

        setIssue(null);
        setVolume(loaded.volume);
        setPrepared3D(loaded.prepared3D);
        setCursor(createCenterCursor(loaded.volume));
        setWindowLevelDraft(loaded.meta.initialWindowLevel);
        setWindowLevel(loaded.meta.initialWindowLevel);
        setMprZoom(DEFAULT_MPR_ZOOM);
        setSelectedAxis(loaded.meta.nativeAxis ?? VolumeAxis.Coronal);
        setProgress({
          stage: ImportStage.Ready,
          detailKey: 'importStatus.progress.loadedScan',
          detailValues: {
            scanId: loaded.meta.scanId,
          },
          completed: loaded.meta.sliceCount,
          total: loaded.meta.sliceCount,
        });
      } catch (error) {
        if (isAbortError(error)) return;

        setIssue(makeImportIssue(error));
        setProgress({
          stage: ImportStage.Error,
          detailKey: 'importStatus.progress.importFailed',
          completed: 0,
          total: 1,
        });
      }
    },
    [resetViewer],
  );

  const slices = useMemo<ViewerSlices>(() => {
    if (!volume || !cursor) return EMPTY_SLICES;

    return {
      axial: extractAxialImage(volume, cursor, windowLevel),
      coronal: extractCoronalImage(volume, cursor, windowLevel),
      sagittal: extractSagittalImage(volume, cursor, windowLevel),
    };
  }, [cursor, volume, windowLevel]);

  const dimensions = volume?.meta.dimensions ?? [0, 0, 0];
  const spacing = volume?.meta.spacing ?? [0, 0, 0];
  const seriesChoices = volume?.meta.seriesChoices ?? [];
  const selectedSeriesId =
    seriesChoices.find((choice) => choice.selected)?.id ?? '';
  const windowBounds = resolveWindowBounds(volume);
  const levelBounds = resolveLevelBounds(volume);

  const openDirectory = async () => {
    try {
      const source = await sourcePicker.pickSource();
      if (!source) return;
      await loadSource(source);
      return;
    } catch (error) {
      setIssue(makeImportIssue(error));
    }
  };

  const openSample = async () => {
    resetViewer();
    setSourceLabel('Bundled sample CBCT');
    setProgress({
      stage: ImportStage.Assembling,
      detailKey: 'importStatus.progress.scanningSelectedFolder',
      completed: 0,
      total: 1,
    });

    try {
      const loaded = await loadSampleVolume();

      setIssue(null);
      setVolume(loaded.volume);
      setSourceLabel(loaded.label);
      setPrepared3D(loaded.prepared3D);
      setCursor(createCenterCursor(loaded.volume));
      setWindowLevelDraft(loaded.volume.meta.initialWindowLevel);
      setWindowLevel(loaded.volume.meta.initialWindowLevel);
      setMprZoom(DEFAULT_MPR_ZOOM);
      setSelectedAxis(loaded.volume.meta.nativeAxis ?? VolumeAxis.Coronal);
      setProgress({
        stage: ImportStage.Ready,
        detailKey: 'importStatus.progress.loadedScan',
        detailValues: { scanId: loaded.volume.meta.scanId },
        completed: loaded.volume.meta.sliceCount,
        total: loaded.volume.meta.sliceCount,
      });
    } catch (error) {
      if (isAbortError(error)) return;

      setIssue(makeImportIssue(error));
      setProgress({
        stage: ImportStage.Error,
        detailKey: 'importStatus.progress.importFailed',
        completed: 0,
        total: 1,
      });
    }
  };

  const openNifti = async (file: File) => {
    resetViewer();
    setSourceLabel(file.name);
    setProgress({
      stage: ImportStage.Assembling,
      detailKey: 'importStatus.progress.scanningSelectedFolder',
      completed: 0,
      total: 1,
    });

    try {
      const loaded = await loadNifti(file);

      setIssue(null);
      setVolume(loaded.volume);
      setSourceLabel(loaded.label);
      setPrepared3D(loaded.prepared3D);
      setCursor(createCenterCursor(loaded.volume));
      setWindowLevelDraft(loaded.volume.meta.initialWindowLevel);
      setWindowLevel(loaded.volume.meta.initialWindowLevel);
      setMprZoom(DEFAULT_MPR_ZOOM);
      setSelectedAxis(loaded.volume.meta.nativeAxis ?? VolumeAxis.Coronal);
      setProgress({
        stage: ImportStage.Ready,
        detailKey: 'importStatus.progress.loadedScan',
        detailValues: { scanId: loaded.volume.meta.scanId },
        completed: loaded.volume.meta.sliceCount,
        total: loaded.volume.meta.sliceCount,
      });
    } catch (error) {
      if (isAbortError(error)) return;

      setIssue(makeImportIssue(error));
      setProgress({
        stage: ImportStage.Error,
        detailKey: 'importStatus.progress.importFailed',
        completed: 0,
        total: 1,
      });
    }
  };

  const selectSeries = async (seriesId: string) => {
    if (!currentSource || busy) return;

    await loadSource(currentSource, {
      preferredSeriesId: seriesId,
    });
  };

  const updateCursor =
    (axis: VolumeAxis) =>
    ({ xRatio, yRatio }: { xRatio: number; yRatio: number }) => {
      if (!volume) return;

      setCursor((current) => {
        if (!current) return current;

        const [width, height, depth] = volume.meta.dimensions;
        if (axis === VolumeAxis.Axial) {
          const next = {
            x: clamp(Math.round(xRatio * (width - 1)), 0, width - 1),
            y: clamp(Math.round(yRatio * (height - 1)), 0, height - 1),
            z: current.z,
          };

          return next.x === current.x && next.y === current.y ? current : next;
        }

        if (axis === VolumeAxis.Coronal) {
          const next = {
            x: clamp(Math.round(xRatio * (width - 1)), 0, width - 1),
            y: current.y,
            z: clamp(Math.round((1 - yRatio) * (depth - 1)), 0, depth - 1),
          };

          return next.x === current.x && next.z === current.z ? current : next;
        }

        const next = {
          x: current.x,
          y: clamp(Math.round(xRatio * (height - 1)), 0, height - 1),
          z: clamp(Math.round((1 - yRatio) * (depth - 1)), 0, depth - 1),
        };

        return next.y === current.y && next.z === current.z ? current : next;
      });
    };

  const updateWindowLevelDraft = (next: SliceWindowLevel) => {
    setWindowLevelDraft(next);
    debouncedCommitWindowLevel(next);
  };

  const flushWindowLevelDraft = (next: SliceWindowLevel) => {
    debouncedCommitWindowLevel.cancel();
    setWindowLevelDraft(next);
    setWindowLevel(next);
  };

  const handleWindowChange = (value: number) => {
    updateWindowLevelDraft({
      ...windowLevelDraft,
      window: value,
    });
  };

  const handleWindowCommit = (value: number) => {
    flushWindowLevelDraft({
      ...windowLevelDraft,
      window: value,
    });
  };

  const handleLevelChange = (value: number) => {
    updateWindowLevelDraft({
      ...windowLevelDraft,
      level: value,
    });
  };

  const handleLevelCommit = (value: number) => {
    flushWindowLevelDraft({
      ...windowLevelDraft,
      level: value,
    });
  };

  return {
    axisViewsVisible,
    busy,
    cursor,
    directorySupported,
    dimensions,
    downsampled3D,
    issue,
    levelBounds,
    mprZoom,
    prepared3D,
    progress,
    resetViewer,
    selectedAxis,
    selectedSeriesId,
    selectSeries,
    seriesChoices,
    setAxisViewsVisible,
    setDownsampled3D,
    setMprZoom,
    setSelectedAxis,
    setSidebarVisible,
    sidebarVisible,
    slices,
    sourceLabel,
    spacing,
    volume,
    windowBounds,
    windowLevelDraft,
    handleLevelChange,
    handleLevelCommit,
    handleWindowChange,
    handleWindowCommit,
    openDirectory,
    openSample,
    openNifti,
    updateCursor,
  };
}
