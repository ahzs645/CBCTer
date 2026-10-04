import { createStudyMeasurement } from '../domain/studyState';
import type { StudyMeasurement } from '../domain/types';
import { axisPointToVoxel } from '../lib/segmentation/paintBrush';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ViewerApp } from '../app/useViewerApp';
import { useCompactViewerLayout } from '../app/viewer-layout';
import { useAxisViewportLabels, appViewerTheme } from '../app/viewer-i18n';
import { Button } from '../components/Button';
import { RangeField } from '../components/RangeField';
import { useTranslation } from '../i18n';
import {
  VolumeAxis,
  type SliceWindowLevel,
  type ViewerSlices,
  type VolumeCursor,
} from '../types';
import { AxisViewportGrid, VolumeViewport3D } from '../viewer';
import {
  planeRegion,
  renderNativePlane,
  renderPreviewPlane,
} from '../viewer/progressiveSlices';
import type {
  MeasureMode,
  SliceMeasurementShape,
} from '../viewer/react/MeasurementOverlay';
import type { ChunkedSession } from '../lib/import/chunked/session';

export interface StreamingViewState {
  cursor: VolumeCursor;
  windowLevel: SliceWindowLevel;
  zoom: number;
  axis: VolumeAxis;
}

export default function ProgressiveViewerPage({
  app,
  session,
  onLoadFullMeasurements,
}: {
  app: ViewerApp;
  session: ChunkedSession;
  onLoadFullMeasurements: (
    records: StudyMeasurement[],
    view: StreamingViewState,
  ) => void;
}) {
  const { t } = useTranslation();
  const compact = useCompactViewerLayout();
  const m = session.manifest,
    dimensions = m.volume.dimensions,
    spacing = m.volume.spacing;
  const [cursor, setCursor] = useState<VolumeCursor>({
    x: Math.floor(dimensions[0] / 2),
    y: Math.floor(dimensions[1] / 2),
    z: Math.floor(dimensions[2] / 2),
  });
  const [wl, setWl] = useState<SliceWindowLevel>(m.display);
  const [zoom, setZoom] = useState(1);
  const [axis, setAxis] = useState(VolumeAxis.Axial);
  const [result, setResult] = useState<{
    key: string;
    slices: ViewerSlices;
  } | null>(null);
  const [error, setError] = useState('');
  const [fullLoading, setFullLoading] = useState(false);
  const [mode, setMode] = useState<MeasureMode>('off');
  const [measurements, setMeasurements] = useState<
    Array<{
      axis: VolumeAxis;
      index: number;
      shape: SliceMeasurementShape;
      record: StudyMeasurement;
    }>
  >([]);
  const planes = useRef(
    new Map<VolumeAxis, { index: number; words: Int16Array | Uint16Array }>(),
  );
  const currentKey = `${cursor.x}|${cursor.y}|${cursor.z}|${wl.window}|${wl.level}|${compact ? axis : 'all'}`;
  const pending = result?.key !== currentKey;
  const preview = useMemo<ViewerSlices>(
    () => ({
      axial: renderPreviewPlane(
        VolumeAxis.Axial,
        app.volume!,
        cursor,
        dimensions,
        wl,
      ),
      coronal: renderPreviewPlane(
        VolumeAxis.Coronal,
        app.volume!,
        cursor,
        dimensions,
        wl,
      ),
      sagittal: renderPreviewPlane(
        VolumeAxis.Sagittal,
        app.volume!,
        cursor,
        dimensions,
        wl,
      ),
    }),
    [app.volume, cursor, dimensions, wl],
  );
  useEffect(() => {
    const abort = new AbortController();
    void Promise.all(
      (compact ? [axis] : Object.values(VolumeAxis)).map(async (a) => {
        const { start, shape } = planeRegion(a, cursor, dimensions);
        const index =
          a === VolumeAxis.Axial
            ? cursor.z
            : a === VolumeAxis.Coronal
              ? cursor.y
              : cursor.x;
        const cached = planes.current.get(a);
        const words =
          cached?.index === index
            ? cached.words
            : await session.region(start, shape, abort.signal);
        if (abort.signal.aborted)
          throw new DOMException('Cancelled', 'AbortError');
        planes.current.set(a, { index, words });
        return [a, renderNativePlane(a, words, shape, m.volume, wl)] as const;
      }),
    ).then(
      (images) => {
        if (!abort.signal.aborted) {
          setResult({
            key: currentKey,
            slices: { ...preview, ...Object.fromEntries(images) },
          });
          setError('');
        }
      },
      (e) => {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => abort.abort();
  }, [
    session,
    cursor,
    wl,
    dimensions,
    m.volume,
    currentKey,
    compact,
    axis,
    preview,
  ]);
  const labels = useAxisViewportLabels();
  const sliceIndex = (a: VolumeAxis) =>
    a === VolumeAxis.Axial
      ? cursor.z
      : a === VolumeAxis.Coronal
        ? cursor.y
        : cursor.x;
  const updateIndex = (a: VolumeAxis, index: number) =>
    setCursor((c) => {
      const key =
        a === VolumeAxis.Axial ? 'z' : a === VolumeAxis.Coronal ? 'y' : 'x';
      const limit =
        a === VolumeAxis.Axial
          ? dimensions[2]
          : a === VolumeAxis.Coronal
            ? dimensions[1]
            : dimensions[0];
      return {
        ...c,
        [key]: Math.max(0, Math.min(limit - 1, Math.round(index))),
      };
    });
  const select = (a: VolumeAxis) => (p: { xRatio: number; yRatio: number }) =>
    setCursor((c) =>
      a === VolumeAxis.Axial
        ? {
            ...c,
            x: Math.round(p.xRatio * (dimensions[0] - 1)),
            y: Math.round(p.yRatio * (dimensions[1] - 1)),
          }
        : a === VolumeAxis.Coronal
          ? {
              ...c,
              x: Math.round(p.xRatio * (dimensions[0] - 1)),
              z: Math.round((1 - p.yRatio) * (dimensions[2] - 1)),
            }
          : {
              ...c,
              y: Math.round(p.xRatio * (dimensions[1] - 1)),
              z: Math.round((1 - p.yRatio) * (dimensions[2] - 1)),
            },
    );
  const loadFull = async () => {
    setFullLoading(true);
    setError('');
    try {
      onLoadFullMeasurements(
        measurements.map((item) => item.record),
        { cursor, windowLevel: wl, zoom, axis },
      );
      await app.openPackageLevel('full');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFullLoading(false);
    }
  };
  const shapes = Object.fromEntries(
    Object.values(VolumeAxis).map((a) => [
      a,
      pending
        ? []
        : measurements
            .filter((v) => v.axis === a && v.index === sliceIndex(a))
            .map((v) => v.shape),
    ]),
  );
  const span = Math.max(4095, m.scalarRange[1] - m.scalarRange[0]);
  return (
    <main
      className="flex h-dvh flex-col bg-slate-950 text-slate-100"
      data-testid="progressive-viewer"
      data-bytes-read={session.stats.bytesRead}
      data-cache-bytes={session.stats.cacheBytes}
      data-cache-limit={session.stats.cacheLimitBytes}
      data-decoded-chunks={session.stats.decodedChunks}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <div>
          <h1 className="text-sm font-semibold">{m.name}</h1>
          <p className="text-xs text-slate-400">
            {dimensions.join(' × ')} · {spacing.join(' × ')} mm
          </p>
        </div>
        <div className="flex gap-2">
          <Button disabled={fullLoading} onClick={() => app.resetViewer()}>
            {t('streaming.close')}
          </Button>
          <Button disabled={fullLoading} onClick={() => void loadFull()}>
            {fullLoading ? t('streaming.loadingFull') : t('streaming.advanced')}
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 p-2">
        <span
          className="text-xs text-sky-300"
          role="status"
          data-testid="streaming-status"
        >
          {pending ? t('streaming.loadingSlices') : t('streaming.fullSlices')}
        </span>
        <label className="text-xs">
          {t('streaming.measure')}{' '}
          <select
            aria-label={t('streaming.measure')}
            value={mode}
            onChange={(e) => setMode(e.target.value as MeasureMode)}
            className="rounded bg-slate-800 p-1"
          >
            {(['off', 'distance', 'angle', 'ellipse', 'polygon'] as const).map(
              (k) => (
                <option key={k} value={k}>
                  {t(`streaming.tools.${k}`)}
                </option>
              ),
            )}
          </select>
        </label>
        <RangeField
          className="w-36"
          aria-label={t('streaming.window')}
          label={t('streaming.window')}
          value={wl.window}
          min={1}
          max={Math.max(span, m.display.window)}
          onChange={(window) => setWl((v) => ({ ...v, window }))}
        />
        <RangeField
          className="w-36"
          aria-label={t('streaming.level')}
          label={t('streaming.level')}
          value={wl.level}
          min={Math.min(-1024, m.scalarRange[0])}
          max={Math.max(4095, m.scalarRange[1])}
          onChange={(level) => setWl((v) => ({ ...v, level }))}
        />
      </div>
      {error ? (
        <p role="alert" className="px-3 py-2 text-sm text-rose-300">
          {error}
        </p>
      ) : null}
      <AxisViewportGrid
        className="min-h-0 flex-1"
        cursor={cursor}
        dimensions={dimensions}
        spacing={spacing}
        mprZoom={zoom}
        onZoomChange={setZoom}
        selectedAxis={axis}
        onSelectedAxisChange={setAxis}
        slices={pending ? preview : result!.slices}
        hasVolume
        compact={compact}
        theme={appViewerTheme}
        labels={labels}
        onSelectAxis={select}
        onSliceStep={(a, delta) => updateIndex(a, sliceIndex(a) + delta)}
        onSliceIndexChange={updateIndex}
        measureMode={pending ? 'off' : mode}
        measurementShapes={shapes}
        onMeasurementComplete={(a, measurement) =>
          setMeasurements((v) => [
            ...v,
            {
              axis: a,
              index: sliceIndex(a),
              record: createStudyMeasurement(`study_${m.name}`, {
                kind: measurement.kind,
                name: `${measurement.kind === 'distance' ? 'Distance' : measurement.kind === 'angle' ? 'Angle' : measurement.kind === 'ellipse' ? 'Ellipse ROI' : 'Polygon ROI'} ${v.length + 1}`,
                points: measurement.points.map((point) =>
                  axisPointToVoxel(a, point, cursor, dimensions),
                ),
                value: measurement.value,
                unit: measurement.unit,
                plane: a,
              }),
              shape: {
                id: crypto.randomUUID(),
                kind: measurement.kind,
                points: measurement.points,
                label: `${measurement.value.toFixed(2)} ${measurement.unit}`,
              },
            },
          ])
        }
        layout="quad"
        extraPane={
          <div className="flex h-full flex-col">
            <p className="px-3 py-1 text-xs text-slate-400">
              {t('streaming.preview3d')}
            </p>
            <VolumeViewport3D
              className="min-h-0 flex-1"
              volume={app.prepared3D}
            />
          </div>
        }
      />
      <footer className="border-t border-slate-800 px-3 py-1 text-xs text-slate-400">
        {t('streaming.advancedHint')}
      </footer>
    </main>
  );
}
