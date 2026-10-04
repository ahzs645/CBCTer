import { Circle, Download, Pentagon, Ruler, Triangle, X } from 'lucide-react';
import { type PointerEvent, useState } from 'react';
import {
  ellipseArea,
  polygonArea,
  type Vec2,
} from '../../lib/measurements/geometry';
import type { SliceImage } from '../../types';
import { cn } from '../../utils/cn';
import { defaultMeasurementLabels, type MeasurementLabels } from '../labels';

export type MeasureMode = 'off' | 'distance' | 'angle' | 'ellipse' | 'polygon';
interface MeasurePoint {
  xRatio: number;
  yRatio: number;
}

/** A finished measurement drawn persistently on the slice it belongs to. */
export interface SliceMeasurementShape {
  id: string;
  kind: Exclude<MeasureMode, 'off'>;
  points: MeasurePoint[];
  label: string;
  selected?: boolean;
}

export interface CompletedSliceMeasurement {
  kind: Exclude<MeasureMode, 'off'>;
  points: MeasurePoint[];
  value: number;
  unit: 'mm' | 'degrees' | 'mm2';
  densityRoi?: {
    kind: 'ellipse' | 'polygon';
    points: MeasurePoint[];
  };
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface MeasurementOverlayProps {
  image: SliceImage | null;
  imageRect: Rect;
  /** In-plane mm per image pixel [x, y]. */
  mmPerPixel: { x: number; y: number };
  /** Filename used for the per-pane PNG export. */
  exportName: string;
  getCanvas: () => HTMLCanvasElement | null;
  labels?: MeasurementLabels;
  onMeasurementComplete?: (measurement: CompletedSliceMeasurement) => void;
  /**
   * Controlled tool mode. When set, the host app owns tool selection (e.g. a
   * global toolbar) and the per-pane tool buttons are hidden.
   */
  mode?: MeasureMode;
  /** Saved measurements on this slice, drawn on top of the image. */
  shapes?: SliceMeasurementShape[];
}

const SAVED_COLOR = '#fbbf24';
const SELECTED_COLOR = '#f8fafc';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Educational distance/angle measurement + per-pane PNG export, layered over
 * a SliceCanvas. When a measure mode is active it renders its own
 * pointer-capturing surface so clicks place points instead of scrubbing —
 * keeping all measurement concerns out of the canvas interaction code.
 *
 * Reference only — not for diagnosis, treatment planning, or implant work.
 */
export function MeasurementOverlay({
  image,
  imageRect,
  mmPerPixel,
  exportName,
  getCanvas,
  labels = defaultMeasurementLabels,
  onMeasurementComplete,
  mode: controlledMode,
  shapes = [],
}: MeasurementOverlayProps) {
  const [uncontrolledMode, setMode] = useState<MeasureMode>('off');
  const [points, setPoints] = useState<MeasurePoint[]>([]);
  const controlled = controlledMode !== undefined;
  const mode = controlledMode ?? uncontrolledMode;
  // Drop a half-placed measurement when the host switches tools.
  const [trackedMode, setTrackedMode] = useState(mode);
  if (trackedMode !== mode) {
    setTrackedMode(mode);
    setPoints([]);
  }

  const toggleMode = (next: MeasureMode) => {
    setMode((current) => (current === next ? 'off' : next));
    setPoints([]);
  };

  const placePoint = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const point: MeasurePoint = {
      xRatio: clamp((localX - imageRect.left) / Math.max(1, imageRect.width), 0, 1),
      yRatio: clamp((localY - imageRect.top) / Math.max(1, imageRect.height), 0, 1),
    };
    const max = mode === 'angle' ? 3 : mode === 'polygon' ? 4 : 2;
    // Computed outside the state updater: React may invoke updaters twice
    // (StrictMode), which would otherwise record each measurement twice.
    {
      const prev = points;
      const next = prev.length >= max ? [point] : [...prev, point];
      const complete = next.length === max;
      if (mode === 'distance' && next.length === 2) {
        onMeasurementComplete?.({
          kind: 'distance',
          points: next,
          value: mmBetween(next[0], next[1]),
          unit: 'mm',
        });
      }
      if (mode === 'angle' && next.length === 3) {
        onMeasurementComplete?.({
          kind: 'angle',
          points: next,
          value: angleAt(next[0], next[1], next[2]),
          unit: 'degrees',
        });
      }
      if (mode === 'ellipse' && next.length === 2) {
        onMeasurementComplete?.({
          kind: 'ellipse',
          points: next,
          value: ellipseArea(
            (Math.abs(next[1].xRatio - next[0].xRatio) * spanX * mmPerPixel.x) /
              2,
            (Math.abs(next[1].yRatio - next[0].yRatio) * spanY * mmPerPixel.y) /
              2,
          ),
          unit: 'mm2',
          densityRoi: { kind: 'ellipse', points: next },
        });
      }
      if (mode === 'polygon' && next.length === 4) {
        onMeasurementComplete?.({
          kind: 'polygon',
          points: next,
          value: polygonArea(pointsToPixelMm(next)),
          unit: 'mm2',
          densityRoi: { kind: 'polygon', points: next },
        });
      }
      // In controlled mode the host persists and redraws finished
      // measurements, so the in-progress copy is cleared.
      setPoints(complete && controlled ? [] : next);
    }
  };

