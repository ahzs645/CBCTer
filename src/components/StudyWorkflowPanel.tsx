import {
  Activity,
  Box,
  Brush,
  CircleDot,
  Download,
  Eye,
  EyeOff,
  Layers3,
  PencilRuler,
  Scissors,
  Split,
  Square,
  Trash2,
  Waves,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type {
  DicomImportEngine,
  MaskOperation,
  StudyState,
  StudyTool,
  ViewerLayoutPreset,
  WatershedSeedKind,
} from '../domain/types';
import { createFullCropBounds } from '../domain/studyState';
import { useTranslation } from '../i18n';
import { SURFACE_GENERATION_PRESETS } from '../lib/surface';
import type { SurfaceGenerationQuality } from '../lib/surface';
import type { Vec3 } from '../types';
import { cn } from '../utils/cn';
import { Button } from './Button';
import { Select } from './Select';

type WorkflowTab = 'study' | 'masks' | 'surfaces' | 'measures' | 'export';

interface ThresholdPreset {
  id: string;
  label: string;
  range: [number, number];
  color: string;
}

const THRESHOLD_PRESETS: ThresholdPreset[] = [
  { id: 'bone', label: 'Bone', range: [226, 3071], color: '#facc15' },
  { id: 'enamelAdult', label: 'Enamel adult', range: [1553, 2850], color: '#f8fafc' },
  { id: 'enamelChild', label: 'Enamel child', range: [2042, 3023], color: '#bae6fd' },
  { id: 'compactBone', label: 'Compact bone', range: [662, 1988], color: '#fb923c' },
  { id: 'spongialBone', label: 'Spongial bone', range: [148, 661], color: '#fbbf24' },
  { id: 'softTissue', label: 'Soft tissue', range: [-700, 225], color: '#f9a8d4' },
];

interface StudyWorkflowPanelProps {
  dimensions: Vec3;
  spacing: Vec3;
  state: StudyState;
  maskStatus?: string;
  surfaceStatus?: string;
  onCancelMaskOperation: () => void;
  onCancelSurfaceGeneration: () => void;
  onCreateThresholdMask: (preset: ThresholdPreset) => void;
  onCreateSurfaceFromActiveMask: (quality: SurfaceGenerationQuality) => void;
  onDownloadSurface: (surfaceId: string) => void;
  onDownloadSurfacePly: (surfaceId: string) => void;
  onDeleteMeasurement: (measurementId: string) => void;
  onExportProject: () => void;
  onFillMaskHoles: () => void;
  onKeepLargestMaskComponent: () => void;
  onImportProject: (file: File) => void;
  onSaveLocalProject: () => void;
  onRestoreLocalProject: () => void;
  onSelectMask: (maskId: string) => void;
  onSplitMaskComponents: () => void;
  onUpdateMaskAppearance: (
    maskId: string,
    patch: Partial<Pick<StudyState['masks'][number], 'color' | 'opacity'>>,
  ) => void;
  onUpdateMaskWorkflow: (
    patch: Partial<StudyState['maskWorkflow']> & { activeTool?: StudyTool },
  ) => void;
  onUpdateStudyViewState: (
    patch: Partial<
      Pick<
        StudyState,
        | 'dicomImportEngine'
        | 'cropBounds'
        | 'layoutPreset'
        | 'activeSegmentGroupId'
        | 'activeAnnotationId'
      >
    >,
  ) => void;
  onUpdateSegment: (
    groupId: string,
    segmentId: string,
    patch: Partial<
      Pick<
        StudyState['segmentGroups'][number]['segments'][number],
        'color' | 'opacity' | 'visible' | 'locked'
      >
    >,
  ) => void;
  onAddWatershedSeedAtCursor: () => void;
  onApplyWatershedSeeds: () => void;
  onClearWatershedSeeds: () => void;
  onRedoMaskEdit: () => void;
  onRegionGrowFromCursor: (preset: ThresholdPreset) => void;
  onToggleSurfaceVisibility: (surfaceId: string) => void;
  onToggleMaskVisibility: (maskId: string) => void;
  onUndoMaskEdit: () => void;
}

function formatRange(range: [number, number]): string {
  return `${range[0]} to ${range[1]} HU`;
}

function formatVoxelVolume(voxels: number | undefined, spacing: Vec3): string {
  if (!voxels) return '0 voxels';
  const mm3 = voxels * spacing[0] * spacing[1] * spacing[2];
  return mm3 >= 1000
    ? `${voxels.toLocaleString()} voxels · ${(mm3 / 1000).toFixed(2)} cm3`
    : `${voxels.toLocaleString()} voxels · ${Math.round(mm3)} mm3`;
}

export function StudyWorkflowPanel({
  dimensions,
  spacing,
  state,
  maskStatus,
  surfaceStatus,
  onCancelMaskOperation,
  onCancelSurfaceGeneration,
  onCreateThresholdMask,
  onCreateSurfaceFromActiveMask,
  onDownloadSurface,
  onDownloadSurfacePly,
  onDeleteMeasurement,
  onExportProject,
  onFillMaskHoles,
  onKeepLargestMaskComponent,
  onImportProject,
  onSaveLocalProject,
  onRestoreLocalProject,
  onSelectMask,
  onSplitMaskComponents,
  onUpdateMaskAppearance,
  onUpdateMaskWorkflow,
  onUpdateStudyViewState,
  onUpdateSegment,
  onAddWatershedSeedAtCursor,
  onApplyWatershedSeeds,
  onClearWatershedSeeds,
  onRedoMaskEdit,
  onRegionGrowFromCursor,
  onToggleSurfaceVisibility,
  onToggleMaskVisibility,
  onUndoMaskEdit,
}: StudyWorkflowPanelProps) {
  const { t } = useTranslation();
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useState<WorkflowTab>('masks');
  const [thresholdPresetId, setThresholdPresetId] = useState(
    THRESHOLD_PRESETS[0].id,
  );
  const [surfaceQuality, setSurfaceQuality] =
    useState<SurfaceGenerationQuality>('balanced');
  const selectedThreshold =
    THRESHOLD_PRESETS.find((preset) => preset.id === thresholdPresetId) ??
    THRESHOLD_PRESETS[0];
  const editTools: Array<{
    tool: StudyTool;
    operation: MaskOperation;
    label: string;
  }> = [
    { tool: 'mask-brush', operation: 'draw', label: t('workflow.masks.draw') },
    { tool: 'mask-erase', operation: 'erase', label: t('workflow.masks.erase') },
    {
      tool: 'mask-threshold',
      operation: 'threshold',
      label: t('workflow.masks.thresholdBrush'),
    },
  ];
  const seedKinds: Array<{ value: WatershedSeedKind; label: string }> = [
    { value: 'foreground', label: t('workflow.masks.foregroundSeed') },
    { value: 'background', label: t('workflow.masks.backgroundSeed') },
  ];

  const tabs: Array<{ id: WorkflowTab; label: string; icon: typeof Box }> = [
    { id: 'study', label: t('workflow.tabs.study'), icon: Box },
    { id: 'masks', label: t('workflow.tabs.masks'), icon: Brush },
    { id: 'surfaces', label: t('workflow.tabs.surfaces'), icon: Layers3 },
    { id: 'measures', label: t('workflow.tabs.measures'), icon: PencilRuler },
    { id: 'export', label: t('workflow.tabs.export'), icon: Download },
  ];

  return (
    <section className="min-w-0 rounded border border-slate-800 bg-slate-950/70 p-2.5">
      <div className="grid grid-cols-5 gap-1">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={cn(
                'inline-flex h-8 items-center justify-center rounded border text-slate-400 transition hover:bg-slate-900 hover:text-slate-100',
                tab === item.id
                  ? 'border-sky-500/70 bg-sky-500/10 text-sky-100'
                  : 'border-slate-800 bg-slate-950',
              )}
              title={item.label}
              aria-label={item.label}
              onClick={() => setTab(item.id)}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </button>
          );
        })}
      </div>

      {tab === 'study' ? (
        <div className="mt-3 space-y-3 text-xs text-slate-400">
          <div className="font-medium text-slate-100">{state.study?.name}</div>
          <div>{t('workflow.study.images', { count: state.images.length })}</div>
          <div>{t('workflow.study.dimensions', { dimensions: dimensions.join(' x ') })}</div>
          <div>{t('workflow.study.spacing', { spacing: spacing.map((item) => item.toFixed(2)).join(' x ') })}</div>
          <div>{t('workflow.study.activeTool', { tool: state.activeTool })}</div>
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
              {t('workflow.study.dicomEngine')}
            </span>
            <Select
              block
              size="sm"
              value={state.dicomImportEngine}
              onChange={(value) =>
                onUpdateStudyViewState({
                  dicomImportEngine: value as DicomImportEngine,
                })
              }
              options={[
                {
                  value: 'custom',
                  label: t('workflow.study.dicomEngineCustom'),
                },
                {
                  value: 'itk-gdcm',
                  label: t('workflow.study.dicomEngineItk'),
                },
              ]}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
              {t('workflow.study.layout')}
            </span>
            <Select
              block
              size="sm"
              value={state.layoutPreset}
              onChange={(value) =>
                onUpdateStudyViewState({
                  layoutPreset: value as ViewerLayoutPreset,
                })
              }
              options={[
                { value: 'mpr-3d', label: t('workflow.study.layoutMpr3d') },
                { value: 'mpr-only', label: t('workflow.study.layoutMprOnly') },
                { value: 'single', label: t('workflow.study.layoutSingle') },
              ]}
            />
          </label>
          <div className="rounded border border-slate-800 bg-slate-950 p-2">
            <label className="flex items-center gap-2 text-slate-300">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-sky-400"
                checked={Boolean(state.cropBounds?.enabled)}
                onChange={(event) =>
                  onUpdateStudyViewState({
                    cropBounds: {
                      ...(state.cropBounds ?? createFullCropBounds(dimensions)),
                      enabled: event.currentTarget.checked,
                    },
                  })
                }
              />
              {t('workflow.study.crop')}
            </label>
            <div className="mt-1 text-[11px] text-slate-500">
              {state.cropBounds
                ? `${state.cropBounds.min.join(', ')} to ${state.cropBounds.max.join(', ')}`
                : t('workflow.study.cropFullVolume')}
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'masks' ? (
        <div className="mt-3 space-y-3">
          <div>
            <div className="mb-1.5 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-slate-500">
              <CircleDot className="h-3.5 w-3.5" aria-hidden="true" />
              {t('workflow.masks.threshold')}
            </div>
            <Select
              block
              size="sm"
              value={thresholdPresetId}
              onChange={setThresholdPresetId}
              options={THRESHOLD_PRESETS.map((preset) => ({
                value: preset.id,
                label: `${preset.label} · ${formatRange(preset.range)}`,
              }))}
            />
            <Button
              className="mt-2"
              variant="primary"
              size="sm"
              block
              onClick={() => onCreateThresholdMask(selectedThreshold)}
            >
              <Brush className="h-3.5 w-3.5" aria-hidden="true" />
              {t('workflow.masks.createThresholdMask')}
            </Button>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                block
                onClick={() => onRegionGrowFromCursor(selectedThreshold)}
              >
                <CircleDot className="h-3.5 w-3.5" aria-hidden="true" />
                {t('workflow.masks.regionGrow')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                block
                disabled={!state.activeMaskId || Boolean(maskStatus)}
                onClick={onKeepLargestMaskComponent}
              >
                <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
                {t('workflow.masks.keepLargest')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                block
                disabled={!state.activeMaskId || Boolean(maskStatus)}
                onClick={onSplitMaskComponents}
              >
                <Split className="h-3.5 w-3.5" aria-hidden="true" />
                {t('workflow.masks.split')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                block
                disabled={!state.activeMaskId}
                onClick={onFillMaskHoles}
              >
                <Waves className="h-3.5 w-3.5" aria-hidden="true" />
                {t('workflow.masks.fillHoles')}
              </Button>
              <div className="grid grid-cols-2 gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  block
                  disabled={!state.maskWorkflow.canUndo}
                  onClick={onUndoMaskEdit}
                >
                  {t('workflow.masks.undo')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  block
                  disabled={!state.maskWorkflow.canRedo}
                  onClick={onRedoMaskEdit}
                >
                  {t('workflow.masks.redo')}
                </Button>
              </div>
            </div>
            {maskStatus ? (
              <Button
                className="mt-2"
                variant="ghost"
                size="sm"
                block
                onClick={onCancelMaskOperation}
              >
                <Square className="h-3.5 w-3.5" aria-hidden="true" />
                {maskStatus} · {t('workflow.masks.cancel')}
              </Button>
            ) : null}
            <div className="mt-2 grid grid-cols-3 gap-1">
              {editTools.map((item) => (
                <Button
                  key={item.tool}
                  variant={state.activeTool === item.tool ? 'primary' : 'ghost'}
                  size="sm"
                  block
                  disabled={!state.activeMaskId}
                  onClick={() =>
                    onUpdateMaskWorkflow({
                      activeTool: item.tool,
                      operation: item.operation,
                    })
                  }
                >
                  {item.label}
                </Button>
              ))}
            </div>
            <label className="mt-2 block text-[11px] text-slate-500">
              {t('workflow.masks.brushSize')}
              <input
                className="mt-1 h-1.5 w-full accent-sky-400"
                type="range"
                min={0.5}
                max={12}
                step={0.5}
                value={state.maskWorkflow.brushSizeMm}
                onChange={(event) =>
                  onUpdateMaskWorkflow({
                    brushSizeMm: Number(event.currentTarget.value),
                  })
                }
              />
            </label>
            <div className="mt-2 rounded border border-slate-800 bg-slate-950 p-2">
              <div className="mb-1.5 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                {t('workflow.masks.watershedSeeds')}
              </div>
              <Select
                block
                size="sm"
                value={state.maskWorkflow.watershedSeedKind}
                onChange={(value) =>
                  onUpdateMaskWorkflow({
                    activeTool: 'mask-watershed-seed',
                    watershedSeedKind: value as WatershedSeedKind,
                  })
                }
                options={seedKinds}
              />
              <div className="mt-1.5 grid grid-cols-3 gap-1">
                <Button
                  variant={state.activeTool === 'mask-watershed-seed' ? 'primary' : 'ghost'}
                  size="sm"
                  block
                  disabled={!state.activeMaskId}
                  onClick={() =>
                    onUpdateMaskWorkflow({ activeTool: 'mask-watershed-seed' })
                  }
                >
                  {t('workflow.masks.seedTool')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  block
                  disabled={!state.activeMaskId}
                  onClick={onAddWatershedSeedAtCursor}
                >
                  {t('workflow.masks.addSeed')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  block
                  disabled={!state.activeMaskId || state.maskWorkflow.watershedSeeds.length === 0}
                  onClick={onApplyWatershedSeeds}
                >
                  {t('workflow.masks.applySeeds')}
                </Button>
              </div>
              <button
                type="button"
                className="mt-1 text-[11px] text-slate-500 hover:text-slate-200 disabled:opacity-50"
                disabled={state.maskWorkflow.watershedSeeds.length === 0}
                onClick={onClearWatershedSeeds}
              >
                {t('workflow.masks.seedCount', {
                  count: state.maskWorkflow.watershedSeeds.length,
                })}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            {state.segmentGroups.length > 0 ? (
              <div className="rounded border border-slate-800 bg-slate-950 p-2">
                <div className="mb-1.5 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  {t('workflow.masks.segmentGroups')}
                </div>
                <div className="space-y-1">
                  {state.segmentGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className={cn(
                        'w-full rounded border px-2 py-1.5 text-left',
                        state.activeSegmentGroupId === group.id
                          ? 'border-sky-500/70 bg-sky-500/10'
                          : 'border-slate-800 bg-slate-950 hover:border-slate-700',
                      )}
                      onClick={() =>
                        onUpdateStudyViewState({ activeSegmentGroupId: group.id })
                      }
                    >
                      <div className="truncate text-xs font-medium text-slate-200">
                        {group.name}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {group.segments.map((segment) => (
                          <span
                            key={segment.id}
                            className="inline-flex max-w-full items-center gap-1 rounded border border-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400"
                          >
                            <input
                              type="color"
                              className="h-3 w-3 shrink-0 cursor-pointer rounded-sm border border-white/20 bg-transparent p-0"
                              value={segment.color}
                              aria-label="Segment color"
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) =>
                                onUpdateSegment(group.id, segment.id, {
                                  color: event.currentTarget.value,
                                })
                              }
                            />
                            <span className="truncate">
                              {segment.value}: {segment.name}
                            </span>
                            <button
                              type="button"
                              className="rounded px-1 text-slate-500 hover:bg-slate-800 hover:text-slate-100"
                              aria-label={segment.visible ? t('common.hide') : t('common.show')}
                              onClick={(event) => {
                                event.stopPropagation();
                                onUpdateSegment(group.id, segment.id, {
                                  visible: !segment.visible,
                                });
                              }}
                            >
                              {segment.visible ? 'V' : 'H'}
                            </button>
                            <button
                              type="button"
                              className="rounded px-1 text-slate-500 hover:bg-slate-800 hover:text-slate-100"
                              aria-label={segment.locked ? 'Unlock segment' : 'Lock segment'}
                              onClick={(event) => {
                                event.stopPropagation();
                                onUpdateSegment(group.id, segment.id, {
                                  locked: !segment.locked,
                                });
                              }}
                            >
                              {segment.locked ? 'L' : 'U'}
                            </button>
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {state.masks.length === 0 ? (
              <div className="rounded border border-slate-800 bg-slate-950 px-2.5 py-2 text-xs text-slate-500">
                {t('workflow.masks.empty')}
              </div>
            ) : (
              state.masks.map((mask) => (
                <div
                  key={mask.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded border px-2 py-1.5 text-left',
                    state.activeMaskId === mask.id
                      ? 'border-sky-500/70 bg-sky-500/10'
                      : 'border-slate-800 bg-slate-950 hover:border-slate-700',
                  )}
                  onClick={() => onSelectMask(mask.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectMask(mask.id);
                    }
                  }}
                >
                  <input
                    type="color"
                    className="h-5 w-5 cursor-pointer rounded-sm border border-white/20 bg-transparent p-0"
                    value={mask.color}
                    aria-label={t('workflow.masks.color')}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      onUpdateMaskAppearance(mask.id, {
                        color: event.currentTarget.value,
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-slate-200">
                      {mask.name}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">
                      {mask.thresholdRange ? formatRange(mask.thresholdRange) : t('workflow.masks.manual')}{' '}
                      · {formatVoxelVolume(mask.voxelCount, spacing)}
                    </div>
                    <input
                      className="mt-1 h-1 w-full accent-sky-400"
                      type="range"
                      min={0.05}
                      max={1}
                      step={0.05}
                      value={mask.opacity}
                      aria-label={t('workflow.masks.opacity')}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        onUpdateMaskAppearance(mask.id, {
                          opacity: Number(event.currentTarget.value),
                        })
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="rounded p-1 text-slate-400 hover:bg-slate-900 hover:text-slate-100"
                    aria-label={mask.visible ? t('common.hide') : t('common.show')}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleMaskVisibility(mask.id);
                    }}
                  >
                    {mask.visible ? (
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      {tab === 'surfaces' ? (
        <div className="mt-3 space-y-3 text-xs text-slate-400">
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
            {t('workflow.surfaces.pipeline')}
          </div>
          <Button
            variant="primary"
            size="sm"
            block
            disabled={!state.activeMaskId || Boolean(surfaceStatus)}
            onClick={() => onCreateSurfaceFromActiveMask(surfaceQuality)}
          >
            <Layers3 className="h-3.5 w-3.5" aria-hidden="true" />
            {surfaceStatus || t('workflow.surfaces.createFromMask')}
          </Button>
          {surfaceStatus ? (
            <Button
              variant="ghost"
              size="sm"
              block
              onClick={onCancelSurfaceGeneration}
            >
              <Square className="h-3.5 w-3.5" aria-hidden="true" />
              {t('workflow.surfaces.cancel')}
            </Button>
          ) : null}
          {Object.values(SURFACE_GENERATION_PRESETS).map((preset) => (
            <button
              key={preset.quality}
              type="button"
              className={cn(
                'w-full rounded border px-2.5 py-2 text-left',
                surfaceQuality === preset.quality
                  ? 'border-sky-500/70 bg-sky-500/10'
                  : 'border-slate-800 bg-slate-950 hover:border-slate-700',
              )}
              onClick={() => setSurfaceQuality(preset.quality)}
            >
              <div className="font-medium capitalize text-slate-200">{preset.quality}</div>
              <div className="mt-1 text-slate-500">
                {t('workflow.surfaces.presetDetail', {
                  smooth: preset.smoothIterations,
                  decimate: Math.round(preset.decimateReduction * 100),
                })}
              </div>
            </button>
          ))}
          <div className="space-y-1.5">
            {state.surfaces.length === 0 ? (
              <div className="rounded border border-slate-800 bg-slate-950 px-2.5 py-2 text-xs text-slate-500">
                {t('workflow.surfaces.empty')}
              </div>
            ) : (
              state.surfaces.map((surface) => (
                <div
                  key={surface.id}
                  className="flex items-center gap-2 rounded border border-slate-800 bg-slate-950 px-2 py-1.5"
                >
                  <span
                    className="h-3 w-3 rounded-sm border border-white/20"
                    style={{ backgroundColor: surface.color }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-slate-200">
                      {surface.name}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">
                      {t('workflow.surfaces.triangles', {
                        count: surface.triangleCount?.toLocaleString() ?? '0',
                      })}
                      {surface.areaMm2
                        ? ` · ${Math.round(surface.areaMm2).toLocaleString()} mm2`
                        : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded p-1 text-slate-400 hover:bg-slate-900 hover:text-slate-100"
                    aria-label={surface.visible ? t('common.hide') : t('common.show')}
                    onClick={() => onToggleSurfaceVisibility(surface.id)}
                  >
                    {surface.visible ? (
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-slate-400 hover:bg-slate-900 hover:text-slate-100"
                    aria-label={t('workflow.surfaces.download')}
                    onClick={() => onDownloadSurface(surface.id)}
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="rounded px-1 py-0.5 text-[10px] font-semibold text-slate-400 hover:bg-slate-900 hover:text-slate-100"
                    aria-label={t('workflow.surfaces.downloadPly')}
                    onClick={() => onDownloadSurfacePly(surface.id)}
                  >
                    PLY
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      {tab === 'measures' ? (
        <div className="mt-3 space-y-2 text-xs text-slate-400">
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <Activity className="h-3.5 w-3.5" aria-hidden="true" />
            {t('workflow.measures.tools')}
          </div>
          <div>{t('workflow.measures.distance')}</div>
          <div>{t('workflow.measures.angle')}</div>
          <div>{t('workflow.measures.roi')}</div>
          <div className="mt-3 space-y-1.5">
            {state.annotations.length > 0 ? (
              <div className="mb-2 space-y-1.5">
                {state.annotations.map((annotation) => (
                  <button
                    key={annotation.id}
                    type="button"
                    className={cn(
                      'w-full rounded border bg-slate-950 px-2.5 py-2 text-left',
                      state.activeAnnotationId === annotation.id
                        ? 'border-sky-500/70'
                        : 'border-slate-800',
                    )}
                    onClick={() =>
                      onUpdateStudyViewState({
                        activeAnnotationId: annotation.id,
                      })
                    }
                  >
                    <div className="truncate font-medium text-slate-200">
                      {annotation.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {annotation.text} · {annotation.point.join(', ')}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
            {state.measurements.length === 0 ? (
              <div className="rounded border border-slate-800 bg-slate-950 px-2.5 py-2 text-xs text-slate-500">
                {t('workflow.measures.empty')}
              </div>
            ) : (
              state.measurements.map((measurement) => (
                <div
                  key={measurement.id}
                  className={cn(
                    'rounded border bg-slate-950 px-2.5 py-2',
                    state.activeMeasurementId === measurement.id
                      ? 'border-sky-500/70'
                      : 'border-slate-800',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-slate-200">
                        {measurement.name}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {measurement.kind} · {measurement.value.toFixed(1)}{' '}
                        {measurement.unit === 'degrees' ? 'deg' : measurement.unit}
                        {' · '}
                        {measurement.points.length} pts
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rounded p-1 text-slate-400 hover:bg-slate-900 hover:text-slate-100"
                      aria-label={t('workflow.measures.delete')}
                      onClick={() => onDeleteMeasurement(measurement.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      {tab === 'export' ? (
        <div className="mt-3 space-y-2 text-xs text-slate-400">
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <Waves className="h-3.5 w-3.5" aria-hidden="true" />
            {t('workflow.export.clientSide')}
          </div>
          <Button
            variant="primary"
            size="sm"
            block
            onClick={onExportProject}
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {t('workflow.export.downloadProject')}
          </Button>
          <input
            ref={projectInputRef}
            type="file"
            accept=".zip,.cbcter.zip,application/zip"
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) onImportProject(file);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            block
            onClick={() => projectInputRef.current?.click()}
          >
            <Download className="h-3.5 w-3.5 rotate-180" aria-hidden="true" />
            {t('workflow.export.importProject')}
          </Button>
          <div className="grid grid-cols-2 gap-1.5">
            <Button variant="ghost" size="sm" block onClick={onSaveLocalProject}>
              {t('workflow.export.saveLocal')}
            </Button>
            <Button variant="ghost" size="sm" block onClick={onRestoreLocalProject}>
              {t('workflow.export.restoreLocal')}
            </Button>
          </div>
          <div>{t('workflow.export.masks')}</div>
          <div>{t('workflow.export.surfaces')}</div>
          <div>{t('workflow.export.project')}</div>
        </div>
      ) : null}
    </section>
  );
}
