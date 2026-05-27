import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { SliceImage } from '../../types';
import { cn } from '../../utils/cn';
import { Badge } from '../../components/Badge';
import { BadgeVariant } from '../../components/Badge.constants';
import { MeasurementOverlay } from './MeasurementOverlay';
import type { MeasurementLabels } from '../labels';
import type { CompletedSliceMeasurement } from './MeasurementOverlay';
import {
  SliceCanvasFit,
  type SliceCanvasFit as SliceCanvasFitType,
} from './SliceCanvas.constants';
import { type Rect, useSliceInteraction } from './useSliceInteraction';

interface SliceCanvasProps {
  image: SliceImage | null;
  overlay?: SliceImage | null;
  crosshairPoint?: { x: number; y: number };
  crosshairSpace?: [number, number];
  crosshair?: boolean;
  crosshairColors?: { vertical: string; horizontal: string };
  /** Fallback crosshair color when crosshairColors is not provided. */
  crosshairColor?: string;
  /** Extra classes merged onto the root element. */
  className?: string;
  label?: string;
  fit?: SliceCanvasFitType;
  displayAspect?: number;
  zoom?: number;
  onZoomChange?: (nextZoom: number) => void;
  onSelect?: (point: { xRatio: number; yRatio: number }) => void;
  onProbe?: (point: { xRatio: number; yRatio: number } | null) => void;
  onEdit?: (
    point: { xRatio: number; yRatio: number },
    phase: 'start' | 'move' | 'end',
  ) => void;
  onWindowLevelDrag?: (
    delta: { x: number; y: number },
    phase: 'start' | 'move' | 'end',
  ) => void;
  onMeasurementComplete?: (measurement: CompletedSliceMeasurement) => void;
  /** In-plane mm per image pixel [x, y]; enables measurement + export tools. */
  mmPerPixel?: { x: number; y: number };
  /** Filename used for the per-pane PNG export. */
  exportName?: string;
  /** Override the measurement toolbar tooltips (English defaults otherwise). */
  measurementLabels?: MeasurementLabels;
  cropRect?: {
    min: { xRatio: number; yRatio: number };
    max: { xRatio: number; yRatio: number };
    enabled: boolean;
  };
  onCropRectChange?: (rect: {
    min: { xRatio: number; yRatio: number };
    max: { xRatio: number; yRatio: number };
    enabled: boolean;
  }) => void;
  annotations?: Array<{
    id: string;
    point: { xRatio: number; yRatio: number };
    label: string;
    color: string;
    selected?: boolean;
  }>;
  onAnnotationSelect?: (id: string) => void;
  onAnnotationMove?: (id: string, point: { xRatio: number; yRatio: number }) => void;
  brushPreview?: {
    radiusXRatio: number;
    radiusYRatio: number;
    color: string;
    visible: boolean;
  };
}

