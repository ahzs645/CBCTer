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
  Waves,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type { StudyState } from '../domain/types';
import { useTranslation } from '../i18n';
import { SURFACE_GENERATION_PRESETS } from '../lib/surface';
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
  onCreateThresholdMask: (preset: ThresholdPreset) => void;
  onCreateSurfaceFromActiveMask: () => void;
  onDownloadSurface: (surfaceId: string) => void;
  onExportProject: () => void;
  onFillMaskHoles: () => void;
  onKeepLargestMaskComponent: () => void;
  onImportProject: (file: File) => void;
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
  onCreateThresholdMask,
  onCreateSurfaceFromActiveMask,
  onDownloadSurface,
  onExportProject,
  onFillMaskHoles,
  onKeepLargestMaskComponent,
  onImportProject,
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
  const selectedThreshold =
    THRESHOLD_PRESETS.find((preset) => preset.id === thresholdPresetId) ??
    THRESHOLD_PRESETS[0];

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
        <div className="mt-3 space-y-2 text-xs text-slate-400">
          <div className="font-medium text-slate-100">{state.study?.name}</div>
          <div>{t('workflow.study.images', { count: state.images.length })}</div>
          <div>{t('workflow.study.dimensions', { dimensions: dimensions.join(' x ') })}</div>
          <div>{t('workflow.study.spacing', { spacing: spacing.map((item) => item.toFixed(2)).join(' x ') })}</div>
          <div>{t('workflow.study.activeTool', { tool: state.activeTool })}</div>
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
                disabled={!state.activeMaskId}
                onClick={onKeepLargestMaskComponent}
              >
                <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
                {t('workflow.masks.keepLargest')}
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
          </div>

          <div className="space-y-1.5">
            {state.masks.length === 0 ? (
              <div className="rounded border border-slate-800 bg-slate-950 px-2.5 py-2 text-xs text-slate-500">
                {t('workflow.masks.empty')}
              </div>
            ) : (
              state.masks.map((mask) => (
                <div
                  key={mask.id}
                  className="flex items-center gap-2 rounded border border-slate-800 bg-slate-950 px-2 py-1.5"
                >
                  <span
                    className="h-3 w-3 rounded-sm border border-white/20"
                    style={{ backgroundColor: mask.color }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-slate-200">
                      {mask.name}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">
                      {mask.thresholdRange ? formatRange(mask.thresholdRange) : t('workflow.masks.manual')}{' '}
                      · {formatVoxelVolume(mask.voxelCount, spacing)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded p-1 text-slate-400 hover:bg-slate-900 hover:text-slate-100"
                    aria-label={mask.visible ? t('common.hide') : t('common.show')}
                    onClick={() => onToggleMaskVisibility(mask.id)}
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
            disabled={!state.activeMaskId}
            onClick={onCreateSurfaceFromActiveMask}
          >
            <Layers3 className="h-3.5 w-3.5" aria-hidden="true" />
            {t('workflow.surfaces.createFromMask')}
          </Button>
          {Object.values(SURFACE_GENERATION_PRESETS).map((preset) => (
            <div key={preset.quality} className="rounded border border-slate-800 bg-slate-950 px-2.5 py-2">
              <div className="font-medium capitalize text-slate-200">{preset.quality}</div>
              <div className="mt-1 text-slate-500">
                {t('workflow.surfaces.presetDetail', {
                  smooth: preset.smoothIterations,
                  decimate: Math.round(preset.decimateReduction * 100),
                })}
              </div>
            </div>
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
          <div>{t('workflow.export.masks')}</div>
          <div>{t('workflow.export.surfaces')}</div>
          <div>{t('workflow.export.project')}</div>
        </div>
      ) : null}
    </section>
  );
}
