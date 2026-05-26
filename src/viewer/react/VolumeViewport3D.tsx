import {
  Camera,
  Grid3x3,
  PanelBottomClose,
  PanelBottomOpen,
  PanelRightClose,
  PanelRightOpen,
  Ratio,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  createThreePreview,
  type ThreePreviewInstance,
  type VolumeColormap,
  type VolumeRenderOptions,
  type SurfaceMeshPreview,
  type VolumeViewPreset,
} from '../core';
import type { PreparedVolumeFor3D, VolumeCursor } from '../../types';
import { cn } from '../../utils/cn';
import { Button } from '../../components/Button';
import { RangeField } from '../../components/RangeField';
import { Select } from '../../components/Select';
import {
  defaultVolumeViewport3DLabels,
  type VolumeViewport3DLabels,
} from '../labels';

const VIEW_PRESETS: { id: VolumeViewPreset; label: string }[] = [
  { id: 'front', label: 'F' },
  { id: 'back', label: 'Bk' },
  { id: 'left', label: 'L' },
  { id: 'right', label: 'R' },
  { id: 'top', label: 'T' },
  { id: 'bottom', label: 'Bo' },
];

const RENDER_PRESETS: Record<string, Partial<VolumeRenderOptions>> = {
  default: { renderStyle: 'mip', threshold: 0.5, opacity: 1, climLow: 0, climHigh: 1 },
  bone: { renderStyle: 'iso', threshold: 0.38, opacity: 1, climLow: 0, climHigh: 1 },
  soft: { renderStyle: 'mip', threshold: 0.5, opacity: 0.65, climLow: 0.05, climHigh: 0.6 },
  xray: { renderStyle: 'mip', threshold: 0.5, opacity: 0.35, climLow: 0, climHigh: 1 },
};

interface VolumeViewport3DProps {
  volume: PreparedVolumeFor3D | null;
  axisViewsVisible?: boolean;
  onAxisViewsVisibleChange?: (visible: boolean) => void;
  sidebarVisible?: boolean;
  onSidebarVisibleChange?: (visible: boolean) => void;
  onDownsampledChange?: (downsampled: boolean) => void;
  /** User-facing strings (English defaults otherwise). */
  labels?: VolumeViewport3DLabels;
  /** Extra classes merged onto the root element. */
  className?: string;
  surfaces?: SurfaceMeshPreview[];
}

export interface VolumeViewport3DHandle {
  focusCursor: (cursor: VolumeCursor | null) => void;
}