const FALLBACK_RECT: Rect = {
  left: 0,
  top: 0,
  width: 1,
  height: 1,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampCoveredOffset(
  offset: number,
  contentSize: number,
  viewportSize: number,
): number {
  if (contentSize <= viewportSize) {
    return (viewportSize - contentSize) / 2;
  }

  return clamp(offset, viewportSize - contentSize, 0);
}

export function SliceCanvas({
  image,
  overlay,
  crosshairPoint,
  crosshairSpace,
  crosshair = true,
  crosshairColors,
  crosshairColor = '#7dd3fc',
  className,
  label,
  fit = SliceCanvasFit.Contain,
  displayAspect = 1,
  zoom = 1,
  onZoomChange,
  onSelect,
  onProbe,
  onEdit,
  onWindowLevelDrag,
  onMeasurementComplete,
  mmPerPixel,
  exportName = 'slice',
  measurementLabels,
  cropRect,
  onCropRectChange,
  annotations = [],
  onAnnotationSelect,
  onAnnotationMove,
  brushPreview,
}: SliceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [surfaceSize, setSurfaceSize] = useState({ width: 1, height: 1 });
  const imageDataRef = useRef<ImageData | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayImageDataRef = useRef<ImageData | null>(null);
  const [hoverPoint, setHoverPoint] = useState<{ xRatio: number; yRatio: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = image?.width ?? 1;
    const height = image?.height ?? 1;
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);

    if (image) {
      const imageData = imageDataRef.current;
      const canReuseImageData =
        imageData &&
        imageData.width === image.width &&
        imageData.height === image.height;

      if (canReuseImageData) {
        imageData.data.set(image.data);
        ctx.putImageData(imageData, 0, 0);
      } else {
        const nextImageData = new ImageData(image.width, image.height);
        nextImageData.data.set(image.data);
        imageDataRef.current = nextImageData;
        ctx.putImageData(nextImageData, 0, 0);
      }
    }
  }, [image]);

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = overlay?.width ?? image?.width ?? 1;
    const height = overlay?.height ?? image?.height ?? 1;
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);

    if (overlay) {
      const imageData = overlayImageDataRef.current;
      const canReuseImageData =
        imageData &&
        imageData.width === overlay.width &&
        imageData.height === overlay.height;

      if (canReuseImageData) {
        imageData.data.set(overlay.data);
        ctx.putImageData(imageData, 0, 0);
      } else {
        const nextImageData = new ImageData(overlay.width, overlay.height);
        nextImageData.data.set(overlay.data);
        overlayImageDataRef.current = nextImageData;
        ctx.putImageData(nextImageData, 0, 0);
      }
    }
  }, [image?.height, image?.width, overlay]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const updateSize = () => {
      setSurfaceSize({
        width: Math.max(1, surface.clientWidth),
        height: Math.max(1, surface.clientHeight),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  const baseImageRect = useMemo<Rect>(() => {
    if (!image) return FALLBACK_RECT;

    const displayWidth =
      image.width * Math.max(0.1, image.displayAspect ?? displayAspect);
    const displayHeight = image.height;
    const scale =
      fit === SliceCanvasFit.Cover
        ? Math.max(
            surfaceSize.width / displayWidth,
            surfaceSize.height / displayHeight,
          )
        : Math.min(
            surfaceSize.width / displayWidth,
            surfaceSize.height / displayHeight,
          );

    const width = displayWidth * scale;
    const height = displayHeight * scale;

    return {
      left: (surfaceSize.width - width) / 2,
      top: (surfaceSize.height - height) / 2,
      width,
      height,
    };
  }, [displayAspect, fit, image, surfaceSize.height, surfaceSize.width]);

  const [cursorWidth = image?.width ?? 1, cursorHeight = image?.height ?? 1] =
    crosshairSpace ?? [];
  const anchorXRatio = crosshairPoint
    ? crosshairPoint.x / Math.max(1, cursorWidth - 1)
    : 0.5;
  const anchorYRatio = crosshairPoint
    ? crosshairPoint.y / Math.max(1, cursorHeight - 1)
    : 0.5;

  const imageRect = useMemo<Rect>(() => {
    if (!image) return FALLBACK_RECT;

    const width = baseImageRect.width * zoom;
    const height = baseImageRect.height * zoom;
    const desiredLeft = surfaceSize.width / 2 - anchorXRatio * width;
    const desiredTop = surfaceSize.height / 2 - anchorYRatio * height;

    return {
      left: clampCoveredOffset(desiredLeft, width, surfaceSize.width),
      top: clampCoveredOffset(desiredTop, height, surfaceSize.height),
      width,
      height,
    };
  }, [
    anchorXRatio,
    anchorYRatio,
    baseImageRect.height,
    baseImageRect.width,
    image,
    surfaceSize.height,
    surfaceSize.width,
    zoom,
  ]);

  const x = imageRect.left + anchorXRatio * imageRect.width;
  const y = imageRect.top + anchorYRatio * imageRect.height;

  const { scrubCursor, handlers } = useSliceInteraction({
    image,
    zoom,
    imageRect,
    cursorWidth,
    cursorHeight,
    surfaceHeight: surfaceSize.height,
    onEdit,
    onWindowLevelDrag,
    onSelect,
    onProbe: (point) => {
      setHoverPoint(point);
      onProbe?.(point);
    },
    onZoomChange,
  });

  const dragCropHandle = (
    event: PointerEvent<HTMLButtonElement>,
    handle: 'min' | 'max',
  ) => {
    if (!cropRect || event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      const point = {
        xRatio: clamp((moveEvent.clientX - rect.left - imageRect.left) / Math.max(1, imageRect.width), 0, 1),
        yRatio: clamp((moveEvent.clientY - rect.top - imageRect.top) / Math.max(1, imageRect.height), 0, 1),
      };
      const next =
        handle === 'min'
          ? {
              ...cropRect,
              min: {
                xRatio: Math.min(point.xRatio, cropRect.max.xRatio - 0.01),
                yRatio: Math.min(point.yRatio, cropRect.max.yRatio - 0.01),
              },
            }
          : {
              ...cropRect,
              max: {
                xRatio: Math.max(point.xRatio, cropRect.min.xRatio + 0.01),
                yRatio: Math.max(point.yRatio, cropRect.min.yRatio + 0.01),
              },
            };
      onCropRectChange?.(next);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  return (
    <div className={cn('h-full min-h-0', className)}>
      <div
        ref={surfaceRef}
        className="relative h-full min-h-0 w-full overflow-hidden bg-black"
        {...handlers}
        style={{
          cursor: onWindowLevelDrag
            ? 'nwse-resize'
            : onEdit
              ? 'crosshair'
              : onSelect
                ? scrubCursor
                : undefined,
          touchAction: onZoomChange ? 'none' : undefined,
        }}
      >
        <canvas
          ref={canvasRef}
          className={cn(
            'absolute block',
            image?.pixelated !== false && '[image-rendering:pixelated]',
          )}
          style={{
            left: `${imageRect.left}px`,
            top: `${imageRect.top}px`,
            width: `${imageRect.width}px`,
            height: `${imageRect.height}px`,
          }}
        />
        {overlay ? (
          <canvas
            ref={overlayCanvasRef}
            className={cn(
              'pointer-events-none absolute block',
              overlay.pixelated !== false && '[image-rendering:pixelated]',
            )}
            style={{
              left: `${imageRect.left}px`,
              top: `${imageRect.top}px`,
              width: `${imageRect.width}px`,
              height: `${imageRect.height}px`,
            }}
          />
        ) : (
          <canvas ref={overlayCanvasRef} className="hidden" />
        )}
        {label ? (
          <Badge
            variant={BadgeVariant.Overlay}
            className="pointer-events-none absolute left-3 top-12"
          >
            {label}
          </Badge>
        ) : null}
        {crosshair ? (
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
          >
            <span
              className="absolute top-0 bottom-0 w-px"
              style={{
                left: `${x}px`,
                backgroundColor: crosshairColors?.vertical ?? crosshairColor,
                opacity: 0.78,
              }}
            />
            <span
              className="absolute left-0 right-0 h-px"
              style={{
                top: `${y}px`,
                backgroundColor: crosshairColors?.horizontal ?? crosshairColor,
                opacity: 0.78,
              }}
            />
          </div>
        ) : null}
        {cropRect?.enabled ? (
          <div
            className="pointer-events-none absolute border border-emerald-300/90 bg-emerald-300/5"
            style={{
              left: `${imageRect.left + cropRect.min.xRatio * imageRect.width}px`,
              top: `${imageRect.top + cropRect.min.yRatio * imageRect.height}px`,
              width: `${(cropRect.max.xRatio - cropRect.min.xRatio) * imageRect.width}px`,
              height: `${(cropRect.max.yRatio - cropRect.min.yRatio) * imageRect.height}px`,
            }}
          >
            {onCropRectChange ? (
              <>
                <button
                  type="button"
                  aria-label="Move crop minimum"
                  className="pointer-events-auto absolute -left-1.5 -top-1.5 h-3 w-3 rounded-sm border border-emerald-100 bg-emerald-400"
                  onPointerDown={(event) => dragCropHandle(event, 'min')}
                />
                <button
                  type="button"
                  aria-label="Move crop maximum"
                  className="pointer-events-auto absolute -bottom-1.5 -right-1.5 h-3 w-3 rounded-sm border border-emerald-100 bg-emerald-400"
                  onPointerDown={(event) => dragCropHandle(event, 'max')}
                />
              </>
            ) : null}
          </div>
        ) : null}
        {brushPreview?.visible && hoverPoint ? (
          <div
            className="pointer-events-none absolute rounded-full border bg-transparent"
            aria-hidden="true"
            style={{
              left: `${imageRect.left + (hoverPoint.xRatio - brushPreview.radiusXRatio) * imageRect.width}px`,
              top: `${imageRect.top + (hoverPoint.yRatio - brushPreview.radiusYRatio) * imageRect.height}px`,
              width: `${brushPreview.radiusXRatio * 2 * imageRect.width}px`,
              height: `${brushPreview.radiusYRatio * 2 * imageRect.height}px`,
              borderColor: brushPreview.color,
              boxShadow: `0 0 0 1px ${brushPreview.color}55`,
            }}
          />
        ) : null}
        {annotations.length > 0 ? (
          <div className="pointer-events-none absolute inset-0">
            {annotations.map((annotation) => {
              const left = imageRect.left + annotation.point.xRatio * imageRect.width;
              const top = imageRect.top + annotation.point.yRatio * imageRect.height;
              return (
                <button
                  key={annotation.id}
                  type="button"
                  className={cn(
                    'pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full border bg-slate-950/80 px-1.5 py-0.5 text-[10px] shadow',
                    annotation.selected
                      ? 'border-white text-white'
                      : 'border-white/40 text-slate-100',
                  )}
                  style={{ left, top, color: annotation.color }}
                  onPointerDown={(event) => {
                    if (event.pointerType === 'mouse' && event.button !== 0) return;
                    event.stopPropagation();
                    onAnnotationSelect?.(annotation.id);
                    const move = (moveEvent: globalThis.PointerEvent) => {
                      const rect = surfaceRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      onAnnotationMove?.(annotation.id, {
                        xRatio: clamp((moveEvent.clientX - rect.left - imageRect.left) / Math.max(1, imageRect.width), 0, 1),
                        yRatio: clamp((moveEvent.clientY - rect.top - imageRect.top) / Math.max(1, imageRect.height), 0, 1),
                      });
                    };
                    const stop = () => {
                      window.removeEventListener('pointermove', move);
                      window.removeEventListener('pointerup', stop);
                      window.removeEventListener('pointercancel', stop);
                    };
                    window.addEventListener('pointermove', move);
                    window.addEventListener('pointerup', stop);
                    window.addEventListener('pointercancel', stop);
                  }}
                >
                  {annotation.label}
                </button>
              );
            })}
          </div>
        ) : null}
        {mmPerPixel ? (
          <MeasurementOverlay
            image={image}
            imageRect={imageRect}
            mmPerPixel={mmPerPixel}
            exportName={exportName}
            getCanvas={() => canvasRef.current}
            labels={measurementLabels}
            onMeasurementComplete={onMeasurementComplete}
          />
        ) : null}
      </div>
    </div>
  );
}
