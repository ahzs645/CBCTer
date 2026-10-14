import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Expand,
  LogOut,
  SlidersHorizontal,
  SunMoon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ViewerApp } from '../app/useViewerApp';
import { useCompactViewerLayout } from '../app/viewer-layout';
import { useAxisViewportLabels, appViewerTheme } from '../app/viewer-i18n';
import { ErrorBoundary } from '../app/ErrorBoundary';
import { buildShareLink } from '../app/shareLink';
import { formatSpacing } from '../app/helpers';
import { RangeField } from '../components/RangeField';
import { DentalToolbar } from '../components/dental/DentalToolbar';
import {
  BottomSheet,
  MobileActionButton,
  MobileDock,
  MobileTopBar,
  type MobileSheet,
  type MobileView,
} from '../components/dental/MobileChrome';
import {
  ToothArchGrid,
  ToothGroupChips,
  ToothModelExportForm,
  ToothShowControl,
  type ToothModelRequest,
  type ToothShowMode,
} from '../components/dental/ToothPicker';
import { ViewerStatusBar } from '../components/dental/ViewerStatusBar';
import {
  DENTAL_TOOLS,
  MEASURE_TOOLS,
  measureModeForTool,
  type DentalLayout,
} from '../components/dental/tools';
import { createStudyMeasurement } from '../domain/studyState';
import type { StudyMeasurement, StudyTool } from '../domain/types';
import { useTranslation } from '../i18n';
import { buildToothModelZip } from '../lib/case/toothExport';
import {
  archOrder,
  buildIsolatedVolume,
  mirrorFdi,
  numberingLooksMirrored,
  overlappingTeeth,
  selectionBounds,
  teethInGroup,
  toothLabel,
} from '../lib/case/toothSelection';
import type { ToothInstance } from '../lib/case/types';
import {
  computeDentalWindowPresets,
  type DentalWindowPresetId,
} from '../lib/dental/windowPresets';
import type { ChunkedSession } from '../lib/import/chunked/session';
import { extractLabelmapOverlayImage } from '../lib/segmentation/maskOperations';
import { axisPointToVoxel } from '../lib/segmentation/paintBrush';
import { displaySample, displayVoxels } from '../lib/volume/native';
import {
  VolumeAxis,
  type PreparedVolumeFor3D,
  type SliceImage,
  type SliceWindowLevel,
  type Vec3,
  type ViewerSlices,
  type VolumeCursor,
} from '../types';
import { cn } from '../utils/cn';
import { AxisViewportGrid, VolumeViewport3D } from '../viewer';
import {
  planeRegion,
  renderNativePlane,
  renderPreviewPlane,
} from '../viewer/progressiveSlices';
import type { SliceMeasurementShape } from '../viewer/react/MeasurementOverlay';

export interface StreamingViewState {
  cursor: VolumeCursor;
  windowLevel: SliceWindowLevel;
  zoom: number;
  axis: VolumeAxis;
}

