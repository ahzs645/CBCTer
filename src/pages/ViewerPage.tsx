import { Box, PanelRightClose } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ViewerApp } from '../app/useViewerApp';
import { useCompactViewerLayout } from '../app/viewer-layout';
import { AxisViewportGrid } from '../components/AxisViewportGrid';
import { Button } from '../components/Button';
import { ViewerSidebar } from '../components/ViewerSidebar';
import { ViewportFrame } from '../components/ViewportFrame';
import {
  VolumeViewport3D,
  type VolumeViewport3DHandle,
} from '../components/VolumeViewport3D';
import { APP_ROUTES } from '../constants';
import {
  createEmptyStudyState,
  createStudyImageLayer,
  createStudyMask,
  createStudySurface,
} from '../domain/studyState';
import type { ScanStudy, StudyState } from '../domain/types';
import { useTranslation } from '../i18n';
import {
  buildProjectArchive,
  projectArchiveName,
  readProjectArchive,
} from '../lib/project';
import {
  countMaskVoxels,
  extractMaskOverlayImage,
  fillMaskHoles,
  keepLargestMaskComponent,
  regionGrowMask,
  thresholdVolume,
} from '../lib/segmentation/maskOperations';
import { maskToBinaryStl } from '../lib/segmentation/maskMesh';
import { estimateVoxelSurfaceTriangleCount } from '../lib/surface';
import { VolumeAxis, type SliceImage } from '../types';
import { cn } from '../utils/cn';

interface ViewerPageProps {
  app: ViewerApp;
}

type MaskBufferMap = Record<string, Uint8Array>;
type SurfaceBlobMap = Record<string, Blob>;
type SurfaceUrlMap = Record<string, string>;

interface MaskSnapshot {
  masks: StudyState['masks'];
  activeMaskId?: string;
  buffers: MaskBufferMap;
}

function cloneMaskBuffers(buffers: MaskBufferMap): MaskBufferMap {
  return Object.fromEntries(
    Object.entries(buffers).map(([id, buffer]) => [id, new Uint8Array(buffer)]),
  );
}

function volumeMaskDims(dimensions: [number, number, number]): [number, number, number] {
  return [dimensions[2], dimensions[1], dimensions[0]];
}

function sameVec3(
  left: [number, number, number],
  right: [number, number, number],
): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

function byteRangeToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export default function ViewerPage({ app }: ViewerPageProps) {
  const compactLayout = useCompactViewerLayout();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openTeeth = () => navigate(APP_ROUTES.teeth);
  const openPanoramic = () => navigate(APP_ROUTES.panoramic);
  const viewport3DRef = useRef<VolumeViewport3DHandle>(null);
  const [studyState, setStudyState] = useState<StudyState>(() =>
    createEmptyStudyState(),
  );
  const [maskBuffers, setMaskBuffers] = useState<MaskBufferMap>({});
  const [surfaceBlobs, setSurfaceBlobs] = useState<SurfaceBlobMap>({});
  const [surfaceUrls, setSurfaceUrls] = useState<SurfaceUrlMap>({});
  const surfaceUrlsRef = useRef<SurfaceUrlMap>({});
  const [undoStack, setUndoStack] = useState<MaskSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<MaskSnapshot[]>([]);

  const scanStudy = useMemo<ScanStudy | null>(() => {
    if (!app.volume) return null;
    return {
      id: `study_${app.volume.meta.scanId}`,
      name: app.volume.meta.scanId,
      source: app.sourceLabel.toLowerCase().includes('sample')
        ? 'sample'
        : 'local-folder',
      fileCount: app.volume.meta.sliceCount,
      totalBytes: app.volume.voxels.byteLength,
      modality: app.volume.meta.formatLabel,
      status: 'indexed',
      createdAt: 0,
      updatedAt: 0,
    };
  }, [app.sourceLabel, app.volume]);

  const maskOverlays = useMemo<Partial<Record<VolumeAxis, SliceImage | null>>>(
    () => {
      if (!app.cursor || !app.volume) return {};
      const layers = studyState.masks
        .map((mask) => {
          const buffer = maskBuffers[mask.id];
          if (!buffer) return null;
          return {
            mask: buffer,
            color: mask.color,
            opacity: mask.opacity,
            visible: mask.visible,
          };
        })
        .filter((layer): layer is NonNullable<typeof layer> => layer != null);

      if (layers.length === 0) return {};

      return {
        [VolumeAxis.Coronal]: extractMaskOverlayImage(
          layers,
          VolumeAxis.Coronal,
          app.cursor,
          app.volume.meta.dimensions,
          app.volume.meta.spacing,
        ),
        [VolumeAxis.Sagittal]: extractMaskOverlayImage(
          layers,
          VolumeAxis.Sagittal,
          app.cursor,
          app.volume.meta.dimensions,
          app.volume.meta.spacing,
        ),
        [VolumeAxis.Axial]: extractMaskOverlayImage(
          layers,
          VolumeAxis.Axial,
          app.cursor,
          app.volume.meta.dimensions,
          app.volume.meta.spacing,
        ),
      };
    },
    [app.cursor, app.volume, maskBuffers, studyState.masks],
  );

  // Push cursor changes to the 3D viewport imperatively so scrubbing never
  // re-renders (and re-serializes) the heavy prepared-volume prop.
  useEffect(() => {
    viewport3DRef.current?.focusCursor(app.cursor);
  }, [app.cursor]);

  useEffect(() => {
    const controller = new AbortController();
    if (!app.volume || !scanStudy) {
      queueMicrotask(() => {
        if (!controller.signal.aborted) setStudyState(createEmptyStudyState());
      });
      return () => controller.abort();
    }

    queueMicrotask(() => {
      if (controller.signal.aborted || !app.volume) return;
      const image = createStudyImageLayer(scanStudy.id, {
        name: app.volume.meta.scanId,
        source: scanStudy.source,
        dimensions: app.volume.meta.dimensions,
        spacing: app.volume.meta.spacing,
      });

      setStudyState({
        ...createEmptyStudyState(scanStudy),
        images: [image],
        activeImageId: image.id,
      });
      setMaskBuffers({});
      setSurfaceBlobs({});
      setSurfaceUrls((current) => {
        Object.values(current).forEach((url) => URL.revokeObjectURL(url));
        return {};
      });
      setUndoStack([]);
      setRedoStack([]);
    });
    return () => controller.abort();
  }, [app.volume?.meta.scanId, app.volume, scanStudy]);

  useEffect(() => {
    surfaceUrlsRef.current = surfaceUrls;
  }, [surfaceUrls]);

  useEffect(
    () => () => {
      Object.values(surfaceUrlsRef.current).forEach((url) =>
        URL.revokeObjectURL(url),
      );
    },
    [],
  );

  const snapshotMasks = (): MaskSnapshot => ({
    masks: studyState.masks.map((mask) => ({ ...mask })),
    activeMaskId: studyState.activeMaskId,
    buffers: cloneMaskBuffers(maskBuffers),
  });

  const commitMaskEdit = (
    nextMasks: StudyState['masks'],
    nextBuffers: MaskBufferMap,
    activeMaskId: string | undefined,
    activeTool: StudyState['activeTool'],
  ) => {
    const nextUndo = [...undoStack, snapshotMasks()].slice(-24);
    setUndoStack(nextUndo);
    setRedoStack([]);
    setMaskBuffers(nextBuffers);
    setStudyState((current) => ({
      ...current,
      masks: nextMasks,
      activeMaskId,
      activeTool,
      maskWorkflow: {
        ...current.maskWorkflow,
        canUndo: nextUndo.length > 0,
        canRedo: false,
      },
    }));
  };

  const createThresholdMask = (preset: {
    label: string;
    range: [number, number];
    color: string;
  }) => {
    if (!app.volume || !studyState.study || !studyState.activeImageId) return;
    const mask = thresholdVolume(app.volume.voxels, preset.range);
    const voxelCount = countMaskVoxels(mask);
    const nextMask = createStudyMask(
      studyState.study.id,
      studyState.activeImageId,
      {
        name: preset.label,
        color: preset.color,
        thresholdRange: preset.range,
        voxelCount,
      },
    );
    commitMaskEdit(
      [...studyState.masks, nextMask],
      { ...maskBuffers, [nextMask.id]: mask },
      nextMask.id,
      'mask-threshold',
    );
    setStudyState((current) => ({
      ...current,
      maskWorkflow: {
        ...current.maskWorkflow,
        operation: 'threshold',
        thresholdRange: preset.range,
      },
    }));
  };

  const regionGrowFromCursor = (preset: {
    label: string;
    range: [number, number];
    color: string;
  }) => {
    if (!app.volume || !app.cursor || !studyState.study || !studyState.activeImageId) return;
    const dims = volumeMaskDims(app.volume.meta.dimensions);
    const mask = regionGrowMask(
      app.volume.voxels,
      dims,
      [app.cursor.x, app.cursor.y, app.cursor.z],
      preset.range,
      6,
    );
    const voxelCount = countMaskVoxels(mask);
    const nextMask = createStudyMask(
      studyState.study.id,
      studyState.activeImageId,
      {
        name: `${preset.label} region`,
        color: preset.color,
        thresholdRange: preset.range,
        voxelCount,
      },
    );
    commitMaskEdit(
      [...studyState.masks, nextMask],
      { ...maskBuffers, [nextMask.id]: mask },
      nextMask.id,
      'mask-region-grow',
    );
  };

  const updateActiveMaskBuffer = (
    transform: (buffer: Uint8Array) => Uint8Array,
    activeTool: StudyState['activeTool'],
  ) => {
    const activeMaskId = studyState.activeMaskId;
    if (!app.volume || !activeMaskId || !maskBuffers[activeMaskId]) return;
    const nextBuffer = transform(maskBuffers[activeMaskId]);
    const voxelCount = countMaskVoxels(nextBuffer);
    const nextMasks = studyState.masks.map((mask) =>
      mask.id === activeMaskId
        ? { ...mask, voxelCount, edited: true, updatedAt: Date.now() }
        : mask,
    );
    commitMaskEdit(
      nextMasks,
      { ...maskBuffers, [activeMaskId]: nextBuffer },
      activeMaskId,
      activeTool,
    );
  };

  const keepLargestActiveMaskComponent = () => {
    if (!app.volume) return;
    const dims = volumeMaskDims(app.volume.meta.dimensions);
    updateActiveMaskBuffer(
      (buffer) => keepLargestMaskComponent(buffer, dims, 26),
      'mask-region-grow',
    );
  };

  const fillActiveMaskHoles = () => {
    if (!app.volume) return;
    const dims = volumeMaskDims(app.volume.meta.dimensions);
    updateActiveMaskBuffer((buffer) => fillMaskHoles(buffer, dims), 'mask-brush');
  };

  const undoMaskEdit = () => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    const nextRedo = [snapshotMasks(), ...redoStack].slice(0, 24);
    const nextUndo = undoStack.slice(0, -1);
    setUndoStack(nextUndo);
    setRedoStack(nextRedo);
    setMaskBuffers(cloneMaskBuffers(previous.buffers));
    setStudyState((current) => ({
      ...current,
      masks: previous.masks,
      activeMaskId: previous.activeMaskId,
      maskWorkflow: {
        ...current.maskWorkflow,
        canUndo: nextUndo.length > 0,
        canRedo: true,
      },
    }));
  };

  const redoMaskEdit = () => {
    const next = redoStack[0];
    if (!next) return;
    const nextUndo = [...undoStack, snapshotMasks()].slice(-24);
    const nextRedo = redoStack.slice(1);
    setUndoStack(nextUndo);
    setRedoStack(nextRedo);
    setMaskBuffers(cloneMaskBuffers(next.buffers));
    setStudyState((current) => ({
      ...current,
      masks: next.masks,
      activeMaskId: next.activeMaskId,
      maskWorkflow: {
        ...current.maskWorkflow,
        canUndo: true,
        canRedo: nextRedo.length > 0,
      },
    }));
  };

  const toggleMaskVisibility = (maskId: string) => {
    setStudyState((current) => ({
      ...current,
      masks: current.masks.map((mask) =>
        mask.id === maskId
          ? { ...mask, visible: !mask.visible, updatedAt: Date.now() }
          : mask,
      ),
    }));
  };

  const createSurfaceFromActiveMask = () => {
    const activeMaskId = studyState.activeMaskId;
    if (!app.volume || !studyState.study || !activeMaskId) return;
    const mask = maskBuffers[activeMaskId];
    const sourceMask = studyState.masks.find((item) => item.id === activeMaskId);
    if (!mask || !sourceMask || !sourceMask.voxelCount) return;

    const dims = volumeMaskDims(app.volume.meta.dimensions);
    const stride = sourceMask.voxelCount > 750_000 ? 2 : 1;
    const blob = maskToBinaryStl(
      mask,
      dims,
      app.volume.meta.spacing,
      [0, 0, 0],
      stride,
    );
    const surface = createStudySurface(studyState.study.id, {
      maskId: activeMaskId,
      name: `${sourceMask.name} surface`,
      color: sourceMask.color,
      triangleCount: Math.ceil(
        estimateVoxelSurfaceTriangleCount(mask, dims) / (stride * stride),
      ),
      volumeMm3:
        sourceMask.voxelCount *
        app.volume.meta.spacing[0] *
        app.volume.meta.spacing[1] *
        app.volume.meta.spacing[2],
    });
    const url = URL.createObjectURL(blob);

    setSurfaceBlobs((current) => ({ ...current, [surface.id]: blob }));
    setSurfaceUrls((current) => ({ ...current, [surface.id]: url }));
    setStudyState((current) => ({
      ...current,
      surfaces: [...current.surfaces, surface],
      activeSurfaceId: surface.id,
      activeTool: 'surface-select',
    }));
  };

  const toggleSurfaceVisibility = (surfaceId: string) => {
    setStudyState((current) => ({
      ...current,
      surfaces: current.surfaces.map((surface) =>
        surface.id === surfaceId
          ? { ...surface, visible: !surface.visible, updatedAt: Date.now() }
          : surface,
      ),
    }));
  };

  const downloadSurface = (surfaceId: string) => {
    const surface = studyState.surfaces.find((item) => item.id === surfaceId);
    const url = surfaceUrls[surfaceId];
    if (!surface || !url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = `${surface.name.replace(/[^a-z0-9_-]+/gi, '_')}.stl`;
    link.click();
  };

  const exportProject = async () => {
    const surfaces = await Promise.all(
      studyState.surfaces
        .map((surface) => {
          const blob = surfaceBlobs[surface.id];
          return blob ? { surface, blob } : null;
        })
        .filter((item): item is { surface: StudyState['surfaces'][number]; blob: Blob } => item != null)
        .map(async ({ surface, blob }) => ({
          id: surface.id,
          data: new Uint8Array(await blob.arrayBuffer()),
        })),
    );

    const archive = await buildProjectArchive({
      state: studyState,
      masks: Object.entries(maskBuffers).map(([id, data]) => ({
        id,
        data,
      })),
      surfaces,
    });
    const url = URL.createObjectURL(archive);
    const link = document.createElement('a');
    link.href = url;
    link.download = projectArchiveName(studyState);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const importProject = async (file: File) => {
    const volume = app.volume;
    if (!volume) return;
    try {
      const archive = await readProjectArchive(file);
      const restoredImage = archive.manifest.state.images.find((image) =>
        sameVec3(image.dimensions, volume.meta.dimensions),
      );
      if (!restoredImage) {
        throw new Error(
          'Project package does not match the loaded volume dimensions.',
        );
      }

      const expectedMaskBytes =
        volume.meta.dimensions[0] *
        volume.meta.dimensions[1] *
        volume.meta.dimensions[2];
      const nextMaskBuffers: MaskBufferMap = {};
      for (const mask of archive.masks) {
        if (mask.data.byteLength !== expectedMaskBytes) {
          throw new Error(`Mask ${mask.id} does not match this volume.`);
        }
        nextMaskBuffers[mask.id] = new Uint8Array(mask.data);
      }

      setSurfaceBlobs({});
      setSurfaceUrls((current) => {
        Object.values(current).forEach((url) => URL.revokeObjectURL(url));
        return {};
      });
      const nextSurfaceBlobs: SurfaceBlobMap = {};
      const nextSurfaceUrls: SurfaceUrlMap = {};
      for (const surface of archive.surfaces) {
        const blob = new Blob([byteRangeToArrayBuffer(surface.data)], {
          type: 'model/stl',
        });
        nextSurfaceBlobs[surface.id] = blob;
        nextSurfaceUrls[surface.id] = URL.createObjectURL(blob);
      }

      setStudyState({
        ...archive.manifest.state,
        study: scanStudy ?? archive.manifest.state.study,
        images: archive.manifest.state.images.map((image) =>
          image.id === restoredImage.id
            ? {
                ...image,
                dimensions: volume.meta.dimensions,
                spacing: volume.meta.spacing,
              }
            : image,
        ),
        activeImageId: restoredImage.id,
      });
      setMaskBuffers(nextMaskBuffers);
      setSurfaceBlobs(nextSurfaceBlobs);
      setSurfaceUrls(nextSurfaceUrls);
      setUndoStack([]);
      setRedoStack([]);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Project import failed.');
    }
  };

  if (!app.volume) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
        <div className="rounded border border-slate-800 bg-slate-950/90 px-4 py-3 text-sm text-slate-400">
          {t('viewerPage.loading')}
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="relative h-full overflow-hidden bg-slate-800">
        <div
          className={cn(
            'grid h-full gap-px',
            compactLayout
              ? 'grid-cols-1'
              : app.sidebarVisible
                ? 'grid-cols-[minmax(0,1fr)_minmax(288px,22vw)]'
                : 'grid-cols-1',
          )}
        >
          <section className="min-h-0 min-w-0">
            <div
              className={cn(
                'grid h-full min-h-0 min-w-0 gap-px bg-slate-800',
                app.axisViewsVisible
                  ? compactLayout
                    ? 'grid-rows-[minmax(0,1.1fr)_minmax(260px,0.9fr)]'
                    : 'grid-rows-[1.22fr_0.95fr]'
                  : 'grid-rows-1',
              )}
            >
              <div className="grid min-h-0 min-w-0 grid-cols-1 gap-px bg-slate-800">
                <ViewportFrame
                  title={
                    <span className="inline-flex items-center gap-1.5">
                      <Box
                        className="h-4 w-4 text-slate-400"
                        aria-hidden="true"
                      />
                      3D
                    </span>
                  }
                  subtitle={t('viewerPage.mainNavigationVolume')}
                  status={
                    app.prepared3D
                      ? app.prepared3D.downsampled
                        ? t('viewerPage.downsampledStatus')
                        : t('viewerPage.nativeStatus')
                      : t('viewerPage.preparingStatus')
                  }
                >
                  <VolumeViewport3D
                    ref={viewport3DRef}
                    volume={app.prepared3D}
                    axisViewsVisible={app.axisViewsVisible}
                    onAxisViewsVisibleChange={app.setAxisViewsVisible}
                    sidebarVisible={app.sidebarVisible}
                    onSidebarVisibleChange={app.setSidebarVisible}
                    onDownsampledChange={app.setDownsampled3D}
                  />
                </ViewportFrame>
              </div>

              {app.axisViewsVisible ? (
                <AxisViewportGrid
                  compact={compactLayout}
                  hasVolume={Boolean(app.volume)}
                  cursor={app.cursor}
                  dimensions={app.dimensions}
                  spacing={app.spacing}
                  slices={app.slices}
                  mprZoom={app.mprZoom}
                  overlays={maskOverlays}
                  selectedAxis={app.selectedAxis}
                  onZoomChange={app.setMprZoom}
                  onSelectedAxisChange={app.setSelectedAxis}
                  onSelectAxis={app.updateCursor}
                />
              ) : null}
            </div>
          </section>

          {!compactLayout && app.sidebarVisible ? (
            <ViewerSidebar
              volumeMeta={app.volume?.meta ?? null}
              studyState={studyState}
              sourceLabel={app.sourceLabel}
              dimensions={app.dimensions}
              spacing={app.spacing}
              windowBounds={app.windowBounds}
              levelBounds={app.levelBounds}
              windowLevelDraft={app.windowLevelDraft}
              progress={app.progress}
              issue={app.issue}
              cursor={app.cursor}
              downsampled3D={app.downsampled3D}
              selectedSeriesId={app.selectedSeriesId}
              seriesChoices={app.seriesChoices}
              onWindowChange={app.handleWindowChange}
              onWindowCommit={app.handleWindowCommit}
              onCreateThresholdMask={createThresholdMask}
              onCreateSurfaceFromActiveMask={createSurfaceFromActiveMask}
              onDownloadSurface={downloadSurface}
              onExportProject={() => void exportProject()}
              onFillMaskHoles={fillActiveMaskHoles}
              onImportProject={(file) => void importProject(file)}
              onKeepLargestMaskComponent={keepLargestActiveMaskComponent}
              onLevelChange={app.handleLevelChange}
              onLevelCommit={app.handleLevelCommit}
              onRedoMaskEdit={redoMaskEdit}
              onRegionGrowFromCursor={regionGrowFromCursor}
              onToggleSurfaceVisibility={toggleSurfaceVisibility}
              onToggleMaskVisibility={toggleMaskVisibility}
              onUndoMaskEdit={undoMaskEdit}
              onSeriesChange={(seriesId) => void app.selectSeries(seriesId)}
              onOpenDirectory={() => void app.openDirectory()}
              onOpenTeeth={openTeeth}
              onOpenPanoramic={openPanoramic}
              onBackToImport={app.resetViewer}
            />
          ) : null}
        </div>

        {compactLayout && app.sidebarVisible ? (
          <div className="absolute inset-0 z-40 flex justify-end">
            <button
              type="button"
              aria-label={t('viewerPage.closeStudyPanel')}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-[1px]"
              onClick={() => app.setSidebarVisible(false)}
            />
            <div className="relative flex h-full w-[min(24rem,92vw)] flex-col border-l border-slate-800 bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/95 px-3 py-2">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  {t('viewerPage.studyPanel')}
                </div>
                <Button
                  variant="overlay"
                  size="sm"
                  onClick={() => app.setSidebarVisible(false)}
                >
                  <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('common.hide')}
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto bg-slate-800 p-px">
                <ViewerSidebar
                  volumeMeta={app.volume?.meta ?? null}
                  studyState={studyState}
                  sourceLabel={app.sourceLabel}
                  dimensions={app.dimensions}
                  spacing={app.spacing}
                  windowBounds={app.windowBounds}
                  levelBounds={app.levelBounds}
                  windowLevelDraft={app.windowLevelDraft}
                  progress={app.progress}
                  issue={app.issue}
                  cursor={app.cursor}
                  downsampled3D={app.downsampled3D}
                  selectedSeriesId={app.selectedSeriesId}
                  seriesChoices={app.seriesChoices}
                  onWindowChange={app.handleWindowChange}
                  onWindowCommit={app.handleWindowCommit}
                  onCreateThresholdMask={createThresholdMask}
                  onCreateSurfaceFromActiveMask={createSurfaceFromActiveMask}
                  onDownloadSurface={downloadSurface}
                  onExportProject={() => void exportProject()}
                  onFillMaskHoles={fillActiveMaskHoles}
                  onImportProject={(file) => void importProject(file)}
                  onKeepLargestMaskComponent={keepLargestActiveMaskComponent}
                  onLevelChange={app.handleLevelChange}
                  onLevelCommit={app.handleLevelCommit}
                  onRedoMaskEdit={redoMaskEdit}
                  onRegionGrowFromCursor={regionGrowFromCursor}
                  onToggleSurfaceVisibility={toggleSurfaceVisibility}
                  onToggleMaskVisibility={toggleMaskVisibility}
                  onUndoMaskEdit={undoMaskEdit}
                  onSeriesChange={(seriesId) => void app.selectSeries(seriesId)}
                  onOpenDirectory={() => void app.openDirectory()}
                  onOpenTeeth={openTeeth}
                  onOpenPanoramic={openPanoramic}
                  onBackToImport={app.resetViewer}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
