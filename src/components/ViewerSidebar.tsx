import {
  ArrowLeft,
  Box,
  Contrast,
  Crosshair,
  FolderInput,
  Languages,
  Layers3,
  ListVideo,
  ScanLine,
  SlidersHorizontal,
  SunMedium,
} from 'lucide-react';
import { formatSpacing } from '../app/helpers';
import type { StudyState } from '../domain/types';
import { useTranslation } from '../i18n';
import type {
  ImportIssue,
  ImportProgress,
  ParsedVolumeMeta,
  RangeBounds,
  SliceWindowLevel,
  Vec3,
  VolumeCursor,
  VolumeSeriesChoice,
} from '../types';
import { Button } from './Button';
import { ImportStatus } from './ImportStatus';
import { ImportStatusStage } from './ImportStatus.constants';
import { LanguageSelect } from './LanguageSelect';
import { Notice } from './Notice';
import { RangeField } from './RangeField';
import { Select } from './Select';
import { StudyWorkflowPanel } from './StudyWorkflowPanel';

interface ThresholdMaskPreset {
  id: string;
  label: string;
  range: [number, number];
  color: string;
}

interface ViewerSidebarProps {
  cursor: VolumeCursor | null;
  dimensions: Vec3;
  downsampled3D: boolean;
  issue: ImportIssue | null;
  levelBounds: RangeBounds;
  progress: ImportProgress;
  selectedSeriesId: string;
  seriesChoices: VolumeSeriesChoice[];
  sourceLabel: string;
  spacing: Vec3;
  volumeMeta: ParsedVolumeMeta | null;
  windowBounds: RangeBounds;
  windowLevelDraft: SliceWindowLevel;
  studyState: StudyState;
  onBackToImport: () => void;
  onCreateThresholdMask: (preset: ThresholdMaskPreset) => void;
  onCreateSurfaceFromActiveMask: () => void;
  onDownloadSurface: (surfaceId: string) => void;
  onExportProject: () => void;
  onFillMaskHoles: () => void;
  onImportProject: (file: File) => void;
  onKeepLargestMaskComponent: () => void;
  onLevelChange: (value: number) => void;
  onLevelCommit: (value: number) => void;
  onOpenDirectory: () => void;
  onOpenTeeth: () => void;
  onOpenPanoramic: () => void;
  onSeriesChange: (seriesId: string) => void;
  onRedoMaskEdit: () => void;
  onRegionGrowFromCursor: (preset: ThresholdMaskPreset) => void;
  onToggleSurfaceVisibility: (surfaceId: string) => void;
  onWindowChange: (value: number) => void;
  onWindowCommit: (value: number) => void;
  onToggleMaskVisibility: (maskId: string) => void;
  onUndoMaskEdit: () => void;
}