  const downloadPng = () => {
    const canvas = getCanvas();
    if (!canvas) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `${exportName}.png`;
    link.click();
  };

  const toScreen = (point: MeasurePoint) => ({
    x: imageRect.left + point.xRatio * imageRect.width,
    y: imageRect.top + point.yRatio * imageRect.height,
  });

  const spanX = (image?.width ?? 1) - 1;
  const spanY = (image?.height ?? 1) - 1;

  const mmBetween = (a: MeasurePoint, b: MeasurePoint) => {
    const dx = (b.xRatio - a.xRatio) * spanX * mmPerPixel.x;
    const dy = (b.yRatio - a.yRatio) * spanY * mmPerPixel.y;
    return Math.hypot(dx, dy);
  };

  const angleAt = (p0: MeasurePoint, p1: MeasurePoint, p2: MeasurePoint) => {
    const v0x = (p0.xRatio - p1.xRatio) * spanX * mmPerPixel.x;
    const v0y = (p0.yRatio - p1.yRatio) * spanY * mmPerPixel.y;
    const v2x = (p2.xRatio - p1.xRatio) * spanX * mmPerPixel.x;
    const v2y = (p2.yRatio - p1.yRatio) * spanY * mmPerPixel.y;
    const dot = v0x * v2x + v0y * v2y;
    const mag = Math.hypot(v0x, v0y) * Math.hypot(v2x, v2y) || 1;
    return (Math.acos(clamp(dot / mag, -1, 1)) * 180) / Math.PI;
  };

  const pointsToPixelMm = (items: MeasurePoint[]): Vec2[] =>
    items.map((point) => [
      point.xRatio * spanX * mmPerPixel.x,
      point.yRatio * spanY * mmPerPixel.y,
    ]);

