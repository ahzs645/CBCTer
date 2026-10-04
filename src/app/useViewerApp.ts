import type { CaseWorkspace } from '../lib/case/types';
import type { Dispatch, SetStateAction } from 'react';
import { prepareVolumeFor3D } from '../lib/volume';
import type { ChunkedSession } from '../lib/import/chunked/session';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IDLE_PROGRESS } from '../constants';
import { loadVolumeFromFolder } from '../lib/import/load-volume';
import { loadRemoteImport } from '../lib/import/remote';
import type { ScanFolderPicker } from '../lib/import/source-picker';
import type { ImportParseOptions } from '../lib/import/types';
import type { DicomImportEngine } from '../domain/types';
import { loadSample as loadSampleVolume } from './sources/sampleBridge';
import { loadNifti } from './sources/niftiLoader';
import {
  isHandoffRequested,
  listenForHandoff,
} from './sources/embeddedHandoff';
import { ImportStage, ScanFolderSourceKind } from '../types';
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
import { shouldShowSidebarByDefault } from './viewer-layout';

export interface ViewerApp {
  caseWorkspace: CaseWorkspace | null;
  setCaseWorkspace: Dispatch<SetStateAction<CaseWorkspace | null>>;
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
  /** Open a single ZIP: a vendor export zipped up, or a `.cbct.zip` package. */
  openArchive: (file: File) => Promise<void>;
  /** Reopen the current scan package at another resolution level. */
  openPackageLevel: (level: 'full' | 'half') => Promise<void>;
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
  setCursor: (cursor: VolumeCursor | null) => void;
  stepSlice: (axis: VolumeAxis, delta: number) => void;
  setSliceIndex: (axis: VolumeAxis, index: number) => void;
  applyWindowLevel: (next: SliceWindowLevel) => void;
  /** Committed window/level the slices are rendered with. */
  windowLevel: SliceWindowLevel;
}

export interface ViewerAppDependencies {
  sourcePicker: ScanFolderPicker;
}

export function useViewerApp({
  sourcePicker,
}: ViewerAppDependencies): ViewerApp {
  const [caseWorkspace, setCaseWorkspace] = useState<CaseWorkspace | null>(
    null,
  );
  const activeSession = useRef<ChunkedSession | null>(null);
  const generation = useRef(0);
  const defaultSidebarVisible = () => shouldShowSidebarByDefault();
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
    generation.current++;
    activeSession.current?.dispose();
    activeSession.current = null;
    setIssue(null);
    setCurrentSource(null);
    setSourceLabel('');
    setVolume(null);
    setCaseWorkspace(null);
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
      const importGeneration = generation.current;

      try {
        const loaded = await loadVolumeFromFolder(source, setProgress, {
          ...options,
          dicomEngine: options?.dicomEngine ?? dicomImportEngine,
        });

        if (importGeneration !== generation.current) {
          loaded.volume.chunked?.dispose();
          return;
        }
        activeSession.current = loaded.volume.chunked ?? null;
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
        if (importGeneration !== generation.current || isAbortError(error))
          return;

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

  // Embedded by a health-record app with `?handoff=postmessage`: take the
  // scan folder it sends and load it like a picked folder. A ref keeps one
  // listener (and one "ready" signal) for the life of the page.
  const loadSourceRef = useRef(loadSource);
  useEffect(() => {
    loadSourceRef.current = loadSource;
  }, [loadSource]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isHandoffRequested(window.location.search, window.parent !== window))
      return;
    return listenForHandoff((source) => {
      void loadSourceRef.current(source);
    });
  }, []);

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

  const openArchive = async (file: File) => {
    await loadSource({
      kind: ScanFolderSourceKind.FileList,
      label: file.name,
      entries: [{ name: file.name, relativePath: file.name, file }],
    });
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
    const remoteGeneration = generation.current;
    setSourceLabel(url);
    setProgress({
      stage: ImportStage.Scanning,
      detailKey: 'importStatus.progress.scanningSelectedFolder',
      completed: 0,
      total: 1,
    });

    try {
      const remote = await loadRemoteImport(url);
      if (remoteGeneration !== generation.current) return;
      setSourceLabel(remote.label);
      if (remote.type === 'nifti') {
        await openNifti(remote.file);
        return;
      }
      await loadSource(remote.source);
    } catch (error) {
      if (remoteGeneration !== generation.current) return;
      setIssue(makeImportIssue(error));
      setProgress({
        stage: ImportStage.Error,
        detailKey: 'importStatus.progress.importFailed',
        completed: 0,
        total: 1,
      });
    }
  };

  const openPackageLevel = async (level: 'full' | 'half') => {
    if (busy) return;
    const session = activeSession.current;
    if (level === 'full' && session) {
      const full = await session.fullVolume();
      if (activeSession.current !== session) return;
      activeSession.current = null;
      session.dispose();
      setVolume(full);
      setCaseWorkspace(full.caseWorkspace ?? null);
      setPrepared3D(prepareVolumeFor3D(full));
      return;
    }
    if (currentSource) await loadSource(currentSource, { packageLevel: level });
  };

  const selectSeries = async (seriesId: string) => {
    if (!currentSource || busy) return;

    await loadSource(currentSource, {
      preferredSeriesId: seriesId,
    });
  };

  return {
    caseWorkspace,
    setCaseWorkspace,
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
    openArchive,
    openPackageLevel,
    updateCursor: viewer.updateCursor,
    setCursor: viewer.setCursor,
    stepSlice: viewer.stepSlice,
    setSliceIndex: viewer.setSliceIndex,
    applyWindowLevel: viewer.applyWindowLevel,
    windowLevel: viewer.windowLevel,
  };
}