export function ViewerSidebar({
  cursor,
  dimensions,
  downsampled3D,
  issue,
  levelBounds,
  progress,
  selectedSeriesId,
  seriesChoices,
  sourceLabel,
  spacing,
  volumeMeta,
  windowBounds,
  windowLevelDraft,
  studyState,
  onBackToImport,
  onCreateThresholdMask,
  onCreateSurfaceFromActiveMask,
  onDownloadSurface,
  onExportProject,
  onFillMaskHoles,
  onImportProject,
  onKeepLargestMaskComponent,
  onLevelChange,
  onLevelCommit,
  onOpenDirectory,
  onOpenTeeth,
  onOpenPanoramic,
  onSeriesChange,
  onRedoMaskEdit,
  onRegionGrowFromCursor,
  onToggleSurfaceVisibility,
  onWindowChange,
  onWindowCommit,
  onToggleMaskVisibility,
  onUndoMaskEdit,
}: ViewerSidebarProps) {
  const { t } = useTranslation();
  const sectionLabelClass =
    'inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-slate-500';
  const selectedSeries = seriesChoices.find(
    (choice) => choice.id === selectedSeriesId,
  );
  const sparseCrossPlane =
    spacing[2] > Math.max(spacing[0], spacing[1], 0.001) * 3;

  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <section className="shrink-0 min-w-0 rounded border border-slate-800 bg-slate-950/75 px-2.5 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className={sectionLabelClass}>
            <Languages className="h-3.5 w-3.5" aria-hidden="true" />
            {t('common.language')}
          </div>
          <LanguageSelect floating={false} />
        </div>
      </section>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-2">
        <section className="min-w-0 rounded border border-slate-800 bg-slate-950/80 p-2.5">
          <div className={sectionLabelClass}>
            <Box className="h-3.5 w-3.5" aria-hidden="true" />
            {t('viewerSidebar.study')}
          </div>
          <div
            className="mt-1 truncate text-sm font-semibold text-slate-100"
            title={volumeMeta?.scanId}
          >
            {volumeMeta?.scanId}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {volumeMeta?.formatLabel}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {t('viewerSidebar.voxelsLabel', {
              dimensions: dimensions.join(' x '),
            })}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {t('viewerSidebar.spacingLabel', {
              spacing: formatSpacing(spacing),
            })}
          </div>
          {seriesChoices.length > 1 ? (
            <label className="mt-2 block">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300">
                <ListVideo className="h-3.5 w-3.5" aria-hidden="true" />
                {t('viewerSidebar.series')}
              </span>
              <Select
                block
                size="sm"
                className="mt-1"
                value={selectedSeriesId}
                onChange={onSeriesChange}
                options={seriesChoices.map((choice) => ({
                  value: choice.id,
                  label: choice.label,
                }))}
              />
              {selectedSeries ? (
                <span className="mt-1 block text-xs text-slate-500">
                  {selectedSeries.detail}
                </span>
              ) : null}
              {sparseCrossPlane ? (
                <span className="mt-1 block text-xs text-amber-300/80">
                  {t('viewerSidebar.thickSliceHint')}
                </span>
              ) : null}
            </label>
          ) : null}
          <div
            className="mt-1 truncate text-xs text-slate-600"
            title={sourceLabel}
          >
            {sourceLabel}
          </div>
        </section>

        <StudyWorkflowPanel
          dimensions={dimensions}
          spacing={spacing}
          state={studyState}
          onCreateThresholdMask={onCreateThresholdMask}
          onCreateSurfaceFromActiveMask={onCreateSurfaceFromActiveMask}
          onDownloadSurface={onDownloadSurface}
          onExportProject={onExportProject}
          onFillMaskHoles={onFillMaskHoles}
          onImportProject={onImportProject}
          onKeepLargestMaskComponent={onKeepLargestMaskComponent}
          onRedoMaskEdit={onRedoMaskEdit}
          onRegionGrowFromCursor={onRegionGrowFromCursor}
          onToggleSurfaceVisibility={onToggleSurfaceVisibility}
          onToggleMaskVisibility={onToggleMaskVisibility}
          onUndoMaskEdit={onUndoMaskEdit}
        />

        <section className="min-w-0 rounded border border-slate-800 bg-slate-950/70 p-2.5">
          <div className={sectionLabelClass}>
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            {t('viewerSidebar.display')}
          </div>
          <div className="mt-2.5">
            <RangeField
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Contrast className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('viewerSidebar.window')}
                </span>
              }
              min={windowBounds.min}
              max={windowBounds.max}
              value={windowLevelDraft.window}
              onChange={onWindowChange}
              onCommit={onWindowCommit}
              hint={t('viewerSidebar.windowHint')}
            />
          </div>

          <div className="mt-2.5">
            <RangeField
              label={
                <span className="inline-flex items-center gap-1.5">
                  <SunMedium className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('viewerSidebar.level')}
                </span>
              }
              min={levelBounds.min}
              max={levelBounds.max}
              value={windowLevelDraft.level}
              onChange={onLevelChange}
              onCommit={onLevelCommit}
              hint={t('viewerSidebar.levelHint')}
            />
          </div>
        </section>

        <div className="min-h-0 min-w-0">
          <ImportStatus
            progress={progress}
            issue={issue}
            stage={ImportStatusStage.Viewer}
          />
        </div>

        <section className="min-w-0 rounded border border-slate-800 bg-slate-950/70 p-2.5">
          <div className={sectionLabelClass}>
            <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
            {t('viewerSidebar.navigation')}
          </div>
          <div className="mt-2 text-xs text-slate-400">
            {t('viewerSidebar.cursor')}{' '}
            {cursor
              ? `${cursor.x + 1}, ${cursor.y + 1}, ${cursor.z + 1}`
              : t('viewerSidebar.cursorUnavailable')}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {t('viewerSidebar.dragHint')}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {t('viewerSidebar.zoomHint')}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {t('viewerSidebar.orientationHint')}
          </div>
          <div className="mt-2 text-xs text-slate-400">
            {t('viewerSidebar.volumeSection')}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {downsampled3D
              ? t('viewerSidebar.volumeDownsampled')
              : t('viewerSidebar.volumeNative')}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {t('viewerSidebar.planeHint')}
          </div>
        </section>
      </div>

      <section className="shrink-0 min-w-0 rounded border border-slate-800 bg-slate-950/70 p-2.5">
        <div className="grid grid-cols-1 gap-2">
          <Button variant="primary" block onClick={onOpenTeeth}>
            <Layers3 className="h-4 w-4" aria-hidden="true" />
            {t('viewerSidebar.toothExtraction')}
          </Button>
          <Button variant="ghost" block onClick={onOpenPanoramic}>
            <ScanLine className="h-4 w-4" aria-hidden="true" />
            {t('viewerSidebar.panoramic')}
          </Button>
          <Button variant="ghost" block onClick={onOpenDirectory}>
            <FolderInput className="h-4 w-4" aria-hidden="true" />
            {t('viewerSidebar.openFolder')}
          </Button>
          <Button variant="ghost" block onClick={onBackToImport}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('viewerSidebar.backToImport')}
          </Button>
        </div>
        <Notice className="mt-3" compact>
          {t('common.referenceOnly')}
        </Notice>
      </section>
    </aside>
  );
}