function downloadBlob(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const indexKey = (a: VolumeAxis) =>
  a === VolumeAxis.Axial ? 'z' : a === VolumeAxis.Coronal ? 'y' : 'x';

/**
 * The viewer for streamed scan packages: what phones and anyone opening a
 * shared case see. It reads only the slices on screen, and uses the same
 * toolbar, status bar, phone dock and sheets as the full viewer. Teeth can be
 * picked from an arch grid, isolated in slices and in a full-resolution 3D
 * crop, and exported as STL, all without loading the whole volume.
 */
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
  const teeth = useMemo(
    () => caseState?.toothInstances ?? [],
    [caseState?.toothInstances],
  );
  const leftSign: 1 | -1 =
    (m.orientation.patientAxes?.left?.[0] ?? 1) < 0 ? -1 : 1;
  const superiorSign: 1 | -1 =
    (m.orientation.patientAxes?.superior?.[2] ?? 1) < 0 ? -1 : 1;
  const presets = useMemo(
    () => computeDentalWindowPresets(app.volume!),
    [app.volume],
  );
  const savedView = caseState?.caseView;

  // View state --------------------------------------------------------------
  const [cursor, setCursor] = useState<VolumeCursor>({
    x: savedView?.cursor[0] ?? Math.floor(dimensions[0] / 2),
    y: savedView?.cursor[1] ?? Math.floor(dimensions[1] / 2),
    z: savedView?.cursor[2] ?? Math.floor(dimensions[2] / 2),
  });
  const [wl, setWl] = useState<SliceWindowLevel>(
    () =>
      savedView?.windowLevel ??
      presets.find((p) => p.id === 'auto')?.windowLevel ??
      m.display,
  );
  const [chosenPreset, setChosenPreset] = useState<DentalWindowPresetId | null>(
    savedView?.windowLevel ? null : 'auto',
  );
  const [zoom, setZoom] = useState(savedView?.zoom ?? 1);
  const [axis, setAxis] = useState(savedView?.axis ?? VolumeAxis.Axial);
  const [invert, setInvert] = useState(savedView?.invert ?? false);
  const [tool, setTool] = useState<StudyTool>('crosshair');
  const [layout, setLayout] = useState<DentalLayout>('quad');
  const [sidebar, setSidebar] = useState(true);
  const [sheet, setSheet] = useState<MobileSheet | null>(null);
  const [mobile3D, setMobile3D] = useState(false);
  const [probe, setProbe] = useState<{
    voxel: Vec3;
    value: number;
  } | null>(null);
  const [error, setError] = useState('');
  const [fullLoading, setFullLoading] = useState(false);
  const [copied, setCopied] = useState('');

  // Teeth -------------------------------------------------------------------
  const initialTooth = teeth.find(
    (tooth) =>
      tooth.id === caseState?.selectedInstanceId ||
      (app.sharedTooth != null && tooth.fdi === app.sharedTooth),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    initialTooth && !caseState?.toothSelection?.includes(initialTooth.id)
      ? [initialTooth.id]
      : (caseState?.toothSelection ?? (initialTooth ? [initialTooth.id] : [])),
  );
  const [focusId, setFocusId] = useState<string | null>(
    initialTooth?.id ?? null,
  );
  const [showMode, setShowMode] = useState<ToothShowMode>(
    caseState?.toothVisibility ?? 'all',
  );
  const [bone, setBone] = useState(caseState?.showSurroundingBone ?? false);
  const [multi, setMulti] = useState(false);
  const mirrored = useMemo(
    () => numberingLooksMirrored(teeth, leftSign),
    [teeth, leftSign],
  );
  const [swapSides, setSwapSides] = useState(false);
  const overlaps = useMemo(() => overlappingTeeth(teeth), [teeth]);
  const [iso3D, setIso3D] = useState<PreparedVolumeFor3D | null>(null);
  const [isoStatus, setIsoStatus] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const shownFdi = (tooth: ToothInstance) =>
    swapSides ? mirrorFdi(tooth.fdi) : tooth.fdi;
  const nameOf = (tooth: ToothInstance) =>
    toothLabel({ ...tooth, fdi: shownFdi(tooth) }, teeth.indexOf(tooth));
  const selectedTeeth = teeth.filter((tooth) => selectedIds.includes(tooth.id));
  const focus = teeth.find((tooth) => tooth.id === focusId) ?? null;
  const ordered = useMemo(
    () => archOrder(teeth.filter((tooth) => tooth.review !== 'rejected')),
    [teeth],
  );

  const centerOn = (list: ToothInstance[]) => {
    if (!list.length) return;
    const box = selectionBounds(list, dimensions, 0)!;
    setCursor({
      x: Math.round(box.start[0] + box.shape[0] / 2),
      y: Math.round(box.start[1] + box.shape[1] / 2),
      z: Math.round(
        list.length === 1
          ? list[0].centroid[2]
          : box.start[2] + box.shape[2] / 2,
      ),
    });
  };
  const selectTooth = (id: string, additive: boolean, jump = true) => {
    const tooth = teeth.find((item) => item.id === id);
    if (!tooth) return;
    if (additive) {
      setSelectedIds((current) =>
        current.includes(id)
          ? current.filter((item) => item !== id)
          : [...current, id],
      );
      setFocusId(id);
      return;
    }
    setSelectedIds([id]);
    setFocusId(id);
    if (jump)
      setCursor({
        x: Math.round(tooth.centroid[0]),
        y: Math.round(tooth.centroid[1]),
        z: Math.round(tooth.centroid[2]),
      });
  };
  const stepTooth = (delta: number) => {
    if (!ordered.length) return;
    const index = ordered.findIndex((tooth) => tooth.id === focusId);
    const next =
      ordered[(index + delta + ordered.length) % ordered.length] ?? ordered[0];
    selectTooth(next.id, false);
  };
  const pickGroup = (group: Parameters<typeof teethInGroup>[1]) => {
    const list = teethInGroup(
      teeth.map((tooth) => ({ ...tooth, fdi: shownFdi(tooth) })),
      group,
    );
    setSelectedIds(list.map((tooth) => tooth.id));
    setFocusId(list[0]?.id ?? null);
    setShowMode('selected');
    centerOn(list);
  };

  // Slice rendering ---------------------------------------------------------
  const planes = useRef(
    new Map<VolumeAxis, { index: number; words: Int16Array | Uint16Array }>(),
  );
  const analysisPlanes = useRef(
    new Map<
      VolumeAxis,
      { index: number; layers: Array<{ id: string; words: Uint16Array }> }
    >(),
  );
  const [result, setResult] = useState<{
    key: string;
    slices: ViewerSlices;
  } | null>(null);
  const [analysisResult, setAnalysisResult] = useState<{
    key: string;
    overlays: Partial<Record<VolumeAxis, SliceImage | null>>;
  } | null>(null);
  const currentKey = `${cursor.x}|${cursor.y}|${cursor.z}|${wl.window}|${wl.level}|${compact ? axis : 'all'}`;
  const selectionKey = [...selectedIds].sort().join(',');
  const analysisKey = `${cursor.x}|${cursor.y}|${cursor.z}|${compact ? axis : 'all'}|${selectionKey}|${focusId}|${showMode}|${bone}`;
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
        const index = cursor[indexKey(a)];
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
        if (abort.signal.aborted) return;
        setResult({
          key: currentKey,
          slices: { ...preview, ...Object.fromEntries(images) },
        });
        setError('');
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
    const chosen = new Set(selectedIds);
    const rejected = new Set(
      teeth
        .filter((tooth) => tooth.review === 'rejected')
        .map((tooth) => `${tooth.groupId}|${tooth.value}`),
    );
    void Promise.all(
      (compact ? [axis] : Object.values(VolumeAxis)).map(async (a) => {
        const { start, shape } = planeRegion(a, cursor, dimensions);
        const index = cursor[indexKey(a)];
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
                const instance = teeth.find(
                  (item) =>
                    item.groupId === l.id && item.value === segment.value,
                );
                const permitted =
                  showMode === 'selected'
                    ? role === 'teeth'
                      ? Boolean(instance && chosen.has(instance.id))
                      : bone && !tooth
                    : showMode === 'hide-teeth'
                      ? !tooth
                      : true;
                return {
                  value: segment.value,
                  color: instance?.id === focusId ? '#facc15' : segment.color,
                  opacity: segment.opacity,
                  visible:
                    segment.visible &&
                    permitted &&
                    !rejected.has(`${l.id}|${segment.value}`),
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
    // selectedIds is represented by selectionKey inside analysisKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session,
    caseState,
    teeth,
    cursor,
    dimensions,
    spacing,
    compact,
    axis,
    focusId,
    showMode,
    bone,
    analysisKey,
  ]);
  const outlinesLoading =
    teeth.length > 0 && !pending && analysisResult?.key !== analysisKey;

  // Full-resolution 3D crop of the selected teeth ---------------------------
  const isoKey = showMode === 'selected' ? `${selectionKey}|${bone}` : '';
  useEffect(() => {
    if (!isoKey || !selectedTeeth.length || !app.prepared3D) {
      setIso3D(null);
      setIsoStatus('');
      return;
    }
    const box = selectionBounds(selectedTeeth, dimensions, bone ? 24 : 6)!;
    const voxels = box.shape[0] * box.shape[1] * box.shape[2];
    if (voxels > (compact ? 12e6 : 40e6)) {
      setIso3D(null);
      setIsoStatus(
        'Too many teeth for 3D on this device. Pick an arch or fewer teeth.',
      );
      return;
    }
    const abort = new AbortController();
    setIsoStatus('Loading 3D of the selected teeth…');
    const groupIds = [...new Set(selectedTeeth.map((tooth) => tooth.groupId))];
    void Promise.all([
      session.region(box.start, box.shape, abort.signal),
      ...groupIds.map((id) =>
        session.analysisRegion(id, box.start, box.shape, abort.signal),
      ),
    ]).then(
      ([scan, ...labels]) => {
        if (abort.signal.aborted) return;
        setIso3D(
          buildIsolatedVolume({
            scan: displayVoxels(scan, m.volume),
            labels: labels.map((words, i) => ({
              groupId: groupIds[i],
              words: words as Uint16Array,
            })),
            start: box.start,
            shape: box.shape,
            spacing,
            teeth: selectedTeeth,
            scalarRange: app.prepared3D!.scalarRange,
            threshold: app.prepared3D!.threshold,
            context: bone,
            maxEdge: compact ? 256 : 512,
          }),
        );
        setIsoStatus('');
      },
      (e) => {
        if (abort.signal.aborted) return;
        setIso3D(null);
        setIsoStatus(e instanceof Error ? e.message : String(e));
      },
    );
    return () => abort.abort();
    // selectedTeeth is represented by isoKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isoKey, session, app.prepared3D, compact]);

  // Interaction ---------------------------------------------------------------
  const labels = useAxisViewportLabels();
  const measureMode = pending ? 'off' : measureModeForTool(tool);
  const [measurements, setMeasurements] = useState<
    Array<{
      axis: VolumeAxis;
      index: number;
      shape: SliceMeasurementShape;
      record: StudyMeasurement;
    }>
  >([]);
  const updateIndex = (a: VolumeAxis, index: number) =>
    setCursor((c) => {
      const limit =
        a === VolumeAxis.Axial
          ? dimensions[2]
          : a === VolumeAxis.Coronal
            ? dimensions[1]
            : dimensions[0];
      return {
        ...c,
        [indexKey(a)]: Math.max(0, Math.min(limit - 1, Math.round(index))),
      };
    });
  const planeVoxel = (a: VolumeAxis, p: { xRatio: number; yRatio: number }) => {
    const shape = planeRegion(a, cursor, dimensions).shape;
    const point = axisPointToVoxel(a, p, { x: 0, y: 0, z: 0 }, shape);
    return (point[2] * shape[1] + point[1]) * shape[0] + point[0];
  };
  const select = (a: VolumeAxis) => (p: { xRatio: number; yRatio: number }) => {
    const index = planeVoxel(a, p);
    const layers = analysisPlanes.current.get(a)?.layers;
    const tooth = teeth.find((item) =>
      layers?.some(
        (l) => l.id === item.groupId && l.words[index] === item.value,
      ),
    );
    if (tooth) selectTooth(tooth.id, multi, false);
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
  const onProbe = (
    a: VolumeAxis,
    p: { xRatio: number; yRatio: number } | null,
  ) => {
    const plane = planes.current.get(a);
    if (!p || !plane || plane.index !== cursor[indexKey(a)]) {
      setProbe(null);
      return;
    }
    const raw = plane.words[planeVoxel(a, p)];
    if (raw === undefined) return setProbe(null);
    const voxel = axisPointToVoxel(a, p, cursor, dimensions) as Vec3;
    setProbe({ voxel, value: displaySample(raw, m.volume) });
  };
  const applyPreset = (id: DentalWindowPresetId) => {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    setChosenPreset(id);
    setWl(preset.windowLevel);
  };
  const activePresetId =
    presets.find(
      (p) =>
        p.windowLevel.window === wl.window && p.windowLevel.level === wl.level,
    )?.id ??
    (chosenPreset &&
    presets.find((p) => p.id === chosenPreset)?.windowLevel.window === wl.window
      ? chosenPreset
      : null);
  const dragStart = useRef(wl);
  const onWindowLevelDrag = (
    delta: { x: number; y: number },
    phase: 'start' | 'move' | 'end',
  ) => {
    if (phase === 'start') dragStart.current = wl;
    const span = Math.max(4095, m.scalarRange[1] - m.scalarRange[0]);
    setWl({
      window: Math.max(
        1,
        Math.round(dragStart.current.window + delta.x * span),
      ),
      level: Math.round(dragStart.current.level - delta.y * span),
    });
  };
  const loadFull = async () => {
    setFullLoading(true);
    setError('');
    try {
      onLoadFullMeasurements(
        measurements.map((item) => item.record),
        { cursor, windowLevel: wl, zoom, axis },
      );
      session.setPreferredInstance(focusId ?? '');
      await app.openPackageLevel('full');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFullLoading(false);
    }
  };
  const exportTeeth = async (request: ToothModelRequest) => {
    setExportBusy(true);
    setExportStatus('');
    try {
      const { zip, reports } = await buildToothModelZip({
        teeth: selectedTeeth.map((tooth) => ({
          ...tooth,
          fdi: shownFdi(tooth),
        })),
        allTeeth: teeth.map((tooth) => ({ ...tooth, fdi: shownFdi(tooth) })),
        dims: dimensions,
        spacing,
        scanName: m.name,
        model: { ...request, superiorSign },
        read: async (groupId, start, shape) => ({
          scan: displayVoxels(await session.region(start, shape), m.volume),
          labels: (await session.analysisRegion(
            groupId,
            start,
            shape,
          )) as Uint16Array,
        }),
        onProgress: (done, total) =>
          setExportStatus(`Meshing tooth ${done} of ${total}…`),
      });
      downloadBlob(
        zip,
        `${m.name}-${request.crownOnly ? 'crowns' : 'teeth'}.zip`,
      );
      const guessed = reports.filter((r) => r.gumlineMeasured === false).length;
      setExportStatus(
        `Saved ${reports.length} ${reports.length === 1 ? 'tooth' : 'teeth'}` +
          (guessed
            ? `; gumline guessed for ${guessed} (no bone contact found).`
            : '.'),
      );
    } catch (e) {
      setExportStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
    }
  };
  // Same keys as the full viewer (see docs/viewer-controls.md).
  const onKeyRef = useRef<(event: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      target?.closest(
        'input, textarea, select, [contenteditable="true"], [role="listbox"]',
      )
    )
      return;
    const key = event.key;
    const toolForKey = DENTAL_TOOLS.find(
      (item) => item.shortcut.toLowerCase() === key.toLowerCase(),
    );
    if (key === 'Escape') setTool('crosshair');
    else if (toolForKey) setTool(toolForKey.tool);
    else if (key === 'i' || key === 'I') setInvert((v) => !v);
    else if (/^[1-6]$/.test(key) && presets[Number(key) - 1])
      applyPreset(presets[Number(key) - 1].id);
    else if (key === 'ArrowUp' || key === 'PageUp')
      updateIndex(
        axis,
        cursor[indexKey(axis)] - (event.shiftKey || key === 'PageUp' ? 10 : 1),
      );
    else if (key === 'ArrowDown' || key === 'PageDown')
      updateIndex(
        axis,
        cursor[indexKey(axis)] +
          (event.shiftKey || key === 'PageDown' ? 10 : 1),
      );
    else if (key === '+' || key === '=') setZoom((z) => z * 1.25);
    else if (key === '-' || key === '_') setZoom((z) => z / 1.25);
    else if (key === '0') setZoom(1);
    else if (key === ']') stepTooth(1);
    else if (key === '[') stepTooth(-1);
    else return;
    event.preventDefault();
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyRef.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const shareLink = app.sourceUrl
    ? buildShareLink(window.location.href, {
        url: app.sourceUrl,
        ...(focus && shownFdi(focus) ? { tooth: shownFdi(focus)! } : {}),
      })
    : null;
  const copyShareLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied('Link copied.');
    } catch {
      setCopied('Copy the link from the box below.');
    }
  };

  const shapes = Object.fromEntries(
    Object.values(VolumeAxis).map((a) => [
      a,
      pending
        ? []
        : measurements
            .filter((v) => v.axis === a && v.index === cursor[indexKey(a)])
            .map((v) => v.shape),
    ]),
  );
  const toolHint =
    measureMode !== 'off'
      ? t('dental.toolbar.measureHint')
      : tool === 'window-level'
        ? t('dental.toolbar.contrastHint')
        : t('dental.toolbar.navigateHint');
  const statusText = pending
    ? t('streaming.loadingSlices')
    : outlinesLoading
      ? 'Loading tooth outlines…'
      : t('streaming.fullSlices');
  const statusChip = (
    <span
      role="status"
      data-testid="streaming-status"
      className={cn(
        'inline-flex h-7 items-center rounded-full border px-2.5 text-[11px]',
        pending || outlinesLoading
          ? 'border-amber-400/40 text-amber-100'
          : 'border-sky-500/40 text-sky-200',
      )}
    >
      {pending ? t('streaming.loadingSlices') : t('streaming.fullSlices')}
    </span>
  );

  const frame3D = (
    <div className="relative flex h-full flex-col">
      <p className="px-3 py-1 text-xs text-slate-400">
        {iso3D
          ? `3D · ${selectedTeeth.length === 1 ? nameOf(selectedTeeth[0]) : `${selectedTeeth.length} selected teeth`} (full resolution)`
          : t('streaming.preview3d')}
      </p>
      {isoStatus ? (
        <p role="status" className="px-3 text-xs text-amber-100">
          {isoStatus}
        </p>
      ) : null}
      <ErrorBoundary area="3D view" inline>
        <VolumeViewport3D
          className="min-h-0 flex-1"
          volume={iso3D ?? app.prepared3D}
        />
      </ErrorBoundary>
    </div>
  );

  const grid = (phone: boolean) => (
    <AxisViewportGrid
      className={phone ? 'h-full' : 'min-h-0 flex-1'}
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
      compact={phone}
      showAxisSelector={!phone}
      invert={invert}
      theme={appViewerTheme}
      labels={labels}
      onSelectAxis={select}
      onProbeAxis={onProbe}
      onWindowLevelDrag={
        tool === 'window-level' ? onWindowLevelDrag : undefined
      }
      onSliceStep={(a, delta) => updateIndex(a, cursor[indexKey(a)] + delta)}
      onSliceIndexChange={updateIndex}
      measureMode={measureMode}
      measurementShapes={shapes}
      onMeasurementComplete={(a, measurement) =>
        setMeasurements((v) => [
          ...v,
          {
            axis: a,
            index: cursor[indexKey(a)],
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
      layout={layout === 'focus' ? 'focus' : 'quad'}
      maximizedPane={layout === '3d' ? 'extra' : null}
      extraPane={frame3D}
    />
  );

  const section = (title: string, children: ReactNode) => (
    <section className="space-y-2 border-b border-slate-800 p-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </h2>
      {children}
    </section>
  );

  const teethPanel = teeth.length ? (
    <>
      {section(
        `Teeth · ${teeth.filter((tooth) => tooth.review !== 'rejected').length} outlined`,
        <>
          {mirrored && !swapSides ? (
            <div
              role="alert"
              className="rounded border border-amber-400/40 bg-amber-950/40 p-2 text-xs text-amber-100"
            >
              Left and right numbers look swapped compared with the scan
              orientation: most teeth sit on the opposite side from their
              number. Check a tooth you know (a filling, a gap) before trusting
              them.
              <button
                type="button"
                className="mt-1 block min-h-9 rounded border border-amber-400/50 px-2"
                onClick={() => setSwapSides(true)}
              >
                Swap left and right numbers
              </button>
            </div>
          ) : swapSides ? (
            <p className="text-xs text-amber-100">
              Showing numbers swapped left ↔ right.{' '}
              <button
                type="button"
                className="underline"
                onClick={() => setSwapSides(false)}
              >
                Undo
              </button>
            </p>
          ) : null}
          {overlaps.length ? (
            <div className="rounded border border-amber-400/40 bg-amber-950/30 p-2 text-xs text-amber-100">
              {overlaps.map(([a, b]) => (
                <p key={`${a.id}-${b.id}`}>
                  {nameOf(a)} and {nameOf(b)} overlap: probably one tooth split
                  in two.{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setSelectedIds([a.id, b.id]);
                      setFocusId(a.id);
                      setShowMode('selected');
                      centerOn([a, b]);
                    }}
                  >
                    Show both
                  </button>
                </p>
              ))}
              <p className="mt-1 text-amber-100/80">
                Merge them in the full editor (Review teeth → Merge).
              </p>
            </div>
          ) : null}
          <ToothArchGrid
            teeth={teeth}
            selectedIds={selectedIds}
            focusId={focusId}
            swapSides={swapSides}
            multi={multi}
            touch={compact}
            onSelect={(id, additive) => selectTooth(id, additive)}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous tooth"
              className="inline-flex h-9 w-9 items-center justify-center rounded border border-slate-700 hover:bg-slate-800"
              onClick={() => stepTooth(-1)}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <span
              className="min-w-0 flex-1 truncate text-center text-sm text-slate-100"
              aria-live="polite"
            >
              {selectedTeeth.length > 1
                ? `${selectedTeeth.length} teeth selected`
                : focus
                  ? `${nameOf(focus)} · ${focus.review}`
                  : 'Tap a tooth or a slice'}
            </span>
            <button
              type="button"
              aria-label="Next tooth"
              className="inline-flex h-9 w-9 items-center justify-center rounded border border-slate-700 hover:bg-slate-800"
              onClick={() => stepTooth(1)}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <label className="flex min-h-9 items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 accent-sky-400"
              checked={multi}
              onChange={(e) => setMulti(e.target.checked)}
            />
            Select several (or Ctrl/⌘-click)
          </label>
          <ToothGroupChips
            available={(group) =>
              teethInGroup(
                teeth.map((tooth) => ({ ...tooth, fdi: shownFdi(tooth) })),
                group,
              ).length
            }
            onPick={pickGroup}
          />
          <button
            type="button"
            disabled={fullLoading}
            onClick={() => void loadFull()}
            className="inline-flex min-h-10 w-full items-center justify-center rounded border border-slate-600 bg-slate-800 px-3 text-sm hover:bg-slate-700 disabled:opacity-50"
          >
            {fullLoading ? t('streaming.loadingFull') : 'Review and edit teeth'}
          </button>
        </>,
      )}
      {section(
        'Show',
        <>
          <ToothShowControl
            mode={showMode}
            hasSelection={selectedIds.length > 0}
            onChange={setShowMode}
          />
          <label className="flex min-h-9 items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 accent-sky-400"
              checked={bone}
              onChange={(e) => setBone(e.target.checked)}
            />
            Show surrounding bone
          </label>
          <p className="text-[11px] text-slate-400">
            “Only selected” shows those teeth alone in the slices and builds a
            full-resolution 3D view of them.
          </p>
        </>,
      )}
      {section(
        'Export model (STL)',
        <ToothModelExportForm
          count={selectedTeeth.length}
          busy={exportBusy}
          status={exportStatus}
          onExport={(request) => void exportTeeth(request)}
        />,
      )}
    </>
  ) : (
    section(
      'Teeth',
      <p className="text-xs text-slate-400">
        This scan has no tooth outlines yet. Open the full editor to propose or
        draw them.
      </p>,
    )
  );

  const contrastPanel = section(
    'Contrast',
    <>
      <RangeField
        label={t('streaming.window')}
        aria-label={t('streaming.window')}
        value={wl.window}
        min={1}
        max={Math.max(
          4095,
          m.scalarRange[1] - m.scalarRange[0],
          m.display.window,
        )}
        onChange={(window) => setWl((v) => ({ ...v, window }))}
      />
      <RangeField
        label={t('streaming.level')}
        aria-label={t('streaming.level')}
        value={wl.level}
        min={Math.min(-1024, m.scalarRange[0])}
        max={Math.max(4095, m.scalarRange[1])}
        onChange={(level) => setWl((v) => ({ ...v, level }))}
      />
      <p className="text-[11px] text-slate-400">
        Presets: keys 1–6. Drag on a slice with the Contrast tool (W).
      </p>
    </>,
  );

  const sharePanel = section(
    'Share',
    shareLink ? (
      <>
        <button
          type="button"
          onClick={() => void copyShareLink()}
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded border border-slate-600 bg-slate-800 px-3 text-sm hover:bg-slate-700"
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
          Copy share link
        </button>
        <input
          readOnly
          aria-label="Share link"
          value={shareLink}
          onFocus={(e) => e.currentTarget.select()}
          className="min-h-9 w-full rounded border border-slate-700 bg-slate-950 px-2 font-mono text-[11px] text-slate-300"
        />
        {copied ? (
          <p role="status" className="text-xs text-slate-300">
            {copied}
          </p>
        ) : null}
        <p className="text-[11px] text-slate-400">
          Anyone with the link can open this scan. The link opens the file where
          it is hosted{focus ? ` and selects ${nameOf(focus)}` : ''}. Scan names
          can contain the scan date.
        </p>
      </>
    ) : (
      <p className="text-xs text-slate-400">
        This scan is only on this device. To send it, share the .cbct.zip file
        itself; the recipient drops it on the CBCTer start page. For a link that
        opens straight into this view, host the file where other websites may
        read it (Hugging Face, GitHub raw files under 100 MB, or an S3/R2 bucket
        with CORS) and open it once from that link. Google Drive and Dropbox
        links can't be opened by other sites.
      </p>
    ),
  );

  const fullEditorButton = (
    <button
      type="button"
      disabled={fullLoading}
      onClick={() => void loadFull()}
      className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded border border-slate-600 bg-slate-800 px-3 text-sm hover:bg-slate-700 disabled:opacity-50"
    >
      <Expand className="h-4 w-4" aria-hidden="true" />
      {fullLoading ? t('streaming.loadingFull') : t('streaming.advanced')}
    </button>
  );

  const scanPanel = section(
    'Scan',
    <>
      <p className="text-xs text-slate-300">
        {dimensions.join(' × ')} voxels · {formatSpacing(spacing)}
      </p>
      {fullEditorButton}
      <p className="text-[11px] text-slate-400">
        {t('streaming.advancedHint')}
      </p>
      <button
        type="button"
        disabled={fullLoading}
        onClick={() => app.resetViewer()}
        className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded border border-slate-700 px-3 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {t('streaming.close')}
      </button>
    </>,
  );

  const errorBanner = error ? (
    <p
      role="alert"
      className="border-b border-rose-500/30 bg-rose-950/40 px-3 py-2 text-sm text-rose-200"
    >
      {error}
    </p>
  ) : null;

  const dataAttributes = {
    'data-testid': 'progressive-viewer',
    'data-bytes-read': session.stats.bytesRead,
    'data-cache-bytes': session.stats.cacheBytes,
    'data-cache-limit': session.stats.cacheLimitBytes,
    'data-decoded-chunks': session.stats.decodedChunks,
  };

  if (!compact)
    return (
      <main
        className="relative flex h-dvh flex-col overflow-hidden bg-slate-950 text-slate-100"
        {...dataAttributes}
      >
        <DentalToolbar
          scanLabel={m.name}
          formatLabel={`${dimensions.join(' × ')} · ${formatSpacing(spacing)}`}
          status={statusChip}
          activeTool={tool}
          presets={presets}
          activePresetId={activePresetId}
          invert={invert}
          zoom={zoom}
          layout={layout}
          sidebarVisible={sidebar}
          onToolChange={setTool}
          onPresetChange={applyPreset}
          onInvertChange={setInvert}
          onZoomChange={setZoom}
          onLayoutChange={setLayout}
          onOpenTeeth={teeth.length ? () => setSidebar(true) : undefined}
          onSidebarVisibleChange={setSidebar}
        />
        {errorBanner}
        <div className="flex min-h-0 flex-1">
          {grid(false)}
          {sidebar ? (
            <aside
              aria-label="Case panel"
              className="w-80 shrink-0 overflow-y-auto border-l border-slate-800 bg-slate-950 xl:w-96"
            >
              <ErrorBoundary area="side panel" inline>
                {teethPanel}
                {contrastPanel}
                {sharePanel}
                {scanPanel}
              </ErrorBoundary>
            </aside>
          ) : null}
        </div>
        <ViewerStatusBar
          cursor={cursor}
          dimensions={dimensions}
          spacing={spacing}
          windowLevel={wl}
          zoom={zoom}
          probe={probe}
          toolHint={outlinesLoading ? statusText : toolHint}
        />
      </main>
    );

  const mobileView: MobileView = mobile3D ? '3d' : axis;
  return (
    <main
      className="relative flex h-[100dvh] flex-col overflow-hidden bg-slate-950 text-slate-100"
      {...dataAttributes}
    >
      <MobileTopBar
        scanLabel={m.name}
        view={mobileView}
        onViewChange={(view) => {
          if (view === '3d') return setMobile3D(true);
          setMobile3D(false);
          setAxis(view);
        }}
      />
      {errorBanner}
      <div className="relative min-h-0 flex-1 bg-black">
        {mobile3D ? frame3D : grid(true)}
        <div
          className={cn(
            'pointer-events-none absolute left-2 top-[4.25rem] z-20 flex flex-wrap gap-1',
            mobile3D && 'hidden',
          )}
        >
          {statusChip}
          {focus ? (
            <span className="rounded-full border border-yellow-400/50 bg-slate-950/80 px-2.5 py-1 text-[11px] text-yellow-100">
              {selectedTeeth.length > 1
                ? `${selectedTeeth.length} teeth`
                : nameOf(focus)}
            </span>
          ) : null}
        </div>
        {tool !== 'crosshair' ? (
          <div className="pointer-events-none absolute inset-x-0 top-12 z-30 flex justify-center px-3">
            <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-sky-500/60 bg-slate-950/90 py-1 pl-3 pr-1 text-xs text-sky-100 shadow-lg">
              <span>{toolHint}</span>
              <button
                type="button"
                onClick={() => setTool('crosshair')}
                className="h-8 rounded-full bg-sky-500 px-3 font-semibold text-slate-950"
              >
                OK
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <MobileDock
        activeSheet={sheet}
        navigateActive={tool === 'crosshair'}
        measureActive={measureMode !== 'off'}
        contrastActive={tool === 'window-level'}
        chartCount={selectedIds.length}
        chartLabel="Teeth"
        onNavigate={() => {
          setTool('crosshair');
          setSheet(null);
        }}
        onSheetChange={setSheet}
      />
      {sheet ? (
        <div
          aria-hidden="true"
          className={cn(
            'absolute inset-0 z-40',
            sheet === 'contrast' ? 'bg-transparent' : 'bg-slate-950/30',
          )}
          onClick={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'measure' ? (
        <BottomSheet
          title={t('dental.measures.title')}
          onClose={() => setSheet(null)}
        >
          <div className="grid grid-cols-2 gap-2">
            {MEASURE_TOOLS.map((item) => (
              <MobileActionButton
                key={item.tool}
                icon={<item.icon className="h-5 w-5" aria-hidden="true" />}
                label={t(`dental.toolbar.${item.labelKey}`)}
                active={tool === item.tool}
                onClick={() => {
                  setTool(item.tool);
                  setSheet(null);
                  setMobile3D(false);
                }}
              />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            {measurements.length} measurement
            {measurements.length === 1 ? '' : 's'} on this scan.
          </p>
        </BottomSheet>
      ) : null}
      {sheet === 'contrast' ? (
        <BottomSheet
          title={t('dental.presets.title')}
          onClose={() => setSheet(null)}
        >
          <div className="grid grid-cols-3 gap-2">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                aria-pressed={activePresetId === preset.id}
                onClick={() => applyPreset(preset.id)}
                className={cn(
                  'h-12 rounded-lg border px-1 text-xs font-medium transition',
                  activePresetId === preset.id
                    ? 'border-sky-500 bg-sky-500/15 text-sky-100'
                    : 'border-slate-700 bg-slate-950 text-slate-200 active:bg-slate-800',
                )}
              >
                {t(`dental.presets.${preset.id}`)}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <MobileActionButton
              icon={<SunMoon className="h-5 w-5" aria-hidden="true" />}
              label={t('dental.toolbar.invert')}
              active={invert}
              onClick={() => setInvert((v) => !v)}
            />
            <MobileActionButton
              icon={
                <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
              }
              label={t('dental.toolbar.contrast')}
              active={tool === 'window-level'}
              onClick={() => {
                setTool('window-level');
                setSheet(null);
              }}
            />
          </div>
          <div className="mt-3 space-y-2">
            <RangeField
              label={t('streaming.window')}
              aria-label={t('streaming.window')}
              value={wl.window}
              min={1}
              max={Math.max(
                4095,
                m.scalarRange[1] - m.scalarRange[0],
                m.display.window,
              )}
              onChange={(window) => setWl((v) => ({ ...v, window }))}
            />
            <RangeField
              label={t('streaming.level')}
              aria-label={t('streaming.level')}
              value={wl.level}
              min={Math.min(-1024, m.scalarRange[0])}
              max={Math.max(4095, m.scalarRange[1])}
              onChange={(level) => setWl((v) => ({ ...v, level }))}
            />
          </div>
        </BottomSheet>
      ) : null}
      {sheet === 'chart' ? (
        <BottomSheet title="Teeth" onClose={() => setSheet(null)} tall>
          <ErrorBoundary area="teeth panel" inline>
            <div className="-mx-3">{teethPanel}</div>
          </ErrorBoundary>
        </BottomSheet>
      ) : null}
      {sheet === 'more' ? (
        <BottomSheet
          title={t('dental.toolbar.more')}
          onClose={() => setSheet(null)}
          tall
        >
          <div className="-mx-3">
            {sharePanel}
            {scanPanel}
          </div>
        </BottomSheet>
      ) : null}
    </main>
  );
}
