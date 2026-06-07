import { Brain, Download, LoaderCircle, Play, Square } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ViewerApp } from '../app/useViewerApp';
import { APP_ROUTES } from '../constants';
import { useTranslation } from '../i18n';
import {
  buildAnatomySurfaceArchive,
  type AnatomyExportProgress,
} from '../lib/segmentation/anatomyExport';
import {
  type DentalAnatomyProgress,
  type DentalAnatomyResult,
  segmentDentalAnatomy,
} from '../lib/segmentation/dentalSegmentation';
import { summarizeDentalVariant } from '../lib/segmentation/dentalSegmentGroup';
import {
  DEFAULT_DENTAL_SEG_VARIANT,
  DENTAL_SEG_VARIANTS,
  type DentalSegVariantId,
} from '../lib/segmentation/dentalSegVariants';
import {
  extractLabelmapOverlayImage,
  type LabelmapOverlayLayer,
} from '../lib/segmentation/maskOperations';
import { formatVolume } from '../lib/segmentation/types';
import { extractAxialImage } from '../lib/volume';
import { VolumeAxis, type VolumeCursor } from '../types';
import { SliceCanvas } from '../viewer/react/SliceCanvas';
import { Button } from './Button';
import { Notice } from './Notice';
import { RangeField } from './RangeField';
import { Select } from './Select';
import type { SurfaceGenerationQuality } from '../lib/surface';

interface FullAnatomySegmentationProps {
  app: ViewerApp;
}

/**
 * "Full anatomy segmentation" action: runs the DentalSegmentator nnU-Net worker
 * over the whole volume and presents the result as a multi-label segment group
 * (skull / mandible / upper teeth / lower teeth / canal) with per-class
 * visibility toggles and an axial overlay preview.
 */
