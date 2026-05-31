import { lazy, Suspense, useMemo } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { APP_ROUTES } from '../constants';
import { useTranslation } from '../i18n';
import { createDefaultScanFolderPicker } from '../lib/import/source-picker';
import { useViewerApp } from './useViewerApp';

const ImportPage = lazy(() => import('../pages/ImportPage'));
const ViewerPage = lazy(() => import('../pages/ViewerPage'));
const ToothExtractionPage = lazy(() => import('../pages/ToothExtractionPage'));
const AnatomySegmentationPage = lazy(
  () => import('../pages/AnatomySegmentationPage'),
);
const PanoramicPage = lazy(() => import('../pages/PanoramicPage'));

function RouteFallback() {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <div className="rounded border border-slate-800 bg-slate-950/90 px-4 py-3 text-sm text-slate-400">
        {t('common.loadingViewerShell')}
      </div>
    </main>
  );
}

export function AppRouter() {
  const sourcePicker = useMemo(() => createDefaultScanFolderPicker(), []);
  const app = useViewerApp({ sourcePicker });
  const hasVolume = Boolean(app.volume);

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route
          path={APP_ROUTES.import}
          element={
            hasVolume ? (
              <Navigate to={APP_ROUTES.viewer} replace />
            ) : (
              <ImportPage app={app} />
            )
          }
        />
        <Route
          path={APP_ROUTES.viewer}
          element={
            hasVolume ? (
              <ViewerPage app={app} />
            ) : (
              <Navigate to={APP_ROUTES.import} replace />
            )
          }
        />
        <Route
          path={APP_ROUTES.teeth}
          element={<ToothExtractionPage app={app} />}
        />
        <Route
          path={APP_ROUTES.anatomy}
          element={<AnatomySegmentationPage app={app} />}
        />
        <Route
          path={APP_ROUTES.panoramic}
          element={
            hasVolume ? (
              <PanoramicPage app={app} />
            ) : (
              <Navigate to={APP_ROUTES.import} replace />
            )
          }
        />
        <Route
          path="*"
          element={
            <Navigate
              to={hasVolume ? APP_ROUTES.viewer : APP_ROUTES.import}
              replace
            />
          }
        />
      </Routes>
    </Suspense>
  );
}
