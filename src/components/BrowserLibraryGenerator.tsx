import { Boxes, LoaderCircle, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ViewerApp } from '../app/useViewerApp';
import { APP_ROUTES } from '../constants';
import { useTranslation } from '../i18n';
import { clampRoi, type ToothRoi } from '../lib/segmentation/roi';
import { SEGMENTATION_ALGORITHMS } from '../lib/segmentation/types';
import type { UseSegmentation } from '../lib/segmentation/useSegmentation';
import { cn } from '../utils/cn';
import { Button } from './Button';
import { Notice } from './Notice';
import { RangeField } from './RangeField';

interface BrowserLibraryGeneratorProps {
  app: ViewerApp;
  seg: UseSegmentation;
}

const DEFAULT_SIZE = 160;
const MIN_SIZE = 96;
const MAX_SIZE = 240;
const DEFAULT_SEPARATION = 3;
const MIN_SEPARATION = 1;
const MAX_SEPARATION = 12;

/**
 * Empty-state for the library tab when no manifest is loaded: generate the
 * separated-tooth library fully in the browser (UNet over an arch ROI, then
 * instance separation), mirroring the SlicerCBCTToothSegmentation workflow of
 * adjusting an ROI box and applying — no server and no Python pipeline.
 */
export function BrowserLibraryGenerator({
  app,
  seg,
}: BrowserLibraryGeneratorProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const volume = app.volume;
  const [width, height, depth] = app.dimensions;

  const [center, setCenter] = useState<[number, number, number]>([
    app.cursor?.x ?? Math.floor(width / 2),
    app.cursor?.y ?? Math.floor(height / 2),
    app.cursor?.z ?? Math.floor(depth / 2),
  ]);
  const sizeCap = Math.min(MAX_SIZE, Math.max(width, height, depth));
  const [size, setSize] = useState(Math.min(DEFAULT_SIZE, sizeCap));
  // Watershed marker distance (voxels): lower splits touching teeth more,
  // higher merges them. See watershedSplit().
  const [separation, setSeparation] = useState(DEFAULT_SEPARATION);

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

  const roi = buildRoi();
  const roiDims = [
    roi.max[0] - roi.min[0],
    roi.max[1] - roi.min[1],
    roi.max[2] - roi.min[2],
  ];
  const noResults =
    !!seg.manifest && seg.manifest.items.length === 0 && !seg.generating;

  const progressLabel = () => {
    const p = seg.genProgress;
    if (!p) return t('teeth.gen.starting');
    if (p.phase === 'separation') return t('teeth.gen.separating');
    if (p.phase === 'meshing') {
      return t('teeth.gen.meshing', { completed: p.completed, total: p.total });
    }
    return t('teeth.gen.inferring', {
      completed: p.completed,
      total: p.total,
    });
  };
  const pct = seg.genProgress
    ? Math.round(
        (seg.genProgress.completed / Math.max(1, seg.genProgress.total)) * 100,
      )
    : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-950">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-6 py-10">
        <div className="flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-slate-800 bg-slate-900">
            <Boxes className="h-6 w-6 text-sky-400" aria-hidden="true" />
          </div>
          <h2 className="text-base font-semibold text-slate-100">
            {t('teeth.gen.title')}
          </h2>
          <p className="mt-1.5 text-xs leading-5 text-slate-400">
            {t('teeth.gen.description')}
          </p>
        </div>

        {seg.error ? (
          <Notice compact>{t('teeth.gen.unavailableNote')}</Notice>
        ) : null}

        {!volume ? (
          <div className="flex flex-col gap-3">
            <Notice>{t('teeth.gen.needVolume')}</Notice>
            <Button
              variant="primary"
              block
              onClick={() => navigate(APP_ROUTES.import)}
            >
              {t('teeth.gen.goToImport')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded border border-slate-800 bg-slate-900/40 p-4">
            <RangeField
              label={t('teeth.gen.centerX')}
              min={0}
              max={Math.max(1, width - 1)}
              value={center[0]}
              onChange={(v) => setCenter(([, y, z]) => [v, y, z])}
            />
            <RangeField
              label={t('teeth.gen.centerY')}
              min={0}
              max={Math.max(1, height - 1)}
              value={center[1]}
              onChange={(v) => setCenter(([x, , z]) => [x, v, z])}
            />
            <RangeField
              label={t('teeth.gen.centerZ')}
              min={0}
              max={Math.max(1, depth - 1)}
              value={center[2]}
              onChange={(v) => setCenter(([x, y]) => [x, y, v])}
            />
            <RangeField
              label={t('teeth.gen.size')}
              min={MIN_SIZE}
              max={Math.max(MIN_SIZE, sizeCap)}
              value={size}
              onChange={setSize}
              hint={t('teeth.gen.sizeHint', { dims: roiDims.join(' × ') })}
            />
            <RangeField
              label={t('teeth.gen.separation')}
              min={MIN_SEPARATION}
              max={MAX_SEPARATION}
              value={separation}
              onChange={setSeparation}
              hint={t('teeth.gen.separationHint')}
            />

            <Button
              variant="primary"
              block
              disabled={seg.generating}
              onClick={() => void seg.generate(volume, buildRoi(), separation)}
            >
              {seg.generating ? (
                <LoaderCircle
                  className="h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              )}
              {seg.generating ? t('teeth.gen.generating') : t('teeth.gen.run')}
            </Button>

            {seg.generating ? (
              <div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <span
                    className="block h-full rounded-full bg-sky-400 transition-[width]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {progressLabel()}
                </p>
              </div>
            ) : null}

            {noResults ? (
              <Notice compact>{t('teeth.gen.noResults')}</Notice>
            ) : null}
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-slate-800 pt-4">
          <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
            {t('teeth.gen.tryPrebuilt')}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {SEGMENTATION_ALGORITHMS.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={seg.loading || seg.generating}
                onClick={() => seg.setAlgorithm(option.id)}
                className={cn(
                  'rounded border px-2.5 py-1 text-xs transition disabled:opacity-50',
                  seg.algorithm === option.id
                    ? 'border-sky-500 bg-sky-500/10 text-sky-200'
                    : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <Notice compact>{t('common.referenceOnly')}</Notice>
      </div>
    </div>
  );
}