export function FullAnatomySegmentation({ app }: FullAnatomySegmentationProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const volume = app.volume;
  const [width, height, depth] = app.dimensions;

  const [variant, setVariant] = useState<DentalSegVariantId>(
    DEFAULT_DENTAL_SEG_VARIANT,
  );
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<DentalAnatomyProgress | null>(null);
  const [exportProgress, setExportProgress] =
    useState<AnatomyExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DentalAnatomyResult | null>(null);
  const [visibility, setVisibility] = useState<Record<number, boolean>>({});
  const [sliceZ, setSliceZ] = useState(Math.floor(depth / 2));
  const [surfaceQuality, setSurfaceQuality] =
    useState<SurfaceGenerationQuality>('balanced');
  const [logs, setLogs] = useState<string[]>([]);
  const runAbortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  const stats = useMemo(
    () =>
      result
        ? summarizeDentalVariant(result.labelmap, result.spacing, result.variant)
        : [],
    [result],
  );

  const preview = useMemo(() => {
    if (!volume || !result) return null;
    const cursor: VolumeCursor = {
      x: Math.floor(width / 2),
      y: Math.floor(height / 2),
      z: Math.max(0, Math.min(depth - 1, sliceZ)),
    };
    const base = extractAxialImage(volume, cursor);
    const layer: LabelmapOverlayLayer = {
      labelmap: result.labelmap,
      opacity: 1,
      visible: true,
      segments: stats.map((stat) => ({
        value: stat.value,
        color: stat.color,
        opacity: 1,
        visible: visibility[stat.value] ?? true,
      })),
    };
    const overlay = extractLabelmapOverlayImage(
      [layer],
      VolumeAxis.Axial,
      cursor,
      app.dimensions,
      app.spacing,
    );
    return { base, overlay };
  }, [
    volume,
    result,
    stats,
    visibility,
    sliceZ,
    width,
    height,
    depth,
    app.dimensions,
    app.spacing,
  ]);

  if (!volume) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Notice>{t('anatomy.needVolume')}</Notice>
        <Button
          variant="primary"
          className="mt-3"
          onClick={() => navigate(APP_ROUTES.import)}
        >
          {t('anatomy.goToImport')}
        </Button>
      </div>
    );
  }

  const run = async () => {
    const controller = new AbortController();
    runAbortRef.current = controller;
    setRunning(true);
    setError(null);
    setResult(null);
    setLogs([
      `${new Date().toLocaleTimeString()} :: Starting DentalSegmentator run`,
      `${new Date().toLocaleTimeString()} :: Small-island cleanup: 60 mm3, mandibular canal preserved`,
    ]);
    setProgress({ completed: 0, total: 1 });
    try {
      const res = await segmentDentalAnatomy(volume, (next) => {
        setProgress(next);
        setLogs((current) => [
          ...current,
          `${new Date().toLocaleTimeString()} :: Patch ${next.completed} of ${next.total}`,
        ].slice(-80));
      }, {
        signal: controller.signal,
        variant,
      });
      setResult(res);
      const vis: Record<number, boolean> = {};
      for (const stat of summarizeDentalVariant(res.labelmap, res.spacing, res.variant)) {
        vis[stat.value] = true;
      }
      setVisibility(vis);
      setSliceZ(Math.floor(depth / 2));
      setLogs((current) => [
        ...current,
        `${new Date().toLocaleTimeString()} :: Inference completed`,
      ]);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        setLogs((current) => [
          ...current,
          `${new Date().toLocaleTimeString()} :: Run canceled`,
        ]);
      } else {
        setError(cause instanceof Error ? cause.message : 'Segmentation failed.');
      }
    } finally {
      setRunning(false);
      runAbortRef.current = null;
    }
  };

  const cancelRun = () => runAbortRef.current?.abort();
  const cancelExport = () => exportAbortRef.current?.abort();

  const exportResult = async () => {
    if (!result) return;
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExporting(true);
    setError(null);
    try {
      const archive = await buildAnatomySurfaceArchive({
        labelmap: result.labelmap,
        stats,
        dims: result.dims,
        spacing: result.spacing,
        quality: surfaceQuality,
        signal: controller.signal,
        onProgress: setExportProgress,
      });
      const url = URL.createObjectURL(archive);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'cbcter-full-anatomy-surfaces.zip';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setLogs((current) => [
        ...current,
        `${new Date().toLocaleTimeString()} :: Exported anatomy surfaces`,
      ]);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(cause instanceof Error ? cause.message : 'Export failed.');
      }
    } finally {
      setExporting(false);
      setExportProgress(null);
      exportAbortRef.current = null;
    }
  };

  const pct = progress
    ? Math.round((progress.completed / Math.max(1, progress.total)) * 100)
    : 0;

  const toggle = (value: number) =>
    setVisibility((prev) => ({ ...prev, [value]: !(prev[value] ?? true) }));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-px overflow-hidden bg-slate-800 lg:flex-row">
      <section className="flex min-h-0 w-full flex-col gap-3 overflow-y-auto bg-slate-950 p-4 lg:w-[360px]">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
          <Brain className="h-3.5 w-3.5" aria-hidden="true" />
          {t('anatomy.title')}
        </div>
        <p className="text-xs text-slate-400">{t('anatomy.description')}</p>

        <label className="block space-y-1">
          <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
            {t('anatomy.model')}
          </span>
          <Select
            block
            size="sm"
            value={variant}
            onChange={(value) => setVariant(value as DentalSegVariantId)}
            options={Object.values(DENTAL_SEG_VARIANTS).map((config) => ({
              value: config.id,
              label: t(`anatomy.variants.${config.i18nKey}`),
            }))}
          />
        </label>

        <Button variant="primary" block onClick={run} disabled={running}>
          {running ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="h-4 w-4" aria-hidden="true" />
          )}
          {running ? t('anatomy.running') : t('anatomy.run')}
        </Button>
        {running ? (
          <Button variant="ghost" block onClick={cancelRun}>
            <Square className="h-4 w-4" aria-hidden="true" />
            {t('anatomy.cancel')}
          </Button>
        ) : null}

        {running ? (
          <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
              <span
                className="block h-full rounded-full bg-sky-400 transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {t('anatomy.windowProgress', {
                completed: progress?.completed ?? 0,
                total: progress?.total ?? 0,
              })}
            </p>
          </div>
        ) : null}

        {error ? <Notice variant="error">{error}</Notice> : null}

        {result ? (
          <>
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
              {t('anatomy.segments')}
            </div>
            <ul className="flex flex-col gap-1">
              {stats.map((stat) => (
                <li
                  key={stat.value}
                  className="flex items-center gap-2 rounded border border-slate-800 bg-slate-950/70 px-2.5 py-1.5 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={visibility[stat.value] ?? true}
                    onChange={() => toggle(stat.value)}
                    aria-label={stat.name}
                  />
                  <span
                    className="h-3 w-3 shrink-0 rounded-sm"
                    style={{ backgroundColor: stat.color }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-slate-200">
                    {stat.name}
                  </span>
                  <span className="text-slate-500">
                    {stat.voxelCount > 0 ? formatVolume(stat.volumeMm3) : '—'}
                  </span>
                </li>
              ))}
            </ul>

            <RangeField
              label={t('anatomy.slice')}
              min={0}
              max={Math.max(1, depth - 1)}
              value={sliceZ}
              onChange={setSliceZ}
            />
            <label className="block space-y-1">
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                {t('anatomy.surfaceQuality')}
              </span>
              <Select
                block
                size="sm"
                value={surfaceQuality}
                onChange={(value) =>
                  setSurfaceQuality(value as SurfaceGenerationQuality)
                }
                options={[
                  { value: 'draft', label: t('anatomy.qualityDraft') },
                  { value: 'balanced', label: t('anatomy.qualityBalanced') },
                  { value: 'final', label: t('anatomy.qualityFinal') },
                ]}
              />
            </label>
            <Button
              variant="ghost"
              block
              onClick={() => void exportResult()}
              disabled={exporting}
            >
              {exporting ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-4 w-4" aria-hidden="true" />
              )}
              {exporting ? t('anatomy.exporting') : t('anatomy.export')}
            </Button>
            {exporting ? (
              <Button variant="ghost" block onClick={cancelExport}>
                <Square className="h-4 w-4" aria-hidden="true" />
                {t('anatomy.cancelExport')}
              </Button>
            ) : null}
            {exportProgress ? (
              <p className="text-[11px] text-slate-500">
                {t('anatomy.exportProgress', {
                  label: exportProgress.label,
                  phase: exportProgress.phase,
                  completed: exportProgress.completed,
                  total: exportProgress.total,
                })}
              </p>
            ) : null}
          </>
        ) : null}

        {logs.length > 0 ? (
          <details className="rounded border border-slate-800 bg-slate-950 p-2 text-[11px] text-slate-500">
            <summary className="cursor-pointer text-slate-300">
              {t('anatomy.runDetails')}
            </summary>
            <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap font-mono">
              {logs.join('\n')}
            </pre>
          </details>
        ) : null}

        <Notice compact>{t('anatomy.perfNote')}</Notice>
        <Notice compact>{t('common.referenceOnly')}</Notice>
      </section>

      <section className="relative min-h-0 flex-1 bg-slate-950">
        <div className="border-b border-slate-800 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
          {t('anatomy.previewTitle')}
        </div>
        <div className="relative h-[calc(100%-2.5rem)] p-3">
          {preview ? (
            <SliceCanvas
              image={preview.base}
              overlay={preview.overlay}
              displayAspect={preview.overlay?.displayAspect}
              label={t('anatomy.axial')}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              {t('anatomy.previewEmpty')}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
