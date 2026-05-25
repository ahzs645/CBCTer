import {
  ArrowLeft,
  Check,
  Download,
  FlaskConical,
  Layers3,
  LoaderCircle,
  Library,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ViewerApp } from '../app/useViewerApp';
import { Button } from '../components/Button';
import { LiveToothSegmentation } from '../components/LiveToothSegmentation';
import { Notice } from '../components/Notice';
import { ToothArchViewport } from '../components/ToothArchViewport';
import { ToothMeshViewport } from '../components/ToothMeshViewport';
import { APP_ROUTES } from '../constants';
import { useTranslation } from '../i18n';
import { SEGMENTATION_ALGORITHMS } from '../lib/segmentation/types';
import { useSegmentation } from '../lib/segmentation/useSegmentation';
import { cn } from '../utils/cn';

interface ToothExtractionPageProps {
  app: ViewerApp;
}

type ToothMode = 'library' | 'live';

export default function ToothExtractionPage({ app }: ToothExtractionPageProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [mode, setMode] = useState<ToothMode>('library');
  const seg = useSegmentation();
  const { manifest, selectedItem, assetRoot, counts } = seg;

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/90 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Layers3 className="h-5 w-5 text-sky-400" aria-hidden="true" />
          <div>
            <h1 className="text-base font-semibold tracking-tight text-slate-50">
              {t('teeth.title')}
            </h1>
            <p className="text-xs text-slate-500">{t('teeth.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {app.volume ? (
            <Button variant="ghost" onClick={() => navigate(APP_ROUTES.viewer)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t('teeth.backToViewer')}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => navigate(APP_ROUTES.import)}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('teeth.backToImport')}
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-800 bg-slate-950/60 px-4 py-1.5">
        {(
          [
            { id: 'library', label: t('teeth.tabLibrary'), Icon: Library },
            { id: 'live', label: t('teeth.tabLive'), Icon: FlaskConical },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs transition',
              mode === id
                ? 'border-sky-500 bg-sky-500/10 text-sky-200'
                : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {mode === 'live' ? <LiveToothSegmentation app={app} /> : (
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-hidden bg-slate-800 lg:flex-row">
        {/* Arch overview */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span>{t('teeth.archOverview')}</span>
            <span>{t('teeth.separatedCount', { count: counts.separated })}</span>
          </div>
          <div className="relative min-h-0 flex-1">
            {seg.loading ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-slate-950/70 text-sm text-slate-400">
                <LoaderCircle
                  className="h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
                {t('teeth.loading')}
              </div>
            ) : null}
            <ToothArchViewport
              assetRoot={assetRoot}
              items={seg.visibleItems}
              onSelect={seg.selectLabel}
              selectedLabel={selectedItem?.label ?? null}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-800 px-3 py-2">
            {SEGMENTATION_ALGORITHMS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => seg.setAlgorithm(option.id)}
                className={cn(
                  'rounded border px-2.5 py-1 text-xs transition',
                  seg.algorithm === option.id
                    ? 'border-sky-500 bg-sky-500/10 text-sky-200'
                    : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        {/* Detail + list */}
        <aside className="flex min-h-0 w-full flex-col bg-slate-950 lg:w-[360px]">
          {seg.error ? (
            <div className="p-3">
              <Notice variant="error">{seg.error}</Notice>
              <p className="mt-3 text-xs text-slate-500">
                {t('teeth.generateHint')}
              </p>
            </div>
          ) : null}

          {manifest && selectedItem ? (
            <>
              <div className="grid grid-cols-2 gap-px border-b border-slate-800 bg-slate-800">
                <div className="bg-slate-950">
                  <div className="px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    {t('teeth.overlay')}
                  </div>
                  <img
                    alt={t('teeth.overlay')}
                    src={`${assetRoot}${selectedItem.preview}`}
                    className="aspect-square w-full object-cover"
                  />
                </div>
                <div className="flex flex-col bg-slate-950">
                  <div className="px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    {t('teeth.mesh')}
                  </div>
                  <div className="relative aspect-square w-full">
                    <ToothMeshViewport src={seg.selectedStl} />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-800 px-3 py-2 text-xs text-slate-400">
                <span>{t('teeth.acceptedCount', { count: counts.accepted })}</span>
                {counts.review > 0 ? (
                  <span className="text-amber-300">
                    {t('teeth.reviewCount', { count: counts.review })}
                  </span>
                ) : null}
                {counts.hidden > 0 ? (
                  <span>{t('teeth.hiddenCount', { count: counts.hidden })}</span>
                ) : null}
                <span>
                  {t('teeth.candidateCount', { count: counts.candidates })}
                </span>
                <a
                  className="ml-auto text-sky-400 hover:text-sky-300"
                  href={`${assetRoot}${manifest.labels}`}
                >
                  labels.npz
                </a>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {seg.visibleItems.map((item) => {
                  const status = seg.reviewStatus(item);
                  const isSelected = item.label === selectedItem.label;
                  return (
                    <div
                      key={item.label}
                      className={cn(
                        'flex items-center gap-2 border-b border-slate-900 px-3 py-2 text-left transition',
                        isSelected ? 'bg-slate-900' : 'hover:bg-slate-900/60',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => seg.selectLabel(item.label)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <img
                          alt=""
                          src={`${assetRoot}${item.preview}`}
                          className="h-10 w-10 shrink-0 rounded object-cover"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-100">
                            {t('teeth.labelName', { label: item.label })}
                          </span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {item.assignedVoxels.toLocaleString()}{' '}
                            {t('teeth.voxels')}
                          </span>
                        </span>
                      </button>
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
                          status === 'accepted' &&
                            'bg-emerald-500/15 text-emerald-300',
                          status === 'review' &&
                            'bg-amber-500/15 text-amber-300',
                          status === 'rejected' && 'bg-rose-500/15 text-rose-300',
                        )}
                        title={item.qualityReasons?.join(', ') || status}
                      >
                        {status}
                      </span>
                      <span className="flex items-center gap-1 text-slate-500">
                        <button
                          type="button"
                          aria-label={t('teeth.accept')}
                          onClick={() => seg.setReview(item.label, 'accepted')}
                          className="hover:text-emerald-300"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label={t('teeth.flagReview')}
                          onClick={() => seg.setReview(item.label, 'review')}
                          className="hover:text-amber-300"
                        >
                          <ShieldAlert
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          type="button"
                          aria-label={t('teeth.hide')}
                          onClick={() => seg.setReview(item.label, 'rejected')}
                          className="hover:text-rose-300"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <a
                          aria-label={t('teeth.downloadStl', {
                            label: item.label,
                          })}
                          href={`${assetRoot}${item.stl}`}
                          className="hover:text-sky-300"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : !seg.loading && !seg.error ? (
            <div className="p-3 text-sm text-slate-400">{t('teeth.empty')}</div>
          ) : null}
        </aside>
      </div>
      )}
    </main>
  );
}
