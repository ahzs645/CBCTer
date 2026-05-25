import { Download, FlaskConical, LoaderCircle, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ViewerApp } from '../app/useViewerApp';
import { APP_ROUTES } from '../constants';
import { useTranslation } from '../i18n';
import { maskToBinaryStl } from '../lib/segmentation/maskMesh';
import {
  type SegmentationProgress,
  segmentToothROI,
  type ToothSegmentationResult,
} from '../lib/segmentation/toothInference';
import type { ToothRoi } from '../lib/segmentation/roi';
import { clampRoi } from '../lib/segmentation/roi';
import { Button } from './Button';
import { Notice } from './Notice';
import { RangeField } from './RangeField';
import { ToothMeshViewport } from './ToothMeshViewport';

interface LiveToothSegmentationProps {
  app: ViewerApp;
}

const MAX_SIZE = 144;

export function LiveToothSegmentation({ app }: LiveToothSegmentationProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const volume = app.volume;
  const [width, height, depth] = app.dimensions;

  const [center, setCenter] = useState<[number, number, number]>([
    app.cursor?.x ?? Math.floor(width / 2),
    app.cursor?.y ?? Math.floor(height / 2),
    app.cursor?.z ?? Math.floor(depth / 2),
  ]);
  const [size, setSize] = useState(96);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SegmentationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ToothSegmentationResult | null>(null);
  const [meshUrl, setMeshUrl] = useState<string | null>(null);
  const meshUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (meshUrlRef.current) URL.revokeObjectURL(meshUrlRef.current);
    };
  }, []);

  if (!volume) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Notice>{t('teeth.live.needVolume')}</Notice>
        <Button
          variant="primary"
          className="mt-3"
          onClick={() => navigate(APP_ROUTES.import)}
        >
          {t('teeth.live.goToImport')}
        </Button>
      </div>
    );
  }

  const buildRoi = (): ToothRoi => {
    const half = Math.round(size / 2);
    return clampRoi(
      {
        min: [center[0] - half, center[1] - half, center[2] - half],
        max: [center[0] + half, center[1] + half, center[2] + half],
      },
      app.dimensions,
    );
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress({ completed: 0, total: 1 });
    try {
      const roi = buildRoi();
      const segmentation = await segmentToothROI(volume, roi, setProgress);
      setResult(segmentation);

      const blob = maskToBinaryStl(
        segmentation.mask,
        segmentation.dims,
        segmentation.spacing,
      );
      if (meshUrlRef.current) URL.revokeObjectURL(meshUrlRef.current);
      const url = URL.createObjectURL(blob);
      meshUrlRef.current = url;
      setMeshUrl(url);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Segmentation failed.',
      );
    } finally {
      setRunning(false);
    }
  };

  const pct = progress
    ? Math.round((progress.completed / Math.max(1, progress.total)) * 100)
    : 0;
  const roi = buildRoi();
  const roiDims = [
    roi.max[0] - roi.min[0],
    roi.max[1] - roi.min[1],
    roi.max[2] - roi.min[2],
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-px overflow-hidden bg-slate-800 lg:flex-row">
      <section className="flex min-h-0 w-full flex-col gap-3 overflow-y-auto bg-slate-950 p-4 lg:w-[360px]">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
          <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
          {t('teeth.live.title')}
        </div>
        <p className="text-xs text-slate-400">{t('teeth.live.description')}</p>

        <RangeField
          label={t('teeth.live.centerX')}
          min={0}
          max={Math.max(1, width - 1)}
          value={center[0]}
          onChange={(v) => setCenter(([, y, z]) => [v, y, z])}
        />
        <RangeField
          label={t('teeth.live.centerY')}
          min={0}
          max={Math.max(1, height - 1)}
          value={center[1]}
          onChange={(v) => setCenter(([x, , z]) => [x, v, z])}
        />
        <RangeField
          label={t('teeth.live.centerZ')}
          min={0}
          max={Math.max(1, depth - 1)}
          value={center[2]}
          onChange={(v) => setCenter(([x, y]) => [x, y, v])}
        />
        <RangeField
          label={t('teeth.live.size')}
          min={16}
          max={MAX_SIZE}
          value={size}
          onChange={setSize}
          hint={t('teeth.live.sizeHint', {
            dims: roiDims.join(' x '),
          })}
        />

        <Button variant="primary" block onClick={run} disabled={running}>
          {running ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="h-4 w-4" aria-hidden="true" />
          )}
          {running ? t('teeth.live.running') : t('teeth.live.run')}
        </Button>

        {running ? (
          <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
              <span
                className="block h-full rounded-full bg-sky-400 transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {t('teeth.live.windowProgress', {
                completed: progress?.completed ?? 0,
                total: progress?.total ?? 0,
              })}
            </p>
          </div>
        ) : null}

        {error ? <Notice variant="error">{error}</Notice> : null}

        {result ? (
          <div className="rounded border border-slate-800 bg-slate-950/70 p-2.5 text-xs text-slate-300">
            <div className="font-medium text-slate-100">
              {t('teeth.live.resultTitle')}
            </div>
            <div className="mt-1 text-slate-400">
              {t('teeth.live.voxelCount', {
                count: result.voxelCount.toLocaleString(),
              })}
            </div>
            <div className="text-slate-400">
              {t('teeth.live.cropDims', { dims: result.dims.join(' x ') })}
            </div>
            {meshUrl ? (
              <a
                href={meshUrl}
                download="tooth-segmentation.stl"
                className="mt-2 inline-flex items-center gap-1.5 text-sky-400 hover:text-sky-300"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                {t('teeth.live.downloadStl')}
              </a>
            ) : null}
          </div>
        ) : null}

        <Notice compact>{t('common.referenceOnly')}</Notice>
      </section>

      <section className="relative min-h-0 flex-1 bg-slate-950">
        <div className="border-b border-slate-800 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
          {t('teeth.live.meshTitle')}
        </div>
        <div className="relative h-[calc(100%-2.5rem)]">
          <ToothMeshViewport src={meshUrl} />
        </div>
      </section>
    </div>
  );
}
