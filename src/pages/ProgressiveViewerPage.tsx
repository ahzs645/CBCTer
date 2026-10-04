import { computeDentalWindowPresets } from '../lib/dental/windowPresets';
import { extractLabelmapOverlayImage } from '../lib/segmentation/maskOperations';
import type { SliceImage } from '../types';
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
  const caseState = session.caseMetadata?.state;
  const [cursor, setCursor] = useState<VolumeCursor>({
    x: caseState?.caseView?.cursor[0]??Math.floor(dimensions[0] / 2),
    y: caseState?.caseView?.cursor[1]??Math.floor(dimensions[1] / 2),
    z: caseState?.caseView?.cursor[2]??Math.floor(dimensions[2] / 2),
  });
  const [selectedId, setSelectedId] = useState(
    caseState?.selectedInstanceId ?? '',
  );
  const [structureMode, setStructureMode] = useState<
    'all' | 'selected' | 'hide-teeth'
  >('all');
  const [bone, setBone] = useState(false);
  const presets = useMemo(
    () => computeDentalWindowPresets(app.volume!),
    [app.volume],
  );
  const [analysisResult, setAnalysisResult] = useState<{
    key: string;
    overlays: Partial<Record<VolumeAxis, SliceImage | null>>;
  } | null>(null);
  const analysisPlanes = useRef(
    new Map<
      VolumeAxis,
      { index: number; layers: Array<{ id: string; words: Uint16Array }> }
    >(),
  );
  const [wl, setWl] = useState<SliceWindowLevel>(caseState?.caseView?.windowLevel??m.display);
  const [zoom, setZoom] = useState(caseState?.caseView?.zoom??1);
  const [axis, setAxis] = useState(caseState?.caseView?.axis??VolumeAxis.Axial);
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
  const analysisKey = `${cursor.x}|${cursor.y}|${cursor.z}|${axis}|${selectedId}|${structureMode}|${bone}`;
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
  useEffect(() => {
    const abort = new AbortController();
    const groups = (caseState?.segmentGroups ?? []).filter(
      (g) =>
        g.visible &&
        session.caseMetadata?.manifest.layers.some(
          (l) => l.id === g.id && l.role !== 'prediction',
        ),
    );
    if (!groups.length) return;
    void Promise.all(
      (compact ? [axis] : Object.values(VolumeAxis)).map(async (a) => {
        const { start, shape } = planeRegion(a, cursor, dimensions),
          index =
            a === VolumeAxis.Axial
              ? cursor.z
              : a === VolumeAxis.Coronal
                ? cursor.y
                : cursor.x;
        const cached = analysisPlanes.current.get(a);
        const layers =
          cached?.index === index
            ? cached.layers
            : await Promise.all(
                groups.map(async (g) => ({
                  id: g.id,
                  words: await session.analysisRegion(
                    g.id,
                    start,
                    shape,
                    abort.signal,
                  ),
                })),
              );
        if (abort.signal.aborted)
          throw new DOMException('Cancelled', 'AbortError');
        analysisPlanes.current.set(a, { index, layers });
        const selected = caseState?.toothInstances?.find(
          (t) => t.id === selectedId,
        );
        const image = extractLabelmapOverlayImage(
          layers.map((l) => {
            const group = groups.find((g) => g.id === l.id)!,
              role = session.caseMetadata?.manifest.layers.find(
                (v) => v.id === l.id,
              )?.role;
            return {
              labelmap: l.words,
              visible: true,
              opacity: group.opacity,
              segments: group.segments.map((segment) => {
                const tooth =
                  role === 'teeth' ||
                  (role === 'anatomy' && /teeth|tooth/i.test(segment.name));
                const permitted =
                  structureMode === 'selected'
                    ? role === 'teeth'
                      ? selected?.groupId === l.id &&
                        selected.value === segment.value
                      : bone && !tooth
                    : structureMode === 'hide-teeth'
                      ? !tooth
                      : true;
                return {
                  value: segment.value,
                  color:
                    selected?.groupId === l.id &&
                    selected.value === segment.value
                      ? '#facc15'
                      : segment.color,
                  opacity: segment.opacity,
                  visible: segment.visible && Boolean(permitted),
                };
              }),
            };
          }),
          a,
          { x: 0, y: 0, z: 0 },
          shape,
          spacing,
        );
        return [a, image] as const;
      }),
    ).then(
      (items) => {
        if (!abort.signal.aborted)
          setAnalysisResult({
            key: analysisKey,
            overlays: Object.fromEntries(items),
          });
      },
      (e) => {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => abort.abort();
  }, [
    session,
    caseState,
    cursor,
    dimensions,
    spacing,
    compact,
    axis,
    selectedId,
    structureMode,
    bone,
    analysisKey,
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
  const select = (a: VolumeAxis) => (p: { xRatio: number; yRatio: number }) => {
    const shape = planeRegion(a, cursor, dimensions).shape;
    const point = axisPointToVoxel(a, p, { x: 0, y: 0, z: 0 }, shape);
    const index = (point[2] * shape[1] + point[1]) * shape[0] + point[0];
    const layers = analysisPlanes.current.get(a)?.layers;
    const tooth = caseState?.toothInstances?.find((t) =>
      layers?.some((l) => l.id === t.groupId && l.words[index] === t.value),
    );
    if (tooth) setSelectedId(tooth.id);
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
  };
  const loadFull = async () => {
    setFullLoading(true);
    setError('');
    try {
      onLoadFullMeasurements(
        measurements.map((item) => item.record),
        { cursor, windowLevel: wl, zoom, axis },
      );
      session.setPreferredInstance(selectedId);
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
        <label className="text-xs">
          Contrast preset
          <select
            aria-label="Contrast preset"
            className="min-h-11 rounded bg-slate-800 px-2"
            defaultValue=""
            onChange={(e) => {
              const preset = presets.find((p) => p.id === e.target.value);
              if (preset) setWl(preset.windowLevel);
            }}
          >
            <option value="">Custom</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === 'soft'
                  ? 'Soft tissue'
                  : p.id.charAt(0).toUpperCase() + p.id.slice(1)}
              </option>
            ))}
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
      {caseState && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 p-2 text-xs">
          <label>
            Selected tooth
            <select
              aria-label="Selected tooth instance"
              value={selectedId}
              className="min-h-11 max-w-44 rounded bg-slate-800 p-2"
              onChange={(e) => {
                setSelectedId(e.target.value);
                const tooth = caseState.toothInstances?.find(
                  (t) => t.id === e.target.value,
                );
                if (tooth)
                  setCursor({
                    x: Math.round(tooth.centroid[0]),
                    y: Math.round(tooth.centroid[1]),
                    z: Math.round(tooth.centroid[2]),
                  });
              }}
            >
              <option value="">Select a tooth</option>
              {caseState.toothInstances?.map((v, i) => (
                <option key={v.id} value={v.id}>
                  {v.fdi ? `FDI ${v.fdi}` : `Unassigned ${i + 1}`} · {v.review}
                </option>
              ))}
            </select>
          </label>
          <label>
            Structures
            <select
              aria-label="Structure visibility"
              className="min-h-11 rounded bg-slate-800 p-2"
              value={structureMode}
              onChange={(e) =>
                setStructureMode(e.target.value as typeof structureMode)
              }
            >
              <option value="all">Show all</option>
              <option value="selected" disabled={!selectedId}>
                Selected tooth
              </option>
              <option value="hide-teeth">Hide teeth</option>
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-1">
            <input
              type="checkbox"
              checked={bone}
              onChange={(e) => setBone(e.target.checked)}
            />
            Surrounding bone
          </label>
          <Button onClick={() => void loadFull()} disabled={fullLoading}>
            Review and export case
          </Button>
        </div>
      )}
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
        overlays={
          pending || analysisResult?.key !== analysisKey
            ? {}
            : analysisResult.overlays
        }
        slices={pending ? preview : result!.slices}
        hasVolume
        compact={compact}
        invert={caseState?.caseView?.invert??false}
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
