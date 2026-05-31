import { ArrowLeft, Brain } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ViewerApp } from '../app/useViewerApp';
import { Button } from '../components/Button';
import { FullAnatomySegmentation } from '../components/FullAnatomySegmentation';
import { APP_ROUTES } from '../constants';
import { useTranslation } from '../i18n';

interface AnatomySegmentationPageProps {
  app: ViewerApp;
}

export default function AnatomySegmentationPage({
  app,
}: AnatomySegmentationPageProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/90 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Brain className="h-5 w-5 text-sky-400" aria-hidden="true" />
          <div>
            <h1 className="text-base font-semibold tracking-tight text-slate-50">
              {t('anatomy.title')}
            </h1>
            <p className="text-xs text-slate-500">{t('anatomy.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {app.volume ? (
            <Button variant="ghost" onClick={() => navigate(APP_ROUTES.viewer)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t('anatomy.backToViewer')}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => navigate(APP_ROUTES.import)}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('anatomy.backToImport')}
          </Button>
        </div>
      </header>

      <FullAnatomySegmentation app={app} />
    </main>
  );
}