  return (
    <>
      {mode !== 'off' ? (
        <div
          className="absolute inset-0 cursor-crosshair"
          onPointerDown={placePoint}
        />
      ) : null}

      {shapes.length > 0 ? (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          {shapes.map((shape) => {
            const color = shape.selected ? SELECTED_COLOR : SAVED_COLOR;
            const screen = shape.points.map(toScreen);
            const anchor = screen[screen.length - 1] ?? { x: 0, y: 0 };
            return (
              <g key={shape.id}>
                {shape.kind === 'ellipse' && screen.length >= 2 ? (
                  <ellipse
                    cx={(screen[0].x + screen[1].x) / 2}
                    cy={(screen[0].y + screen[1].y) / 2}
                    rx={Math.abs(screen[1].x - screen[0].x) / 2}
                    ry={Math.abs(screen[1].y - screen[0].y) / 2}
                    fill={`${color}14`}
                    stroke={color}
                    strokeWidth={1.5}
                  />
                ) : shape.kind === 'polygon' ? (
                  <polygon
                    points={screen.map((point) => `${point.x},${point.y}`).join(' ')}
                    fill={`${color}14`}
                    stroke={color}
                    strokeWidth={1.5}
                  />
                ) : (
                  <polyline
                    points={screen.map((point) => `${point.x},${point.y}`).join(' ')}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.5}
                  />
                )}
                {shape.kind !== 'ellipse'
                  ? screen.map((point, index) => (
                      <circle
                        key={index}
                        cx={point.x}
                        cy={point.y}
                        r={2.5}
                        fill={color}
                        stroke="#0b1220"
                        strokeWidth={1}
                      />
                    ))
                  : null}
                <text
                  x={
                    shape.kind === 'distance' && screen.length >= 2
                      ? (screen[0].x + screen[1].x) / 2
                      : anchor.x + 8
                  }
                  y={
                    shape.kind === 'distance' && screen.length >= 2
                      ? (screen[0].y + screen[1].y) / 2 - 6
                      : anchor.y - 8
                  }
                  fill={color}
                  fontSize={11}
                  fontWeight={600}
                  stroke="#0b1220"
                  strokeWidth={3}
                  paintOrder="stroke"
                  textAnchor={shape.kind === 'distance' ? 'middle' : 'start'}
                >
                  {shape.label}
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}

      {controlled ? null : (
      <div className="pointer-events-auto absolute right-2 top-2 flex items-center gap-0.5 rounded-md bg-slate-950/75 p-0.5 ring-1 ring-white/10">
        <button
          type="button"
          title={labels.measureDistance}
          onClick={() => toggleMode('distance')}
          className={cn(
            'rounded p-1 transition',
            mode === 'distance'
              ? 'bg-sky-500/20 text-sky-200'
              : 'text-slate-300 hover:bg-slate-800',
          )}
        >
          <Ruler className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          title={labels.measureAngle}
          onClick={() => toggleMode('angle')}
          className={cn(
            'rounded p-1 transition',
            mode === 'angle'
              ? 'bg-sky-500/20 text-sky-200'
              : 'text-slate-300 hover:bg-slate-800',
          )}
        >
          <Triangle className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Measure ellipse ROI (reference only)"
          onClick={() => toggleMode('ellipse')}
          className={cn(
            'rounded p-1 transition',
            mode === 'ellipse'
              ? 'bg-sky-500/20 text-sky-200'
              : 'text-slate-300 hover:bg-slate-800',
          )}
        >
          <Circle className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          title="Measure polygon ROI (reference only)"
          onClick={() => toggleMode('polygon')}
          className={cn(
            'rounded p-1 transition',
            mode === 'polygon'
              ? 'bg-sky-500/20 text-sky-200'
              : 'text-slate-300 hover:bg-slate-800',
          )}
        >
          <Pentagon className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          title={labels.clear}
          onClick={() => setPoints([])}
          className="rounded p-1 text-slate-300 transition hover:bg-slate-800"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          title={labels.savePng}
          onClick={downloadPng}
          className="rounded p-1 text-slate-300 transition hover:bg-slate-800"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      )}

      {points.length > 0 ? (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          {points.length >= 2 && mode !== 'ellipse' ? (
            <polyline
              points={points
                .map((point) => {
                  const screen = toScreen(point);
                  return `${screen.x},${screen.y}`;
                })
                .join(' ')}
              fill="none"
              stroke="#38bdf8"
              strokeWidth={1.5}
            />
          ) : null}
          {mode === 'ellipse' && points.length >= 2
            ? (() => {
                const a = toScreen(points[0]);
                const b = toScreen(points[1]);
                return (
                  <ellipse
                    cx={(a.x + b.x) / 2}
                    cy={(a.y + b.y) / 2}
                    rx={Math.abs(b.x - a.x) / 2}
                    ry={Math.abs(b.y - a.y) / 2}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth={1.5}
                  />
                );
              })()
            : null}
          {points.map((point, index) => {
            const screen = toScreen(point);
            return (
              <circle
                key={`${point.xRatio}-${point.yRatio}-${index}`}
                cx={screen.x}
                cy={screen.y}
                r={3.5}
                fill="#38bdf8"
                stroke="#0b1220"
                strokeWidth={1}
              />
            );
          })}
          {mode === 'distance' && points.length === 2
            ? (() => {
                const a = toScreen(points[0]);
                const b = toScreen(points[1]);
                return (
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 6}
                    fill="#e2e8f0"
                    fontSize={11}
                    stroke="#0b1220"
                    strokeWidth={3}
                    paintOrder="stroke"
                    textAnchor="middle"
                  >
                    {mmBetween(points[0], points[1]).toFixed(1)} mm
                  </text>
                );
              })()
            : null}
          {mode === 'angle' && points.length === 3
            ? (() => {
                const mid = toScreen(points[1]);
                return (
                  <text
                    x={mid.x + 8}
                    y={mid.y - 8}
                    fill="#e2e8f0"
                    fontSize={11}
                    stroke="#0b1220"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {angleAt(points[0], points[1], points[2]).toFixed(1)}°
                  </text>
                );
              })()
            : null}
          {(mode === 'ellipse' || mode === 'polygon') && points.length === (mode === 'ellipse' ? 2 : 4)
            ? (() => {
                const anchor = toScreen(points[points.length - 1]);
                const area =
                  mode === 'ellipse'
                    ? ellipseArea(
                        (Math.abs(points[1].xRatio - points[0].xRatio) *
                          spanX *
                          mmPerPixel.x) /
                          2,
                        (Math.abs(points[1].yRatio - points[0].yRatio) *
                          spanY *
                          mmPerPixel.y) /
                          2,
                      )
                    : polygonArea(pointsToPixelMm(points));
                return (
                  <text
                    x={anchor.x + 8}
                    y={anchor.y - 8}
                    fill="#e2e8f0"
                    fontSize={11}
                    stroke="#0b1220"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {area.toFixed(1)} mm2
                  </text>
                );
              })()
            : null}
        </svg>
      ) : null}
    </>
  );
}
