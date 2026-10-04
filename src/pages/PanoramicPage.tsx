import { toothCrossSection } from '../lib/panoramic/crossSection';
import {
  ArrowLeft,
  Download,
  LoaderCircle,
  ScanLine,
  Wand2,
  Eraser,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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

  const setCaseWorkspace = app.setCaseWorkspace;
  const saved = app.caseWorkspace?.state.dentalArch;
  const depth = volume?.meta.dimensions[2] ?? 1;
  const initialWL = volume?.meta.initialWindowLevel;
  const initialZMin = Math.floor(depth * 0.25);
  const initialZMax = Math.floor(depth * 0.75);

  const [zMin, setZMin] = useState(saved?.options.zMin ?? initialZMin);
  const [zMax, setZMax] = useState(saved?.options.zMax ?? initialZMax);
  const [window, setWindow] = useState(
    saved?.options.window ?? initialWL?.window ?? 3200,
  );
  const [level, setLevel] = useState(
    saved?.options.level ?? initialWL?.level ?? 1600,
  );
  const [depthMm, setDepthMm] = useState(
    saved?.options.depthMm ?? DEFAULT_PANORAMIC_OPTIONS.depthMm,
  );
  const [projection, setProjection] = useState<PanoramicProjection>(
    saved?.options.projection ?? DEFAULT_PANORAMIC_OPTIONS.projection,
  );
  const [curve, setCurve] = useState<ArchCurve>(
    () =>
      saved?.curve ??
      (volume
        ? autoFitArch(
            volume.voxels,
            volume.meta.dimensions,
            initialZMin,
            initialZMax,
          )
        : { controlPoints: [] }),
  );
  const [result, setResult] = useState<PanoramicResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [widthMm, setWidthMm] = useState(saved?.crossSection.widthMm ?? 20),
    [angleDeg, setAngleDeg] = useState(saved?.crossSection.angleDeg ?? 0);
  const [toothId, setToothId] = useState(
    app.caseWorkspace?.state.selectedInstanceId ?? '',
  );
  const crossRef = useRef<HTMLCanvasElement>(null);
  const selectedTooth = app.caseWorkspace?.state.toothInstances?.find(
    (t) => t.id === toothId,
  );
  const cross = useMemo(
    () =>
      volume
        ? toothCrossSection(
            volume,
            curve,
            selectedTooth?.centroid ?? [
              app.cursor?.x ?? 0,
              app.cursor?.y ?? 0,
              app.cursor?.z ?? 0,
            ],
            { widthMm, angleDeg, window, level },
          )
        : null,
    [
      volume,
      curve,
      selectedTooth,
      app.cursor,
      widthMm,
      angleDeg,
      window,
      level,
    ],
  );
  useEffect(() => {
    if (!cross || !crossRef.current) return;
    const canvas = crossRef.current;
    canvas.width = cross.width;
    canvas.height = cross.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const image = ctx.createImageData(cross.width, cross.height);
      image.data.set(cross.data);
      ctx.putImageData(image, 0, 0);
    }
  }, [cross]);
  useEffect(() => {
    setCaseWorkspace((c) =>
      c
        ? {
            ...c,
            state: {
              ...c.state,
              selectedInstanceId: toothId || c.state.selectedInstanceId,
              dentalArch: {
                curve,
                options: {
                  ...DEFAULT_PANORAMIC_OPTIONS,
                  zMin,
                  zMax,
                  window,
                  level,
                  depthMm,
                  projection,
                },
                crossSection: { widthMm, angleDeg },
              },
            },
          }
        : c,
    );
  }, [
    curve,
    zMin,
    zMax,
    window,
    level,
    depthMm,
    projection,
    widthMm,
    angleDeg,
    toothId,
    setCaseWorkspace,
  ]);

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
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-slate-950 text-slate-100">
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

      {/* Phones scroll the whole page (arch editor, then controls); large
          screens keep the side-by-side, non-scrolling layout. */}
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto bg-slate-800 lg:flex-row lg:overflow-hidden">
        {/* Arch editor */}
        <section className="flex min-h-[62dvh] min-w-0 shrink-0 flex-col bg-slate-950 lg:min-h-0 lg:flex-1 lg:shrink">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span>{t('panoramic.archSection')}</span>
            <span>
              {t('panoramic.pointCount', {
                count: curve.controlPoints.length,
              })}
            </span>
          </div>
          <div className="relative m-3 h-[42dvh] min-h-[280px] shrink-0 overflow-hidden lg:h-auto lg:min-h-0 lg:flex-1 lg:shrink">
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
          <details
            className="max-h-[50dvh] shrink-0 overflow-y-auto border-t border-slate-800 p-3"
            open
          >
            <summary className="min-h-11 cursor-pointer py-2 text-sm text-slate-200">
              Tooth-centred cross-section
            </summary>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="text-xs">
                Centre
                <select
                  aria-label="Cross-section tooth"
                  className="min-h-11 w-full rounded bg-slate-900 p-2"
                  value={toothId}
                  onChange={(e) => setToothId(e.target.value)}
                >
                  <option value="">Current crosshair</option>
                  {app.caseWorkspace?.state.toothInstances?.map((t, i) => (
                    <option key={t.id} value={t.id}>
                      {t.fdi ? `FDI ${t.fdi}` : `Unassigned tooth ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <RangeField
                label="Section width (mm)"
                aria-label="Section width (mm)"
                value={widthMm}
                min={5}
                max={50}
                onChange={setWidthMm}
              />
              <RangeField
                label="Section angle (degrees)"
                aria-label="Section angle (degrees)"
                value={angleDeg}
                min={-90}
                max={90}
                onChange={setAngleDeg}
              />
            </div>
            <p className="my-2 text-xs text-slate-400">
              Buccal–lingual plane through the selected tooth, perpendicular to
              the nearest arch tangent. Vertical direction follows scan Z.
            </p>
            <canvas
              ref={crossRef}
              data-testid="tooth-cross-section"
              className="mx-auto max-h-48 max-w-full bg-black"
              style={
                cross
                  ? {
                      width:
                        (192 * cross.width * cross.mmPerPixelX) /
                        (cross.height * cross.mmPerPixelY),
                      height: 'auto',
                      aspectRatio: `${cross.width * cross.mmPerPixelX} / ${cross.height * cross.mmPerPixelY}`,
                    }
                  : {}
              }
            />
            <button
              className="min-h-11 rounded border border-slate-700 px-3 text-sm"
              onClick={() => {
                if (!crossRef.current) return;
                const a = document.createElement('a');
                a.href = crossRef.current.toDataURL('image/png');
                a.download = 'tooth-cross-section.png';
                a.click();
              }}
            >
              Save cross-section PNG
            </button>
          </details>
          <p className="border-t border-slate-800 px-3 py-2 text-[11px] text-slate-500">
            {t('panoramic.editHint')}
          </p>
        </section>

        {/* Controls + output */}
        <aside className="flex w-full shrink-0 flex-col gap-3 bg-slate-950 p-3 lg:min-h-0 lg:w-[380px] lg:shrink lg:overflow-y-auto">
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
              <LoaderCircle
                className="h-4 w-4 animate-spin"
                aria-hidden="true"
              />
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
                style={{
                  imageRendering: 'auto',
                  aspectRatio: result
                    ? `${result.width * result.mmPerPixelX} / ${result.height * result.mmPerPixelY}`
                    : undefined,
                }}
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
