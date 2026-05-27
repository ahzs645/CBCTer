import { useCallback, useState } from 'react';
import { IDLE_PROGRESS } from '../constants';
import { loadVolumeFromFolder } from '../lib/import/load-volume';
import { loadRemoteImport } from '../lib/import/remote';
import type { ScanFolderPicker } from '../lib/import/source-picker';
import type { ImportParseOptions } from '../lib/import/types';
import type { DicomImportEngine } from '../domain/types';
import { loadSample as loadSampleVolume } from './sources/sampleBridge';
import { loadNifti } from './sources/niftiLoader';
import { ImportStage } from '../types';
import type {
  ImportIssue,
  ImportProgress,
  LoadedVolume,
  PreparedVolumeFor3D,
  RangeBounds,
  ScanFolderSource,
  SliceWindowLevel,
  Vec3,
  ViewerSlices,
  VolumeAxis,
  VolumeCursor,
  VolumeSeriesChoice,
} from '../types';
import { useVolumeViewerState } from '../viewer';
import { isAbortError, isBusy, makeImportIssue } from './helpers';
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
  dicomImportEngine: DicomImportEngine;
  handleLevelChange: (value: number) => void;
  handleLevelCommit: (value: number) => void;
  handleWindowChange: (value: number) => void;
  handleWindowCommit: (value: number) => void;
  handleWindowLevelDrag: (
    delta: { x: number; y: number },
    phase: 'start' | 'move' | 'end',
  ) => void;
  openDirectory: () => Promise<void>;
  openRemote: (url: string) => Promise<void>;
  openSample: () => Promise<void>;
  openNifti: (file: File) => Promise<void>;
  resetViewer: () => void;
  setAxisViewsVisible: (visible: boolean) => void;
  setDownsampled3D: (downsampled: boolean) => void;
  setMprZoom: (zoom: number) => void;
  setSelectedAxis: (axis: VolumeAxis) => void;
  setSidebarVisible: (visible: boolean) => void;
  setDicomImportEngine: (engine: DicomImportEngine) => void;
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
  const [downsampled3D, setDownsampled3D] = useState(false);
  const [prepared3D, setPrepared3D] = useState<PreparedVolumeFor3D | null>(
    null,
  );
  const [axisViewsVisible, setAxisViewsVisible] = useState(true);
  const [sidebarVisible, setSidebarVisible] = useState(defaultSidebarVisible);
  const [dicomImportEngine, setDicomImportEngine] =
    useState<DicomImportEngine>('custom');

  // All volume-derived viewer state (cursor, window/level, zoom, slices, ...)
  // lives in the reusable headless hook and re-initializes when `volume`
  // changes, so the loading flow below only has to set the volume.
  const viewer = useVolumeViewerState(volume);

  const directorySupported = sourcePicker.supported;
  const busy = isBusy(progress);

  const resetViewer = useCallback(() => {
    setIssue(null);
    setCurrentSource(null);
    setSourceLabel('');
    setVolume(null);
    setPrepared3D(null);
    setDownsampled3D(false);
    setAxisViewsVisible(true);
    setSidebarVisible(defaultSidebarVisible());
    setProgress(IDLE_PROGRESS);
  }, []);

  const loadSource = useCallback(
    async (source: ScanFolderSource, options?: ImportParseOptions) => {
      resetViewer();
      setCurrentSource(source);
      setSourceLabel(source.label);

      try {
        const loaded = await loadVolumeFromFolder(source, setProgress, {
          ...options,
          dicomEngine: options?.dicomEngine ?? dicomImportEngine,
        });

        setIssue(null);
        setVolume(loaded.volume);
        setPrepared3D(loaded.prepared3D);
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
    [dicomImportEngine, resetViewer],
  );

  const dimensions = viewer.dimensions;
  const spacing = viewer.spacing;
  const seriesChoices = volume?.meta.seriesChoices ?? [];
  const selectedSeriesId =
    seriesChoices.find((choice) => choice.selected)?.id ?? '';

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
      const samplePath =
        typeof window === 'undefined'
          ? undefined
          : new URLSearchParams(window.location.search).get('sample') ||
            undefined;
      const loaded = await loadSampleVolume(samplePath);

      setIssue(null);
      setVolume(loaded.volume);
      setSourceLabel(loaded.label);
      setPrepared3D(loaded.prepared3D);
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

  const openRemote = async (url: string) => {
    resetViewer();
    setSourceLabel(url);
    setProgress({
      stage: ImportStage.Scanning,
      detailKey: 'importStatus.progress.scanningSelectedFolder',
      completed: 0,
      total: 1,
    });

    try {
      const remote = await loadRemoteImport(url);
      setSourceLabel(remote.label);
      if (remote.type === 'nifti') {
        await openNifti(remote.file);
        return;
      }
      await loadSource(remote.source);
    } catch (error) {
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

  return {
    axisViewsVisible,
    busy,
    cursor: viewer.cursor,
    directorySupported,
    dimensions,
    downsampled3D,
    dicomImportEngine,
    issue,
    levelBounds: viewer.levelBounds,
    mprZoom: viewer.mprZoom,
    prepared3D,
    progress,
    resetViewer,
    selectedAxis: viewer.selectedAxis,
    selectedSeriesId,
    selectSeries,
    seriesChoices,
    setAxisViewsVisible,
    setDownsampled3D,
    setDicomImportEngine,
    setMprZoom: viewer.setMprZoom,
    setSelectedAxis: viewer.setSelectedAxis,
    setSidebarVisible,
    sidebarVisible,
    slices: viewer.slices,
    sourceLabel,
    spacing,
    volume,
    windowBounds: viewer.windowBounds,
    windowLevelDraft: viewer.windowLevelDraft,
    handleLevelChange: viewer.handleLevelChange,
    handleLevelCommit: viewer.handleLevelCommit,
    handleWindowChange: viewer.handleWindowChange,
    handleWindowCommit: viewer.handleWindowCommit,
    handleWindowLevelDrag: viewer.handleWindowLevelDrag,
    openDirectory,
    openRemote,
    openSample,
    openNifti,
    updateCursor: viewer.updateCursor,
  };
}