// Cursor is delivered imperatively (not as a prop) and the component is
// memoized, so scrubbing the crosshair never re-renders this viewport. That
// keeps React from re-serializing the large prepared-volume prop on every
// move (a severe dev-mode slowdown) and avoids needless work.
export const VolumeViewport3D = memo(
  forwardRef<VolumeViewport3DHandle, VolumeViewport3DProps>(
    function VolumeViewport3D(
      {
        volume,
        axisViewsVisible = true,
        onAxisViewsVisibleChange,
        sidebarVisible = true,
        onSidebarVisibleChange,
        onDownsampledChange,
        labels = defaultVolumeViewport3DLabels,
        className,
        surfaces = [],
      },
      ref,
    ) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<ThreePreviewInstance | null>(null);
  const cursorRef = useRef<VolumeCursor | null>(null);
  const [error, setError] = useState(false);
  const [planesVisible, setPlanesVisible] = useState(true);
  const planesVisibleRef = useRef(planesVisible);
  const [panelOpen, setPanelOpen] = useState(false);
  const [preset, setPreset] = useState('default');
  const [threshold, setThreshold] = useState(0.5);
  const [opacity, setOpacity] = useState(1);
  const [colormap, setColormap] = useState<VolumeColormap>('grayscale');
  const [gridVisible, setGridVisible] = useState(false);
  const gridVisibleRef = useRef(gridVisible);
  const surfacesRef = useRef<SurfaceMeshPreview[]>(surfaces);
  const renderOptsRef = useRef<Partial<VolumeRenderOptions>>(
    RENDER_PRESETS.default,
  );

  const applyRender = (partial: Partial<VolumeRenderOptions>) => {
    renderOptsRef.current = { ...renderOptsRef.current, ...partial };
    instanceRef.current?.setRenderOptions(partial);
  };

  const applyPreset = (key: string) => {
    const next = RENDER_PRESETS[key] ?? RENDER_PRESETS.default;
    setPreset(key);
    setThreshold(next.threshold ?? 0.5);
    setOpacity(next.opacity ?? 1);
    applyRender(next);
  };

  const downloadSnapshot = () => {
    const url = instanceRef.current?.snapshot();
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cbcter-3d.png';
    link.click();
  };

  useImperativeHandle(ref, () => ({
    focusCursor: (cursor) => {
      cursorRef.current = cursor;
      instanceRef.current?.focusCursor(cursor);
    },
  }), []);

  useEffect(() => {
    planesVisibleRef.current = planesVisible;
    instanceRef.current?.setPlanesVisible(planesVisible);
  }, [planesVisible]);

  useEffect(() => {
    gridVisibleRef.current = gridVisible;
    instanceRef.current?.setGridVisible(gridVisible);
  }, [gridVisible]);

  useEffect(() => {
    surfacesRef.current = surfaces;
    instanceRef.current?.setSurfaceMeshes(surfaces);
  }, [surfaces]);

  useEffect(() => {
    onDownsampledChange?.(Boolean(volume?.downsampled));
  }, [onDownsampledChange, volume?.downsampled]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !volume) {
      setError(false);
      return undefined;
    }

    let cleanup: () => void = () => {};
    let cancelled = false;
    let mounted = false;
    let frame = 0;
    let retryTimer = 0;
    let retryCount = 0;
    let resizeObserver: ResizeObserver | null = null;
    setError(false);

    const scheduleRetry = () => {
      if (cancelled || mounted || retryCount >= 4) return;
      retryCount += 1;
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => {
        mount();
        if (!mounted) scheduleRetry();
      }, 120 * retryCount);
    };

    const mount = () => {
      if (cancelled || mounted) return;
      if (host.clientWidth < 32 || host.clientHeight < 32) return;
      mounted = true;
      resizeObserver?.disconnect();
      resizeObserver = null;

      void createThreePreview(host, volume)
        .then((instance) => {
          if (cancelled) {
            instance.dispose();
            return;
          }

          instanceRef.current = instance;
          instance.focusCursor(cursorRef.current);
          instance.setPlanesVisible(planesVisibleRef.current);
          instance.setGridVisible(gridVisibleRef.current);
          instance.setSurfaceMeshes(surfacesRef.current);
          instance.setRenderOptions(renderOptsRef.current);
          cleanup = instance.dispose;
        })
        .catch(() => {
          if (cancelled) return;
          mounted = false;
          if (retryCount < 4) {
            scheduleRetry();
            return;
          }
          setError(true);
        });
    };

    frame = window.requestAnimationFrame(() => {
      mount();
      if (mounted || cancelled) return;

      resizeObserver = new ResizeObserver(() => {
        mount();
      });
      resizeObserver.observe(host);
      scheduleRetry();
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retryTimer);
      resizeObserver?.disconnect();
      instanceRef.current = null;
      cleanup();
    };
  }, [volume]);

  return (
    <div
      className={cn(
        'relative h-full min-h-0 overflow-hidden bg-black',
        className,
      )}
    >
      <div
        ref={hostRef}
        className="absolute inset-0 h-full min-h-0 overflow-hidden"
      />
      <div className="absolute inset-0 z-20 pointer-events-none">
        <div className="pointer-events-auto absolute left-2 top-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-0.5 rounded-lg bg-slate-950/70 p-1 ring-1 ring-white/10">
            {VIEW_PRESETS.map((view) => (
              <button
                key={view.id}
                type="button"
                title={view.id}
                onClick={() => instanceRef.current?.setView(view.id)}
                className="rounded px-1.5 py-1 text-[11px] font-medium text-slate-200 transition hover:bg-slate-800"
              >
                {view.label}
              </button>
            ))}
            <button
              type="button"
              title={labels.resetView}
              onClick={() => instanceRef.current?.resetView()}
              className="rounded px-1.5 py-1 text-slate-300 transition hover:bg-slate-800"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="overlay"
              size="sm"
              onClick={() => setPanelOpen((open) => !open)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              {labels.render}
            </Button>
            <Button variant="overlay" size="sm" onClick={downloadSnapshot}>
              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              {labels.snapshot}
            </Button>
          </div>
          {panelOpen ? (
            <div className="w-56 space-y-2.5 rounded-lg bg-slate-950/85 p-2.5 ring-1 ring-white/10">
              <Select
                size="sm"
                block
                value={preset}
                onChange={applyPreset}
                options={[
                  { value: 'default', label: labels.presets.default },
                  { value: 'bone', label: labels.presets.bone },
                  { value: 'soft', label: labels.presets.soft },
                  { value: 'xray', label: labels.presets.xray },
                ]}
              />
              <RangeField
                label={labels.threshold}
                min={2}
                max={98}
                value={Math.round(threshold * 100)}
                onChange={(value) => {
                  setThreshold(value / 100);
                  applyRender({ threshold: value / 100 });
                }}
              />
              <RangeField
                label={labels.opacity}
                min={5}
                max={100}
                value={Math.round(opacity * 100)}
                onChange={(value) => {
                  setOpacity(value / 100);
                  applyRender({ opacity: value / 100 });
                }}
              />
              <label className="block">
                <span className="mb-1 block text-xs text-slate-400">
                  {labels.colormap}
                </span>
                <Select
                  size="sm"
                  block
                  value={colormap}
                  onChange={(value) => {
                    const next = value as VolumeColormap;
                    setColormap(next);
                    applyRender({ colormap: next });
                  }}
                  options={[
                    { value: 'grayscale', label: labels.colormaps.grayscale },
                    { value: 'bone', label: labels.colormaps.bone },
                    { value: 'hot', label: labels.colormaps.hot },
                    { value: 'viridis', label: labels.colormaps.viridis },
                  ]}
                />
              </label>
              <button
                type="button"
                onClick={() => setGridVisible((visible) => !visible)}
                className={cn(
                  'flex w-full items-center justify-between rounded border px-2.5 py-1.5 text-xs transition',
                  gridVisible
                    ? 'border-sky-500 bg-sky-500/10 text-sky-200'
                    : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800',
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Grid3x3 className="h-3.5 w-3.5" aria-hidden="true" />
                  {labels.grid}
                </span>
              </button>
            </div>
          ) : null}
        </div>
        <div className="pointer-events-auto absolute inset-x-2 bottom-2 flex flex-wrap items-center justify-center gap-1 sm:inset-x-auto sm:right-2 sm:justify-end">
          <Button
            variant="overlay"
            size="sm"
            className="min-w-0 flex-1 sm:flex-none"
            onClick={() => onAxisViewsVisibleChange?.(!axisViewsVisible)}
          >
            {axisViewsVisible ? (
              <PanelBottomClose className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <PanelBottomOpen className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span className="sm:hidden">
              {axisViewsVisible
                ? labels.axisViews.hideShort
                : labels.axisViews.showShort}
            </span>
            <span className="hidden sm:inline">
              {axisViewsVisible
                ? labels.axisViews.hideLong
                : labels.axisViews.showLong}
            </span>
          </Button>
          <Button
            variant="overlay"
            size="sm"
            className="min-w-0 flex-1 sm:flex-none"
            onClick={() => onSidebarVisibleChange?.(!sidebarVisible)}
          >
            {sidebarVisible ? (
              <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <PanelRightOpen className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span className="sm:hidden">
              {sidebarVisible
                ? labels.sidebar.hideShort
                : labels.sidebar.showShort}
            </span>
            <span className="hidden sm:inline">
              {sidebarVisible
                ? labels.sidebar.hideLong
                : labels.sidebar.showLong}
            </span>
          </Button>
          <Button
            variant="overlay"
            size="sm"
            className="min-w-0 flex-1 sm:flex-none"
            onClick={() => setPlanesVisible((current) => !current)}
          >
            <Ratio className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sm:hidden">
              {planesVisible
                ? labels.planes.hideShort
                : labels.planes.showShort}
            </span>
            <span className="hidden sm:inline">
              {planesVisible
                ? labels.planes.hideLong
                : labels.planes.showLong}
            </span>
          </Button>
        </div>
      </div>
      {error ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/85 px-4 text-center text-xs text-slate-400">
          {labels.previewError}
        </div>
      ) : null}
    </div>
  );
    },
  ),
);
