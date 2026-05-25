import { ArrowLeft, Download, LoaderCircle, ScanLine, Wand2, Eraser } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ViewerApp } from '../app/useViewerApp';
import { ArchEditor } from '../components/ArchEditor';
import { Button } from '../components/Button';
import { RangeField } from '../components/RangeField';
import { Select } from '../components/Select';
import {
  APP_ROUTES,
  LEVEL_MAX,
  LEVEL_MIN,
  WINDOW_MAX,
  WINDOW_MIN,
} from '../constants';
import { useTranslation } from '../i18n';
import { autoFitArch } from '../lib/panoramic/archFit';
import { reformatPanorama } from '../lib/panoramic/reformatPanorama';
import {
  DEFAULT_PANORAMIC_OPTIONS,
  type ArchCurve,
  type PanoramicProjection,
  type PanoramicResult,
} from '../lib/panoramic/types';

interface PanoramicPageProps {
  app: ViewerApp;
}

export default function PanoramicPage({ app }: PanoramicPageProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const volume = app.volume;
  const outputRef = useRef<HTMLCanvasElement>(null);

  const depth = volume?.meta.dimensions[2] ?? 1;
  const initialWL = volume?.meta.initialWindowLevel;
  const initialZMin = Math.floor(depth * 0.25);
  const initialZMax = Math.floor(depth * 0.75);

  const [zMin, setZMin] = useState(initialZMin);
  const [zMax, setZMax] = useState(initialZMax);
  const [window, setWindow] = useState(initialWL?.window ?? 3200);
  const [level, setLevel] = useState(initialWL?.level ?? 1600);
  const [depthMm, setDepthMm] = useState(DEFAULT_PANORAMIC_OPTIONS.depthMm);
  const [projection, setProjection] = useState<PanoramicProjection>(
    DEFAULT_PANORAMIC_OPTIONS.projection,
  );
  const [curve, setCurve] = useState<ArchCurve>(() =>
    volume
      ? autoFitArch(
          volume.voxels,
          volume.meta.dimensions,
          initialZMin,
          initialZMax,
        )
      : { controlPoints: [] },
  );
  const [result, setResult] = useState<PanoramicResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  if (!volume) return null;

  const autoFit = () => {
    setCurve(autoFitArch(volume.voxels, volume.meta.dimensions, zMin, zMax));
  };

  const clearCurve = () => setCurve({ controlPoints: [] });

  const generate = async () => {
    if (curve.controlPoints.length < 2) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const next = await reformatPanorama(
        volume,
        curve,
        {
          zMin,
          zMax,
          depthMm,
          depthStepMm: DEFAULT_PANORAMIC_OPTIONS.depthStepMm,
          archStepMm: DEFAULT_PANORAMIC_OPTIONS.archStepMm,
          projection,
          window,
          level,
        },
        setProgress,
      );
      setResult(next);
      const canvas = outputRef.current;
      if (canvas && next.width > 0) {
        canvas.width = next.width;
        canvas.height = next.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const imageData = ctx.createImageData(next.width, next.height);
          imageData.data.set(next.data);
          ctx.putImageData(imageData, 0, 0);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const exportPng = () => {
    const canvas = outputRef.current;
    if (!canvas || !result) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `cbcter-panoramic-${volume.meta.scanId ?? 'scan'}.png`;
    link.click();
  };

  const projectionOptions = [
    { value: 'mean', label: t('panoramic.projectionMean') },
    { value: 'mip', label: t('panoramic.projectionMip') },
  ];

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/90 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <ScanLine className="h-5 w-5 text-sky-400" aria-hidden="true" />
          <div>
            <h1 className="text-base font-semibold tracking-tight text-slate-50">
              {t('panoramic.title')}
            </h1>
            <p className="text-xs text-slate-500">{t('panoramic.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => navigate(APP_ROUTES.viewer)}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('panoramic.backToViewer')}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-hidden bg-slate-800 lg:flex-row">
        {/* Arch editor */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span>{t('panoramic.archSection')}</span>
            <span>
              {t('panoramic.pointCount', {
                count: curve.controlPoints.length,
              })}
            </span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
            <ArchEditor
              volume={volume}
              zMin={zMin}
              zMax={zMax}
              window={window}
              level={level}
              curve={curve}
              onChange={setCurve}
            />
          </div>
          <p className="border-t border-slate-800 px-3 py-2 text-[11px] text-slate-500">
            {t('panoramic.editHint')}
          </p>
        </section>

        {/* Controls + output */}
        <aside className="flex min-h-0 w-full flex-col gap-3 overflow-y-auto bg-slate-950 p-3 lg:w-[380px]">
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={autoFit}>
              <Wand2 className="h-4 w-4" aria-hidden="true" />
              {t('panoramic.autoFit')}
            </Button>
            <Button variant="ghost" onClick={clearCurve}>
              <Eraser className="h-4 w-4" aria-hidden="true" />
              {t('panoramic.clear')}
            </Button>
          </div>

          <div className="space-y-2.5 rounded border border-slate-800 bg-slate-950/70 p-2.5">
            <RangeField
              label={t('panoramic.zMin')}
              value={zMin}
              min={0}
              max={depth - 1}
              onChange={setZMin}
            />
            <RangeField
              label={t('panoramic.zMax')}
              value={zMax}
              min={0}
              max={depth - 1}
              onChange={setZMax}
            />
            <RangeField
              label={t('panoramic.depthMm')}
              value={depthMm}
              min={1}
              max={25}
              onChange={setDepthMm}
            />
            <RangeField
              label={t('panoramic.window')}
              value={window}
              min={WINDOW_MIN}
              max={WINDOW_MAX}
              onChange={setWindow}
            />
            <RangeField
              label={t('panoramic.level')}
              value={level}
              min={LEVEL_MIN}
              max={LEVEL_MAX}
              onChange={setLevel}
            />
            <label className="block text-[11px] uppercase tracking-[0.18em] text-slate-500">
              {t('panoramic.projection')}
            </label>
            <Select
              value={projection}
              onChange={(value) => setProjection(value as PanoramicProjection)}
              options={projectionOptions}
            />
          </div>

          <Button
            variant="primary"
            block
            onClick={() => void generate()}
            disabled={busy || curve.controlPoints.length < 2}
          >
            {busy ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ScanLine className="h-4 w-4" aria-hidden="true" />
            )}
            {busy
              ? t('panoramic.generating', {
                  percent: Math.round(progress * 100),
                })
              : t('panoramic.generate')}
          </Button>

          {error ? (
            <p className="rounded border border-rose-800 bg-rose-950/40 px-2.5 py-2 text-xs text-rose-300">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 rounded border border-slate-800 bg-slate-950/70 p-2.5">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-slate-500">
              <span>{t('panoramic.output')}</span>
              {result ? (
                <button
                  type="button"
                  onClick={exportPng}
                  className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  PNG
                </button>
              ) : null}
            </div>
            <div className="overflow-auto rounded bg-black">
              <canvas
                ref={outputRef}
                className="block h-auto w-full"
                style={{ imageRendering: 'auto' }}
              />
            </div>
            {result ? (
              <p className="text-[11px] text-slate-500">
                {t('panoramic.calibration', {
                  width: result.width,
                  height: result.height,
                  mmx: result.mmPerPixelX.toFixed(2),
                  mmy: result.mmPerPixelY.toFixed(2),
                })}
              </p>
            ) : (
              <p className="text-[11px] text-slate-500">
                {t('panoramic.outputEmpty')}
              </p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
