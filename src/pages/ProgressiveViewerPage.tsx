import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Expand,
  FileText,
  Focus,
  LogOut,
  SlidersHorizontal,
  SunMoon,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
import {
  buildToothModelZip,
  type ToothCropReader,
} from '../lib/case/toothExport';
import { exportBudgetBytes, planToothExport } from '../lib/case/exportBudget';
import {
  addedTeethRegion,
  caseKey,
  editsFromLinkParams,
  editsToLinkParams,
  loadCaseEdits,
  saveCaseEdits,
  type AddedTooth,
} from '../lib/case/caseEdits';
import { decodeMask, encodeMask } from '../lib/dental/growTooth';
import { AddToothPanel } from '../components/dental/AddToothPanel';
import {
  archOrder,
  buildIsolatedVolume,
  fdiArch,
  crownDirectionFor,
  mirrorFdi,
  numberingLooksMirrored,
  findSplitTeeth,
  mergeTeethView,
  toothValues,
  selectionBounds,
  teethInGroup,
  toothLabel,
} from '../lib/case/toothSelection';
import type { ToothInstance } from '../lib/case/types';
import {
  canalSliceMarks,
  voxelToAxisPoint,
  type CanalVolumeRead,
} from '../lib/dental/canal';
import { compute } from '../lib/dental/computeClient';
import {
  drawCanalMarks,
  drawDots,
  overlaySize,
} from '../lib/dental/overlayDraw';
import type { DarkArea } from '../lib/dental/toothFocus';
import { buildDentalReportHtml } from '../lib/dental/report';
import { downloadText } from '../lib/dental/snapshot';
import { CanalPanel, type CanalSide } from '../components/dental/CanalPanel';
import { LayerList } from '../components/dental/LayerList';
import { ToothFocusView } from '../components/dental/ToothFocusView';
import {
  alignInWorker,
  crownTargetPoints,
  meshPointsNearSlice,
  type IntraoralFit,
} from '../lib/ios/fuseIntraoral';
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

