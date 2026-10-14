import {
  Activity,
  FileArchive,
  FileUp,
  History,
  Layers3,
  RotateCcw,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ViewerApp } from '../app/useViewerApp';
import logoUrl from '../assets/voxel-viewer-logo.svg';
import { Button } from '../components/Button';
import { FolderPicker } from '../components/FolderPicker';
import { ImportStatus } from '../components/ImportStatus';
import { ImportStatusStage } from '../components/ImportStatus.constants';
import { LanguageSelect } from '../components/LanguageSelect';
import { Notice } from '../components/Notice';
import { APP_ROUTES } from '../constants';
import { Trans, useTranslation } from '../i18n';
import {
  clearRecentCases,
  getRecentCasesServerSnapshot,
  getRecentCasesSnapshot,
  removeRecentCase,
  subscribeRecentCases,
  type RecentCase,
} from '../lib/project/recentCases';

interface ImportPageProps {
  app: ViewerApp;
}

export default function ImportPage({ app }: ImportPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const niftiInputRef = useRef<HTMLInputElement | null>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [dragging, setDragging] = useState(false);
  const recentCases = useSyncExternalStore(
    subscribeRecentCases,
    getRecentCasesSnapshot,
    getRecentCasesServerSnapshot,
  );
  const reopenRecent = (entry: RecentCase) => {
    if (entry.kind === 'url' && entry.url) void app.openRemote(entry.url);
    else if (entry.kind === 'sample') void app.openSample();
  };
  // Only offer the sample when this deployment ships one.
  const [sampleAvailable, setSampleAvailable] = useState(false);
  useEffect(() => {
    const path =
      new URLSearchParams(window.location.search).get('sample') ||
      '/sample-cbct';
    const abort = new AbortController();
    fetch(`${path}/manifest.json`, { signal: abort.signal })
      .then((r) => {
        setSampleAvailable(
          r.ok && (r.headers.get('content-type') ?? '').includes('json'),
        );
        return r.body?.cancel();
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, []);
  // Drop a file anywhere on the page: scan packages and zipped exports open as
  // archives, NIfTI files through their own reader.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (!file || app.busy) return;
      if (/\.nii(\.gz)?$/i.test(file.name)) void app.openNifti(file);
      else void app.openArchive(file);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [app]);
  const codeClass =
    'rounded bg-slate-900 px-1 py-0.5 font-mono text-[0.9em] text-slate-200';

  if (app.busy) {
    return (
      <main className="h-screen overflow-hidden bg-slate-950 text-slate-100">
        <LanguageSelect />
        <div className="mx-auto flex min-h-screen max-w-lg items-center justify-center px-4 py-8">
          <div className="w-full space-y-4 rounded border border-slate-800 bg-slate-950/90 p-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
              <div>
                <div className="text-sm font-medium text-slate-100">
                  {t('importPage.busyTitle')}
                </div>
                <div className="text-xs text-slate-500">
                  {t('importPage.busySubtitle', {
                    sourceLabel:
                      app.sourceLabel || t('importPage.selectedScanFolder'),
                  })}
                </div>
              </div>
            </div>
            <ImportStatus
              progress={app.progress}
              issue={app.issue}
              stage={ImportStatusStage.Import}
            />
            <Notice>{t('common.referenceOnly')}</Notice>
            <Button variant="ghost" onClick={() => app.resetViewer()}>
              {t('importPage.cancel')}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-y-auto bg-slate-950 text-slate-100">
      <LanguageSelect />
      {dragging ? (
        <div
          className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-sky-400 bg-slate-950/85 text-lg font-medium text-sky-100"
          aria-hidden="true"
        >
          {t('importPage.dropHere')}
        </div>
      ) : null}
      <div className="mx-auto flex min-h-screen max-w-3xl items-start justify-center px-4 py-8">
        <div className="w-full space-y-3">
          <section className="rounded border border-slate-800 bg-slate-950/80 p-5">
            <div className="flex flex-col-reverse gap-4 md:flex-row md:items-stretch md:justify-between md:gap-6">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  {t('importPage.eyebrow')}
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-50">
                  {t('importPage.title')}
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-slate-400">
                  {t('importPage.description')}
                </p>
                <form
                  className="mt-3 flex max-w-2xl flex-col gap-2 sm:flex-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const url = remoteUrl.trim();
                    if (url) void app.openRemote(url);
                  }}
                >
                  <input
                    type="url"
                    value={remoteUrl}
                    onChange={(event) => setRemoteUrl(event.target.value)}
                    placeholder={t('importPage.remoteUrlPlaceholder')}
                    className="min-h-10 min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 outline-none transition focus:border-sky-500"
                    disabled={app.busy}
                  />
                  <Button
                    type="submit"
                    variant="ghost"
                    disabled={app.busy || remoteUrl.trim().length === 0}
                  >
                    <FileUp className="h-4 w-4" aria-hidden="true" />
                    {t('importPage.openRemote')}
                  </Button>
                </form>
                <p className="mt-3 text-xs text-slate-400">
                  {t('importPage.dropHint')}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    onClick={() => zipInputRef.current?.click()}
                    disabled={app.busy}
                  >
                    <FileArchive className="h-4 w-4" aria-hidden="true" />
                    {t('importPage.openZip')}
                  </Button>
                  <input
                    ref={zipInputRef}
                    type="file"
                    accept=".zip,application/zip,application/x-zip-compressed"
                    className="hidden"
                    data-testid="zip-input"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void app.openArchive(file);
                      event.target.value = '';
                    }}
                  />
                  <Button
                    variant="ghost"
                    onClick={() => niftiInputRef.current?.click()}
                    disabled={app.busy}
                  >
                    <FileUp className="h-4 w-4" aria-hidden="true" />
                    {t('importPage.openNifti')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => navigate(APP_ROUTES.teeth)}
                  >
                    <Layers3 className="h-4 w-4" aria-hidden="true" />
                    {t('importPage.openTeeth')}
                  </Button>
                  {sampleAvailable ? (
                    <Button
                      variant="ghost"
                      onClick={() => void app.openSample()}
                      disabled={app.busy}
                    >
                      <Activity className="h-4 w-4" aria-hidden="true" />
                      {t('importPage.loadSample')}
                    </Button>
                  ) : null}
                  <input
                    ref={niftiInputRef}
                    type="file"
                    accept=".nii,.nii.gz,.gz"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void app.openNifti(file);
                      event.target.value = '';
                    }}
                  />
                </div>
              </div>
              <div className="mx-auto flex w-24 shrink-0 justify-center md:mx-0 md:w-36 md:self-stretch md:p-4 lg:w-40">
                <img
                  src={logoUrl}
                  alt={t('importPage.logoAlt')}
                  className="h-full w-full select-none object-contain opacity-95 md:object-right"
                />
              </div>
            </div>
          </section>

          {recentCases.length ? (
            <section
              className="rounded border border-slate-800 bg-slate-950/70 p-4"
              aria-labelledby="recent-cases-title"
            >
              <div className="flex items-center justify-between gap-2">
                <div
                  id="recent-cases-title"
                  className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-slate-500"
                >
                  <History className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('importPage.recent.title')}
                </div>
                <Button size="sm" onClick={() => clearRecentCases()}>
                  {t('importPage.recent.clear')}
                </Button>
              </div>
              <ul className="mt-2 divide-y divide-slate-800/80">
                {recentCases.map((entry) => (
                  <li
                    key={entry.key}
                    className="flex items-center gap-2 py-1.5 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate text-slate-200"
                        title={entry.url ?? entry.name}
                      >
                        {entry.name}
                      </div>
                      <div className="truncate text-[11px] text-slate-500">
                        {t(`importPage.recent.kind.${entry.kind}`)}
                        {' · '}
                        {new Date(entry.openedAt).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                        {entry.teeth
                          ? ` · ${t('importPage.recent.teeth', { count: entry.teeth })}`
                          : ''}
                      </div>
                    </div>
                    {entry.kind === 'file' ? (
                      <span className="shrink-0 text-[11px] text-slate-500">
                        {t('importPage.recent.openFileAgain')}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => reopenRecent(entry)}
                        disabled={
                          app.busy || (entry.kind === 'url' && !entry.url)
                        }
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden="true" />
                        {t('importPage.recent.reopen')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => removeRecentCase(entry.key)}
                      aria-label={t('importPage.recent.removeLabel', {
                        name: entry.name,
                      })}
                      title={t('importPage.recent.remove')}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                      <span className="sr-only sm:not-sr-only">
                        {t('importPage.recent.remove')}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <FolderPicker
            directorySupported={app.directorySupported}
            onPickDirectory={() => void app.openDirectory()}
            busy={app.busy}
            detail={
              app.sourceLabel
                ? t('folderPicker.source', { label: app.sourceLabel })
                : undefined
            }
          />

          {app.issue ? (
            <Notice variant="error">
              <strong className="block text-red-50">
                {t('importPage.importErrorTitle')}
              </strong>
              <span className="mt-1 block">{app.issue.message}</span>
            </Notice>
          ) : null}

          <Notice>{t('common.referenceOnly')}</Notice>

          <section className="rounded border border-slate-800 bg-slate-950/70 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
              {t('importPage.supportedFoldersTitle')}
            </div>
            <div className="mt-3 space-y-3 text-sm text-slate-300">
              <div>
                <div className="font-medium text-slate-100">
                  {t('importPage.supportedFolders.package.title')}
                </div>
                <div className="mt-1 text-slate-400">
                  {t('importPage.supportedFolders.package.description')}
                </div>
                <div className="mt-1">
                  <Trans
                    i18nKey="importPage.supportedFolders.package.instruction"
                    components={[<code key="code-1" className={codeClass} />]}
                  />
                </div>
              </div>
              <div>
                <div className="font-medium text-slate-100">
                  {t('importPage.supportedFolders.galileos.title')}
                </div>
                <div className="mt-1 text-slate-400">
                  {t('importPage.supportedFolders.galileos.description')}
                </div>
                <div className="mt-1">
                  <Trans
                    i18nKey="importPage.supportedFolders.galileos.instruction"
                    components={[
                      <code key="code-1" className={codeClass} />,
                      <code key="code-2" className={codeClass} />,
                    ]}
                  />
                </div>
              </div>
              <div>
                <div className="font-medium text-slate-100">
                  {t('importPage.supportedFolders.oneVolume.title')}
                </div>
                <div className="mt-1 text-slate-400">
                  {t('importPage.supportedFolders.oneVolume.description')}
                </div>
                <div className="mt-1">
                  <Trans
                    i18nKey="importPage.supportedFolders.oneVolume.instruction"
                    components={[<code key="code-1" className={codeClass} />]}
                  />
                </div>
              </div>
              <div>
                <div className="font-medium text-slate-100">
                  {t('importPage.supportedFolders.dicom.title')}
                </div>
                <div className="mt-1 text-slate-400">
                  {t('importPage.supportedFolders.dicom.description')}
                </div>
                <div className="mt-1">
                  <Trans
                    i18nKey="importPage.supportedFolders.dicom.instruction"
                    components={[
                      <code key="code-1" className={codeClass} />,
                      <code key="code-2" className={codeClass} />,
                    ]}
                  />
                </div>
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-500">
              <Trans
                i18nKey="importPage.referenceNote"
                components={[<code key="code-1" className={codeClass} />]}
              />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
