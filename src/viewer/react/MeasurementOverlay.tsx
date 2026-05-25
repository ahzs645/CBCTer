import { Download, Ruler, Triangle, X } from 'lucide-react';
import { type PointerEvent, useState } from 'react';
import type { SliceImage } from '../../types';
import { cn } from '../../utils/cn';
import { defaultMeasurementLabels, type MeasurementLabels } from '../labels';

type MeasureMode = 'off' | 'distance' | 'angle';
interface MeasurePoint {
  xRatio: number;
  yRatio: number;
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
}

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
}: MeasurementOverlayProps) {
  const [mode, setMode] = useState<MeasureMode>('off');
  const [points, setPoints] = useState<MeasurePoint[]>([]);

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
    const max = mode === 'angle' ? 3 : 2;
    setPoints((prev) => (prev.length >= max ? [point] : [...prev, point]));
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

  return (
    <>
      {mode !== 'off' ? (
        <div
          className="absolute inset-0 cursor-crosshair"
          onPointerDown={placePoint}
        />
      ) : null}

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

      {points.length > 0 ? (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          {points.length >= 2 ? (
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
        </svg>
      ) : null}
    </>
  );
}