function downloadBlob(data: Uint8Array | Blob, name: string) {
  const url = URL.createObjectURL(
    data instanceof Blob
      ? data
      : new Blob([data as Uint8Array<ArrayBuffer>], {
          type: 'application/zip',
        }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Label layer id of teeth outlined by hand in this viewer. */
const ADDED_GROUP = 'added-teeth';

/** A segment group for the hand-added teeth layer (value k + 1 each). */
function addedGroup(teeth: AddedTooth[]) {
  const now = 0;
  return {
    id: ADDED_GROUP,
    studyId: '',
    imageId: '',
    name: 'Teeth added by hand',
    visible: true,
    opacity: 0.55,
    segments: teeth.map((tooth, k) => ({
      id: tooth.id,
      value: k + 1,
      name: tooth.fdi ? `Tooth ${tooth.fdi}` : 'Added tooth',
      color: '#34d399',
      opacity: 0.55,
      visible: true,
      locked: false,
      createdAt: now,
      updatedAt: now,
    })),
    createdAt: now,
    updatedAt: now,
  };
}

const numberName = (fdi: number | null) =>
  fdi ? `Tooth ${fdi}` : 'Added tooth';

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
  // Corrections to this read-only case: saved on this device per scan, and
  // the numbering swap and merges also travel in share links.
  const editsKey = caseKey(m.volume.sha256, m.name);
  const linkEdits = useMemo(
    () =>
      app.sharedEdits
        ? editsFromLinkParams(new URLSearchParams(app.sharedEdits))
        : null,
    [app.sharedEdits],
  );
  // Teeth the model missed, outlined by hand (plus one being outlined now).
  const [addedTeeth, setAddedTeeth] = useState<AddedTooth[]>([]);
  const [draftTooth, setDraftTooth] = useState<
    (AddedTooth & { seed: Vec3; level: number; leaked: boolean }) | null
  >(null);
  const shownAdded = useMemo(
    () => (draftTooth ? [...addedTeeth, draftTooth] : addedTeeth),
    [addedTeeth, draftTooth],
  );
  const addedMasks = useMemo(
    () =>
      new Map(
        shownAdded.map((tooth) => [
          tooth.id,
          decodeMask(tooth.runs, tooth.shape[0] * tooth.shape[1] * tooth.shape[2]),
        ]),
      ),
    [shownAdded],
  );
  /** Labels of one layer in a box; hand-added teeth form their own layer. */
  const labelRegion = useCallback(
    async (
      groupId: string,
      start: Vec3,
      shape: Vec3,
      signal?: AbortSignal,
    ): Promise<Uint16Array> =>
      groupId === ADDED_GROUP
        ? addedTeethRegion(shownAdded, addedMasks, start, shape)
        : ((await session.analysisRegion(
            groupId,
            start,
            shape,
            signal,
          )) as Uint16Array),
    [session, shownAdded, addedMasks],
  );
  const rawTeeth = useMemo<ToothInstance[]>(
    () => [
      ...(caseState?.toothInstances ?? []),
      ...shownAdded.map((tooth, k) => ({
        id: tooth.id,
        groupId: ADDED_GROUP,
        value: k + 1,
        fdi: tooth.fdi,
        review: 'corrected' as const,
        centroid: tooth.centroid,
        bounds: tooth.bounds,
        voxelCount: tooth.voxels,
        source: 'manual' as const,
      })),
    ],
    [caseState?.toothInstances, shownAdded],
  );
  // Teeth the model cut in two (found below) can be shown as one tooth.
  const [splits, setSplits] = useState<
    Array<{ a: ToothInstance; b: ToothInstance; sharedMm2: number }>
  >([]);
  const [mergedPairs, setMergedPairs] = useState<Array<[string, string]>>(
    () => linkEdits?.mergedPairs ?? [],
  );
  const teeth = useMemo(
    () => mergeTeethView(rawTeeth, mergedPairs),
    [rawTeeth, mergedPairs],
  );
  /** Scan (display values) and labels of one tooth group in a box. */
  const readCrop = useCallback<ToothCropReader>(
    async (groupId, start, shape) => ({
      scan: displayVoxels(await session.region(start, shape), m.volume),
      labels: (await labelRegion(
        groupId,
        start,
        shape,
      )) as Uint16Array,
    }),
    [session, m.volume, labelRegion],
  );
  useEffect(() => {
    if (rawTeeth.length < 2) return;
    let cancelled = false;
    // Wait for the first slices; the decoder works one request at a time.
    const timer = window.setTimeout(() => {
      findSplitTeeth(
        rawTeeth,
        dimensions,
        spacing,
        async (groupId, start, shape) =>
          (await labelRegion(groupId, start, shape)) as Uint16Array,
        15,
        (input) => compute('sharedSurface', input),
      ).then(
        (found) => {
          if (!cancelled) setSplits(found);
        },
        () => undefined,
      );
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [rawTeeth, dimensions, spacing, labelRegion]);
  // Layers: per-tooth visibility and colour, one opacity for all outlines.
  const [hiddenTeeth, setHiddenTeeth] = useState<Set<string>>(new Set());
  const [toothColors, setToothColors] = useState<Record<string, string>>({});
  const [outlineOpacity, setOutlineOpacity] = useState(1);
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
      (app.sharedTooth != null &&
        (linkEdits?.swapSides ? mirrorFdi(tooth.fdi) : tooth.fdi) ===
          app.sharedTooth),
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
  const [swapSides, setSwapSides] = useState(linkEdits?.swapSides ?? false);
  // Load this scan's saved corrections once; a share link's swap and merges
  // take precedence over the device's.
  const [editsReady, setEditsReady] = useState(false);
  const [editsNote, setEditsNote] = useState('');
  useEffect(() => {
    let live = true;
    void loadCaseEdits(editsKey).then((saved) => {
      if (!live) return;
      if (!linkEdits) {
        if (saved.swapSides) setSwapSides(true);
        if (saved.mergedPairs?.length) setMergedPairs(saved.mergedPairs);
      }
      if (saved.addedTeeth?.length) setAddedTeeth(saved.addedTeeth);
      if (saved.hiddenTeeth?.length)
        setHiddenTeeth(new Set(saved.hiddenTeeth));
      if (saved.toothColors) setToothColors(saved.toothColors);
      setEditsReady(true);
    });
    return () => {
      live = false;
    };
  }, [editsKey, linkEdits]);
  useEffect(() => {
    if (!editsReady) return;
    const timer = window.setTimeout(() => {
      saveCaseEdits(editsKey, {
        swapSides,
        mergedPairs,
        addedTeeth,
        hiddenTeeth: [...hiddenTeeth],
        toothColors,
      }).then(
        () => setEditsNote(''),
        () =>
          setEditsNote(
            'Corrections could not be saved on this device (storage is off or full).',
          ),
      );
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    editsReady,
    editsKey,
    swapSides,
    mergedPairs,
    addedTeeth,
    hiddenTeeth,
    toothColors,
  ]);
  const [isoResult, setIsoResult] = useState<{
    key: string;
    volume: PreparedVolumeFor3D | null;
    status: string;
  } | null>(null);
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
      {
        index: number;
        /** Hand-added teeth the cached layers were read with. */
        added: string;
        layers: Array<{ id: string; words: Uint16Array }>;
      }
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
  const layersKey = `${[...hiddenTeeth].sort().join(',')}|${JSON.stringify(toothColors)}|${outlineOpacity}|${mergedPairs.length}`;
  const addedKey = shownAdded.map((tooth) => tooth.id).join(',');
  const analysisKey = `${cursor.x}|${cursor.y}|${cursor.z}|${compact ? axis : 'all'}|${selectionKey}|${focusId}|${showMode}|${bone}|${layersKey}|${addedKey}`;

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
    const groups = [
      ...(caseState?.segmentGroups ?? []).filter(
        (g) =>
          g.visible &&
          session.caseMetadata?.manifest.layers.some(
            (l) => l.id === g.id && l.role !== 'prediction',
          ),
      ),
      ...(shownAdded.length ? [addedGroup(shownAdded)] : []),
    ];
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
          cached?.index === index && cached.added === addedKey
            ? cached.layers
            : await Promise.all(
                groups.map(async (g) => ({
                  id: g.id,
                  words: await labelRegion(
                    g.id,
                    start,
                    shape,
                    abort.signal,
                  ),
                })),
              );
        if (abort.signal.aborted)
          throw new DOMException('Cancelled', 'AbortError');
        analysisPlanes.current.set(a, { index, added: addedKey, layers });
        const image = extractLabelmapOverlayImage(
          layers.map((l) => {
            const group = groups.find((g) => g.id === l.id)!,
              role =
                l.id === ADDED_GROUP
                  ? 'teeth'
                  : session.caseMetadata?.manifest.layers.find(
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
                    item.groupId === l.id &&
                    toothValues(item).includes(segment.value),
                );
                const permitted =
                  showMode === 'selected'
                    ? role === 'teeth'
                      ? Boolean(instance && chosen.has(instance.id))
                      : bone && !tooth
                    : showMode === 'hide-teeth'
                      ? !tooth
                      : true;
                const ownColor =
                  (instance && toothColors[instance.id]) ??
                  (instance && instance.value !== segment.value
                    ? group.segments.find((s) => s.value === instance.value)
                        ?.color
                    : undefined) ??
                  segment.color;
                return {
                  value: segment.value,
                  color: instance?.id === focusId ? '#facc15' : ownColor,
                  opacity: Math.min(1, segment.opacity * outlineOpacity),
                  visible:
                    segment.visible &&
                    permitted &&
                    !(instance && hiddenTeeth.has(instance.id)) &&
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
    shownAdded,
  ]);
  const outlinesLoading =
    teeth.length > 0 && !pending && analysisResult?.key !== analysisKey;

  // Full-resolution 3D crop of the selected teeth ---------------------------
  const isoKey =
    showMode === 'selected' && selectedTeeth.length && app.prepared3D
      ? `${selectionKey}|${bone}|${addedKey}`
      : '';
  const isoBox = isoKey
    ? selectionBounds(selectedTeeth, dimensions, bone ? 24 : 6)
    : null;
  const isoTooBig = Boolean(
    isoBox &&
      isoBox.shape[0] * isoBox.shape[1] * isoBox.shape[2] >
        (compact ? 12e6 : 40e6),
  );
  const iso3D =
    isoKey && !isoTooBig && isoResult?.key === isoKey ? isoResult.volume : null;
  const isoStatus = !isoKey
    ? ''
    : isoTooBig
      ? 'Too many teeth for 3D on this device. Pick an arch or fewer teeth.'
      : isoResult?.key === isoKey
        ? isoResult.status
        : 'Loading 3D of the selected teeth…';
  useEffect(() => {
    if (!isoKey || isoTooBig || !isoBox) return;
    const box = isoBox;
    const abort = new AbortController();
    const groupIds = [...new Set(selectedTeeth.map((tooth) => tooth.groupId))];
    void Promise.all([
      session.region(box.start, box.shape, abort.signal),
      ...groupIds.map((id) =>
        labelRegion(id, box.start, box.shape, abort.signal),
      ),
    ]).then(
      ([scan, ...labels]) => {
        if (abort.signal.aborted) return;
        setIsoResult({
          key: isoKey,
          status: '',
          volume: buildIsolatedVolume({
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
        });
      },
      (e) => {
        if (abort.signal.aborted) return;
        setIsoResult({
          key: isoKey,
          volume: null,
          status: e instanceof Error ? e.message : String(e),
        });
      },
    );
    return () => abort.abort();
    // selectedTeeth and the box are represented by isoKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isoKey, isoTooBig, session, compact]);

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
    if (addPick !== null) {
      const voxel = axisPointToVoxel(a, p, cursor, dimensions).map((v) =>
        Math.round(v),
      ) as Vec3;
      setAddPick(null);
      void growAt(voxel, addPick, 0.5);
    }
    if (canalPick) {
      const voxel = axisPointToVoxel(a, p, cursor, dimensions) as Vec3;
      const points = [...canalPick.points, voxel];
      if (points.length >= 2) {
        setCanalPick(null);
        void traceCanal(canalPick.side, points[0], points[1]);
      } else setCanalPick({ side: canalPick.side, points });
    }
    const index = planeVoxel(a, p);
    const layers = analysisPlanes.current.get(a)?.layers;
    const tooth = teeth.find((item) =>
      layers?.some(
        (l) =>
          l.id === item.groupId && toothValues(item).includes(l.words[index]),
      ),
    );
    if (tooth && !canalPick && addPick === null)
      selectTooth(tooth.id, multi, false);
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
    // Phones get a smaller memory budget; drop what won't fit up front.
    const union = selectionBounds(selectedTeeth, dimensions, 8);
    const plan = planToothExport({
      teeth: selectedTeeth.length,
      unionVoxels: union ? union.shape[0] * union.shape[1] * union.shape[2] : 0,
      archModel: request.archModel,
      smaller: request.smaller,
      budgetBytes: exportBudgetBytes(),
    });
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
        model: {
          ...request,
          archModel: plan.archModel,
          superiorSign,
          intraoral:
            iosUse && iosFit
              ? {
                  crowns: iosFit.crowns,
                  note: `${iosName} aligned to the CBCT crowns (fit RMS ${iosFit.rms.toFixed(2)} mm; CBCT-to-scan surface distance mean ${iosFit.deviation.mean.toFixed(2)} mm, 95% within ${iosFit.deviation.p95.toFixed(2)} mm). Use these crowns instead of the CBCT crowns where they overlap.`,
                }
              : undefined,
        },
        read: async (groupId, start, shape) => ({
          scan: displayVoxels(await session.region(start, shape), m.volume),
          labels: (await labelRegion(
            groupId,
            start,
            shape,
          )) as Uint16Array,
        }),
        onProgress: (done, total) =>
          setExportStatus(`Meshing tooth ${done} of ${total}…`),
        compute: {
          part: (input) => compute('toothPart', input),
          arch: (options) => compute('archModel', options),
        },
        readLabels: async (groupId, start, shape) =>
          (await labelRegion(groupId, start, shape)) as Uint16Array,
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
            : '.') +
          (plan.note ? ` ${plan.note}` : ''),
      );
    } catch (e) {
      setExportStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
    }
  };
  // Same keys as the full viewer (see docs/viewer-controls.md).
  const onKeyRef = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
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
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyRef.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const shareLink = app.sourceUrl
    ? buildShareLink(window.location.href, {
        url: app.sourceUrl,
        ...(focus && shownFdi(focus) ? { tooth: shownFdi(focus)! } : {}),
        edits: editsToLinkParams({ swapSides, mergedPairs }),
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

  // Intraoral scan: align it to the CBCT crowns and use its crown surfaces --
  const [iosFit, setIosFit] = useState<IntraoralFit | null>(null);
  const [iosName, setIosName] = useState('');
  const [iosBusy, setIosBusy] = useState(false);
  const [iosStatus, setIosStatus] = useState('');
  const [iosShow, setIosShow] = useState(true);
  const [iosUse, setIosUse] = useState(true);
  const importIntraoral = async (file: File) => {
    const target = (selectedTeeth.length ? selectedTeeth : teeth).filter(
      (tooth) => tooth.review !== 'rejected',
    );
    setIosBusy(true);
    setIosFit(null);
    setIosStatus('Reading the scan…');
    try {
      // Align against every crown of the arch(es) involved, then keep the
      // parts of the scan over the chosen teeth.
      const arches = new Set(
        target.map((tooth) => crownDirectionFor(tooth, teeth, superiorSign)),
      );
      const archTeeth = teeth.filter(
        (tooth) =>
          tooth.review !== 'rejected' &&
          arches.has(crownDirectionFor(tooth, teeth, superiorSign)),
      );
      setIosStatus(`Finding the crowns of ${archTeeth.length} teeth…`);
      const common = {
        allTeeth: teeth,
        dims: dimensions,
        spacing,
        read: readCrop,
        superiorSign,
      };
      const archTarget = await crownTargetPoints({
        ...common,
        teeth: archTeeth,
      });
      const keepTarget =
        archTeeth.length === target.length
          ? archTarget
          : await crownTargetPoints({ ...common, teeth: target });
      setIosStatus('Reading and aligning the scan…');
      const fit = await alignInWorker(
        new Uint8Array(await file.arrayBuffer()),
        file.name,
        archTarget,
        keepTarget,
      );
      setIosFit(fit);
      setIosName(file.name);
      setIosStatus('');
    } catch (e) {
      setIosStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setIosBusy(false);
    }
  };

  // Tooth focus and the dark-area check --------------------------------------
  const [focusTooth, setFocusTooth] = useState<ToothInstance | null>(null);
  const [darkCheck, setDarkCheck] = useState<{
    done: number;
    total: number;
    results: Array<{ tooth: ToothInstance; focal: DarkArea[]; pulp: boolean }>;
  } | null>(null);
  const checkAllTeeth = async () => {
    const list = archOrder(
      teeth.filter((tooth) => tooth.review !== 'rejected'),
    );
    const results: Array<{
      tooth: ToothInstance;
      focal: DarkArea[];
      pulp: boolean;
    }> = [];
    setDarkCheck({ done: 0, total: list.length, results: [] });
    for (const [index, tooth] of list.entries()) {
      try {
        const box = selectionBounds(
          [tooth],
          dimensions,
          Math.round(3 / spacing[0]),
        )!;
        const crop = await readCrop(tooth.groupId, box.start, box.shape);
        const { axes, areas } = await compute('toothCheck', {
          scan: crop.scan,
          labels: crop.labels,
          shape: box.shape,
          spacing,
          values: toothValues(tooth),
          crownDirection: crownDirectionFor(tooth, teeth, superiorSign),
        });
        if (axes) {
          const focal = areas.filter((area) => area.kind === 'focal');
          const pulp = areas.some((area) => area.kind === 'pulp-like');
          if (focal.length || !pulp) results.push({ tooth, focal, pulp });
        }
      } catch {
        // A tooth that cannot be read is skipped; the rest still run.
      }
      setDarkCheck({
        done: index + 1,
        total: list.length,
        results: [...results],
      });
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  };

  // Nerve canal tracing ------------------------------------------------------
  const [canals, setCanals] = useState<
    Partial<Record<CanalSide, { centerline: Vec3[]; lengthMm: number }>>
  >({});
  const [canalPick, setCanalPick] = useState<{
    side: CanalSide;
    points: Vec3[];
  } | null>(null);
  const [canalBusy, setCanalBusy] = useState(false);
  const [canalStatus, setCanalStatus] = useState('');
  const [canalDistances, setCanalDistances] = useState<
    Array<{ name: string; distanceMm: number; side: CanalSide }>
  >([]);
  const readBox = async (
    points: Vec3[],
    padMm: number,
  ): Promise<CanalVolumeRead> => {
    const start = [0, 1, 2].map((k) =>
      Math.max(
        0,
        Math.floor(Math.min(...points.map((p) => p[k])) - padMm / spacing[k]),
      ),
    ) as Vec3;
    const end = [0, 1, 2].map((k) =>
      Math.min(
        dimensions[k] - 1,
        Math.ceil(Math.max(...points.map((p) => p[k])) + padMm / spacing[k]),
      ),
    );
    const shape = [0, 1, 2].map((k) => end[k] - start[k] + 1) as Vec3;
    return {
      scan: displayVoxels(await session.region(start, shape), m.volume),
      start,
      shape,
    };
  };
  const traceCanal = async (side: CanalSide, a: Vec3, b: Vec3) => {
    setCanalBusy(true);
    setCanalStatus('Finding the canal…');
    try {
      const snap = async (point: Vec3) =>
        compute('snapCanal', {
          read: await readBox([point], 4),
          point,
          spacing,
          radiusMm: 2,
        });
      const from = await snap(a),
        to = await snap(b);
      setCanalStatus('Following the canal…');
      const { centerline, lengthMm } = await compute('traceCanal', {
        read: await readBox([from, to], 10),
        from,
        to,
        spacing,
      });
      setCanals((current) => ({
        ...current,
        [side]: { centerline, lengthMm },
      }));
      setCanalStatus('Measuring distances to the lower teeth…');
      // Lower-arch teeth: crowns point superiorly.
      const lower = teeth.filter(
        (tooth) =>
          tooth.review !== 'rejected' &&
          crownDirectionFor(tooth, teeth, superiorSign) === superiorSign,
      );
      const labelled = await Promise.all(
        lower.map(async (tooth) => {
          const box = selectionBounds([tooth], dimensions, 1)!;
          return {
            id: tooth.id,
            labels: (await labelRegion(
              tooth.groupId,
              box.start,
              box.shape,
            )) as Uint16Array,
            start: box.start,
            shape: box.shape,
            value: tooth.value,
          };
        }),
      );
      const rows = (
        await compute('canalDistances', {
          centerline,
          radiusMm: 1.25,
          spacing,
          teeth: labelled,
        })
      )
        .sort((x, y) => x.distanceMm - y.distanceMm)
        .slice(0, 4)
        .map((row) => ({
          name: nameOf(teeth.find((tooth) => tooth.id === row.id)!),
          distanceMm: row.distanceMm,
          side,
        }));
      setCanalDistances((current) =>
        [...current.filter((row) => row.side !== side), ...rows].sort(
          (x, y) => x.distanceMm - y.distanceMm,
        ),
      );
      setCanalStatus('');
    } catch (e) {
      setCanalStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setCanalBusy(false);
    }
  };

  // Adding a tooth the model missed -----------------------------------------
  const [addPick, setAddPick] = useState<number | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [addStatus, setAddStatus] = useState('');
  /** Outline the tooth under `seed` (scan voxel); `shown` is its number. */
  const growAt = async (seed: Vec3, shown: number, level: number) => {
    setAddBusy(true);
    setAddStatus('');
    try {
      const fdi = swapSides ? mirrorFdi(shown) : shown;
      // Upper crowns point down (inferior), lower crowns up.
      const crownDirection: 1 | -1 =
        fdiArch(fdi) === 'upper' ? (-superiorSign as 1 | -1) : superiorSign;
      // A box the tooth fits in from a click on its crown: 13 mm across,
      // 12 mm crownward and 27 mm rootward (long canine roots).
      const across = [6.5, 6.5].map((mm, k) => Math.round(mm / spacing[k]));
      const crownward = Math.round(12 / spacing[2]),
        rootward = Math.round(27 / spacing[2]);
      const zLo = crownDirection > 0 ? seed[2] - rootward : seed[2] - crownward,
        zHi = crownDirection > 0 ? seed[2] + crownward : seed[2] + rootward;
      const lo = [seed[0] - across[0], seed[1] - across[1], zLo],
        hi = [seed[0] + across[0], seed[1] + across[1], zHi];
      const start = [0, 1, 2].map((k) => Math.max(0, lo[k])) as Vec3;
      const shape = [0, 1, 2].map(
        (k) => Math.min(dimensions[k] - 1, hi[k]) - start[k] + 1,
      ) as Vec3;
      const scan = displayVoxels(await session.region(start, shape), m.volume);
      // Other teeth's voxels are off limits.
      const taken = new Uint8Array(scan.length);
      const others = rawTeeth.filter(
        (tooth) => tooth.review !== 'rejected' && tooth.id !== draftTooth?.id,
      );
      for (const groupId of new Set(others.map((tooth) => tooth.groupId))) {
        const values = new Set(
          others
            .filter((tooth) => tooth.groupId === groupId)
            .flatMap(toothValues),
        );
        const labels =
          groupId === ADDED_GROUP
            ? addedTeethRegion(addedTeeth, addedMasks, start, shape)
            : await labelRegion(groupId, start, shape);
        for (let i = 0; i < labels.length; i++)
          if (labels[i] && values.has(labels[i])) taken[i] = 1;
      }
      const grown = await compute('growTooth', {
        scan,
        taken,
        shape,
        spacing,
        seed: [seed[0] - start[0], seed[1] - start[1], seed[2] - start[2]],
        level,
        crownDirection,
      });
      if (!grown) {
        setAddStatus('No tooth found there. Click on the crown of the tooth.');
        return;
      }
      // Keep only the outline's own box.
      const size = [0, 1, 2].map(
        (k) => grown.max[k] - grown.min[k] + 1,
      ) as Vec3;
      const mask = new Uint8Array(size[0] * size[1] * size[2]);
      for (let z = 0; z < size[2]; z++)
        for (let y = 0; y < size[1]; y++)
          for (let x = 0; x < size[0]; x++)
            mask[(z * size[1] + y) * size[0] + x] =
              grown.mask[
                ((z + grown.min[2]) * shape[1] + y + grown.min[1]) * shape[0] +
                  x +
                  grown.min[0]
              ];
      const toScan = (v: Vec3) => v.map((c, k) => c + start[k]) as Vec3;
      setDraftTooth({
        id: draftTooth?.id ?? `added-${fdi ?? 0}-${seed.join('-')}`,
        fdi,
        start: toScan(grown.min),
        shape: size,
        runs: encodeMask(mask),
        voxels: grown.voxels,
        centroid: toScan(grown.centroid),
        bounds: { min: toScan(grown.min), max: toScan(grown.max) },
        seed,
        level,
        leaked: grown.leaked,
      });
    } catch (e) {
      setAddStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setAddBusy(false);
    }
  };
  const keepDraft = () => {
    if (!draftTooth) return;
    const { seed, level, leaked, ...tooth } = draftTooth;
    void seed;
    void level;
    void leaked;
    setAddedTeeth((current) => [...current, tooth]);
    setDraftTooth(null);
    setSelectedIds([tooth.id]);
    setFocusId(tooth.id);
    setAddStatus(
      `${numberName(swapSides ? mirrorFdi(tooth.fdi) : tooth.fdi)} added. Saved on this device.`,
    );
  };
  const presentNumbers = new Set(
    teeth
      .filter((tooth) => tooth.review !== 'rejected' && tooth.id !== draftTooth?.id)
      .map((tooth) => shownFdi(tooth)),
  );
  const missingNumbers = [1, 2, 3, 4].flatMap((q) =>
    [1, 2, 3, 4, 5, 6, 7, 8]
      .map((n) => q * 10 + n)
      .filter((fdi) => !presentNumbers.has(fdi)),
  );
  const addToothSection = () =>
    section(
    'Add a missing tooth',
    <AddToothPanel
      fdiChoices={missingNumbers}
      picking={addPick}
      busy={addBusy}
      status={addStatus || editsNote}
      draft={
        draftTooth
          ? {
              fdi: swapSides ? mirrorFdi(draftTooth.fdi) : draftTooth.fdi,
              volumeMm3:
                draftTooth.voxels * spacing[0] * spacing[1] * spacing[2],
              leaked: draftTooth.leaked,
            }
          : null
      }
      added={addedTeeth.map((tooth) => ({
        id: tooth.id,
        name: numberName(swapSides ? mirrorFdi(tooth.fdi) : tooth.fdi),
      }))}
      onStart={(fdi) => {
        setCanalPick(null);
        setAddStatus('');
        setAddPick(fdi);
      }}
      onCancel={() => setAddPick(null)}
      onKeep={keepDraft}
      onAdjust={(direction) => {
        if (!draftTooth) return;
        const level = Math.min(
          0.85,
          Math.max(0.2, draftTooth.level - direction * 0.08),
        );
        void growAt(
          draftTooth.seed,
          (swapSides ? mirrorFdi(draftTooth.fdi) : draftTooth.fdi) ?? 11,
          level,
        );
      }}
      onDiscard={() => setDraftTooth(null)}
      onRemove={(id) => {
        setAddedTeeth((current) => current.filter((tooth) => tooth.id !== id));
        setSelectedIds((current) => current.filter((item) => item !== id));
      }}
    />,
  );

  // Case report (with a QR code for the share link) ----------------------------
  const openReport = () => {
    const reportWindow = window.open('', '_blank');
    const snapshots = Object.values(VolumeAxis).flatMap((a) => {
      const base = document.querySelector<HTMLCanvasElement>(
        `canvas[data-slice-canvas="${a}"]`,
      );
      if (!base || !base.width) return [];
      const canvas = document.createElement('canvas');
      canvas.width = base.width;
      canvas.height = base.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return [];
      ctx.drawImage(base, 0, 0);
      const overlay = document.querySelector<HTMLCanvasElement>(
        `canvas[data-slice-overlay="${a}"]`,
      );
      if (overlay?.width)
        ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
      return [
        {
          label: t(`dental.views.${a}`),
          dataUrl: canvas.toDataURL('image/png'),
        },
      ];
    });
    const html = buildDentalReportHtml({
      title: `${t('dental.report.title')} — ${m.name}`,
      generatedAt: new Date(),
      scan: {
        id: m.name,
        format: m.source.formatLabel,
        dimensions: `${dimensions.join(' × ')} voxels`,
        voxelSize: formatSpacing(spacing),
      },
      snapshots,
      measurements: measurements.map((item) => ({
        name: item.record.name,
        value: item.shape.label ?? '',
        plane: t(`dental.views.${item.axis}`),
        slice: String(item.index + 1),
      })),
      findings: (darkCheck?.results ?? []).map(({ tooth, focal, pulp }) => ({
        fdi: shownFdi(tooth) ?? 0,
        tooth: nameOf(tooth),
        conditions: [
          ...focal.map(
            (area) =>
              `Dark area ${area.volumeMm3.toFixed(1)} mm³ reaching the surface (automatic check)`,
          ),
          ...(pulp ? [] : ['No pulp canal visible (automatic check)']),
        ].join('; '),
        note: 'Unvalidated automatic finding — confirm with a dental X-ray.',
        bookmarked: false,
      })),
      caseNotes: caseState?.caseNotes ?? '',
      disclaimer: t('dental.report.disclaimer'),
      shareUrl: shareLink ?? undefined,
      labels: {
        scan: t('dental.report.scan'),
        format: t('dental.report.format'),
        dimensions: t('dental.report.dimensions'),
        voxelSize: t('dental.report.voxelSize'),
        generated: t('dental.report.generated'),
        views: t('dental.report.views'),
        measurements: t('dental.report.measurements'),
        measurementName: t('dental.report.name'),
        measurementValue: t('dental.report.value'),
        measurementPlane: t('dental.report.plane'),
        measurementSlice: t('dental.report.slice'),
        noMeasurements: t('dental.report.noMeasurements'),
        toothChart: t('dental.report.toothChart'),
        tooth: t('dental.report.tooth'),
        findings: t('dental.report.findings'),
        note: t('dental.report.note'),
        noFindings: t('dental.report.noFindings'),
        caseNotes: t('dental.report.caseNotes'),
        print: t('dental.report.print'),
      },
    });
    const blob = new Blob([html], { type: 'text/html' });
    if (reportWindow) {
      reportWindow.location.href = URL.createObjectURL(blob);
      return;
    }
    downloadText(html, `${m.name}-report.html`, 'text/html');
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

  const baseOverlays =
    pending || analysisResult?.key !== analysisKey
      ? undefined
      : analysisResult.overlays;
  // Canal marks and the intraoral outline drawn over the label overlays
  // (cheap when there are none: the overlays pass through unchanged).
  const shownOverlays = (() => {
    const out: Partial<Record<VolumeAxis, SliceImage | null>> = {
      ...(baseOverlays ?? {}),
    };
    const lines = Object.values(canals).filter(
      (line): line is { centerline: Vec3[]; lengthMm: number } => Boolean(line),
    );
    for (const a of Object.values(VolumeAxis)) {
      const size = overlaySize(a, dimensions);
      const index = cursor[indexKey(a)];
      let image = out[a];
      for (const line of lines)
        image = drawCanalMarks(
          image,
          size,
          canalSliceMarks(line.centerline, 1.25, a, index, dimensions, spacing),
        );
      const picked = (canalPick?.points ?? []).filter(
        (p) =>
          Math.abs(
            p[a === VolumeAxis.Axial ? 2 : a === VolumeAxis.Coronal ? 1 : 0] -
              index,
          ) <= 2,
      );
      if (picked.length)
        image = drawDots(
          image,
          size,
          picked.flatMap((p) => {
            const c = voxelToAxisPoint(a, p, dimensions);
            const d = 3 / Math.max(size.width, size.height);
            return [-1, 0, 1].flatMap((dx) =>
              [-1, 0, 1].map((dy) => ({
                xRatio: c.xRatio + dx * d,
                yRatio: c.yRatio + dy * d,
              })),
            );
          }),
          '#f472b6',
        );
      if (iosFit && iosShow) {
        const k = a === VolumeAxis.Axial ? 2 : a === VolumeAxis.Coronal ? 1 : 0;
        image = drawDots(
          image,
          size,
          meshPointsNearSlice(iosFit.crowns.positions, spacing, k, index).map(
            (v) => voxelToAxisPoint(a, v, dimensions),
          ),
          '#22d3ee',
        );
      }
      if (image) out[a] = image;
    }
    return out;
  })();

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
          flushTop
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
      overlays={shownOverlays}
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
    <section className="space-y-2 border-b border-slate-800 px-3 py-2.5">
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
          {splits.length ? (
            <div className="rounded border border-amber-400/40 bg-amber-950/30 p-2 text-xs text-amber-100">
              <p>
                {splits.length === 1
                  ? 'One tooth looks'
                  : `${splits.length} teeth look`}{' '}
                cut in two by the model (the parts share a large surface):
              </p>
              <ul className="mt-1 space-y-0.5">
                {splits.map(({ a, b, sharedMm2 }) => {
                  const merged = mergedPairs.some(
                    ([x, y]) =>
                      (x === a.id && y === b.id) || (x === b.id && y === a.id),
                  );
                  return (
                    <li
                      key={`${a.id}-${b.id}`}
                      className="flex items-center gap-2"
                    >
                      <span className="flex-1">
                        {toothLabel({ ...a, fdi: shownFdi(a) })} +{' '}
                        {toothLabel({ ...b, fdi: shownFdi(b) })} ·{' '}
                        {Math.round(sharedMm2)} mm² shared
                      </span>
                      <button
                        type="button"
                        className="underline"
                        onClick={() =>
                          setMergedPairs((current) =>
                            merged
                              ? current.filter(
                                  ([x, y]) =>
                                    !(
                                      (x === a.id && y === b.id) ||
                                      (x === b.id && y === a.id)
                                    ),
                                )
                              : [...current, [a.id, b.id]],
                          )
                        }
                      >
                        {merged ? 'Keep apart' : 'Treat as one'}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {splits.some(
                ({ a, b }) =>
                  !mergedPairs.some(
                    ([x, y]) =>
                      (x === a.id && y === b.id) || (x === b.id && y === a.id),
                  ),
              ) ? (
                <button
                  type="button"
                  className="mt-1 underline"
                  onClick={() =>
                    setMergedPairs(splits.map(({ a, b }) => [a.id, b.id]))
                  }
                >
                  Treat all as one tooth
                </button>
              ) : null}
              <p className="mt-1 text-amber-100/80">
                Saved on this device and carried in share links.
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
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-700 hover:bg-slate-800"
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
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-700 hover:bg-slate-800"
              onClick={() => stepTooth(1)}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {focus ? (
            <button
              type="button"
              onClick={() => setFocusTooth(focus)}
              className="inline-flex min-h-8 [@media(pointer:coarse)]:min-h-9 w-full items-center justify-center gap-1.5 rounded border border-sky-500/60 bg-sky-500/15 px-2.5 text-xs text-sky-50 hover:bg-sky-500/25"
            >
              <Focus className="h-3.5 w-3.5" aria-hidden="true" />
              Focus on {nameOf(focus)}
            </button>
          ) : null}
          <label className="flex min-h-8 items-center gap-2 text-xs text-slate-300">
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
            className="inline-flex min-h-8 [@media(pointer:coarse)]:min-h-9 w-full items-center justify-center rounded border border-slate-600 bg-slate-800 px-2.5 text-xs hover:bg-slate-700 disabled:opacity-50"
          >
            {fullLoading ? t('streaming.loadingFull') : 'Review and edit teeth'}
          </button>
        </>,
      )}
      {addToothSection()}
      {section(
        'Show',
        <>
          <ToothShowControl
            mode={showMode}
            hasSelection={selectedIds.length > 0}
            onChange={setShowMode}
          />
          <label className="flex min-h-8 items-center gap-2 text-xs text-slate-300">
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
      {section(
        'Intraoral scan',
        <div className="space-y-1.5 text-xs text-slate-300">
          <label className="inline-flex min-h-8 [@media(pointer:coarse)]:min-h-9 w-full cursor-pointer items-center justify-center rounded border border-slate-600 bg-slate-800 px-2.5 hover:bg-slate-700">
            {iosBusy
              ? 'Aligning…'
              : `Import STL / PLY / OBJ and align to ${selectedTeeth.length ? `${selectedTeeth.length} selected` : 'all'} teeth`}
            <input
              type="file"
              aria-label="Import intraoral scan"
              accept=".stl,.ply,.obj"
              className="sr-only"
              disabled={iosBusy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importIntraoral(file);
                e.target.value = '';
              }}
            />
          </label>
          {iosStatus ? <p role="status">{iosStatus}</p> : null}
          {iosFit ? (
            <div className="space-y-1 rounded border border-cyan-500/40 bg-cyan-950/30 p-2 text-cyan-50">
              <p>
                {iosName}: aligned with RMS {iosFit.rms.toFixed(2)} mm;{' '}
                {Math.round(iosFit.inlierRatio * 100)}% of its points sit on the
                CBCT. CBCT crowns are {iosFit.deviation.mean.toFixed(2)} mm from
                it on average (95% within {iosFit.deviation.p95.toFixed(2)} mm).
              </p>
              {iosFit.rms > 0.3 || iosFit.inlierRatio < 0.3 ? (
                <p className="text-amber-200">
                  The fit looks poor: check that the scan covers the selected
                  teeth and the same jaw.
                </p>
              ) : null}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-cyan-400"
                  checked={iosShow}
                  onChange={(e) => setIosShow(e.target.checked)}
                />
                Show its outline on the slices (cyan)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-cyan-400"
                  checked={iosUse}
                  onChange={(e) => setIosUse(e.target.checked)}
                />
                Add its crowns to the STL export
              </label>
            </div>
          ) : null}
          <p className="text-[10px] leading-snug text-slate-400">
            An intraoral scan from a dentist or orthodontist is about five times
            more exact on the crowns than CBCT. Aligning it to the CBCT lets the
            exported model use scanned crowns on CBCT roots. Select the teeth
            the scan covers first.
          </p>
        </div>,
      )}
      {section(
        'Check teeth',
        <div className="space-y-1.5 text-xs text-slate-300">
          <button
            type="button"
            disabled={Boolean(darkCheck && darkCheck.done < darkCheck.total)}
            onClick={() => void checkAllTeeth()}
            className="inline-flex min-h-8 [@media(pointer:coarse)]:min-h-9 w-full items-center justify-center rounded border border-slate-600 bg-slate-800 px-2.5 text-xs hover:bg-slate-700 disabled:opacity-50"
          >
            {darkCheck && darkCheck.done < darkCheck.total
              ? `Checking tooth ${darkCheck.done + 1} of ${darkCheck.total}…`
              : 'Look for dark areas in every tooth'}
          </button>
          {darkCheck && darkCheck.done === darkCheck.total ? (
            darkCheck.results.length ? (
              <ul className="space-y-1">
                {darkCheck.results.map(({ tooth, focal, pulp }) => (
                  <li
                    key={tooth.id}
                    className="rounded border border-amber-400/40 bg-amber-950/30 p-1.5 text-amber-100"
                  >
                    <strong>{nameOf(tooth)}</strong>
                    {focal.map((area, index) => (
                      <span key={index} className="block">
                        Dark area {area.volumeMm3.toFixed(1)} mm³{' '}
                        {area.alongTooth < 0.25
                          ? 'in the crown'
                          : area.alongTooth < 0.5
                            ? 'at the neck'
                            : 'on the root'}
                        , reaching the surface.
                      </span>
                    ))}
                    {pulp ? null : (
                      <span className="block">No pulp canal visible.</span>
                    )}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        selectTooth(tooth.id, false);
                        setFocusTooth(tooth);
                      }}
                    >
                      Focus on it
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                No compact dark areas found; every tooth shows a pulp canal.
              </p>
            )
          ) : null}
          <p className="text-[10px] leading-snug text-slate-400">
            Flags compact dark areas reaching a tooth surface (possible decay,
            resorption or a low-density filling) and teeth with no visible pulp
            canal. Automatic and unvalidated; a dentist needs an X-ray to tell.
          </p>
        </div>,
      )}
      <details className="border-b border-slate-800 px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Layers
        </summary>
        <div className="pt-2">
          <LayerList
            rows={teeth.map((tooth) => ({
              tooth,
              name: nameOf(tooth),
              color:
                toothColors[tooth.id] ??
                caseState?.segmentGroups
                  .find((g) => g.id === tooth.groupId)
                  ?.segments.find((seg) => seg.value === tooth.value)?.color ??
                '#94a3b8',
            }))}
            hidden={hiddenTeeth}
            opacity={outlineOpacity}
            onToggle={(id) =>
              setHiddenTeeth((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onShowAll={(visible) =>
              setHiddenTeeth(
                visible ? new Set() : new Set(teeth.map((tooth) => tooth.id)),
              )
            }
            onColor={(id, color) =>
              setToothColors((current) => ({ ...current, [id]: color }))
            }
            onOpacity={setOutlineOpacity}
          />
        </div>
      </details>
      {section(
        'Nerve canal',
        <CanalPanel
          traced={{
            right: canals.right?.lengthMm ?? null,
            left: canals.left?.lengthMm ?? null,
          }}
          picking={canalPick?.side ?? null}
          pickedPoints={canalPick?.points.length ?? 0}
          busy={canalBusy}
          status={canalStatus}
          distances={canalDistances}
          onPick={(side) => {
            setCanalPick({ side, points: [] });
            setTool('crosshair');
            if (compact) setSheet(null);
          }}
          onCancel={() => setCanalPick(null)}
          onClear={(side) => {
            setCanals((current) => ({ ...current, [side]: undefined }));
            setCanalDistances((current) =>
              current.filter((row) => row.side !== side),
            );
          }}
        />,
      )}
    </>
  ) : (
    <>
      {section(
        'Teeth',
        <p className="text-xs text-slate-400">
          This scan has no tooth outlines yet. Add teeth one by one below, or
          open the full editor to propose them with a model.
        </p>,
      )}
      {addToothSection()}
    </>
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
          className="inline-flex min-h-8 [@media(pointer:coarse)]:min-h-9 w-full items-center justify-center gap-2 rounded border border-slate-600 bg-slate-800 px-2.5 text-xs hover:bg-slate-700"
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
      className="inline-flex min-h-8 [@media(pointer:coarse)]:min-h-9 w-full items-center justify-center gap-2 rounded border border-slate-600 bg-slate-800 px-2.5 text-xs hover:bg-slate-700 disabled:opacity-50"
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
        className="inline-flex min-h-8 [@media(pointer:coarse)]:min-h-9 w-full items-center justify-center gap-2 rounded border border-slate-700 px-2.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
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

  const focusModal = focusTooth ? (
    <ErrorBoundary area="tooth focus" inline>
      <ToothFocusView
        key={focusTooth.id}
        tooth={teeth.find((tooth) => tooth.id === focusTooth.id) ?? focusTooth}
        name={nameOf(focusTooth)}
        allTeeth={teeth}
        dims={dimensions}
        spacing={spacing}
        superiorSign={superiorSign}
        read={readCrop}
        windowLevel={wl}
        onClose={() => setFocusTooth(null)}
        onJump={(voxel) => setCursor({ x: voxel[0], y: voxel[1], z: voxel[2] })}
      />
    </ErrorBoundary>
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
          onReport={openReport}
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
        {focusModal}
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
            <div className="px-3 pb-2">
              <MobileActionButton
                icon={<FileText className="h-5 w-5" aria-hidden="true" />}
                label={t('dental.toolbar.report')}
                onClick={openReport}
              />
            </div>
            {sharePanel}
            {scanPanel}
          </div>
        </BottomSheet>
      ) : null}
      {focusModal}
    </main>
  );
}
