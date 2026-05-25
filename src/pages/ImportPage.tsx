import { Activity, FileUp, Layers3 } from 'lucide-react';
import { useRef } from 'react';
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

interface ImportPageProps {
  app: ViewerApp;
}

export default function ImportPage({ app }: ImportPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const niftiInputRef = useRef<HTMLInputElement | null>(null);
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
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-y-auto bg-slate-950 text-slate-100">
      <LanguageSelect />
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
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    onClick={() => void app.openSample()}
                    disabled={app.busy}
                  >
                    <Activity className="h-4 w-4" aria-hidden="true" />
                    {t('importPage.loadSample')}
                  </Button>
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
