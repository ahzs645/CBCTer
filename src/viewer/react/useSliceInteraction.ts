import {
  type PointerEvent,
  useEffect,
  useRef,
  useState,
  type WheelEvent,
} from 'react';
import type { SliceImage } from '../../types';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

enum ScrubPointerType {
  Mouse = 'mouse',
  Touch = 'touch',
}

enum ScrubCursor {
  Crosshair = 'crosshair',
  EwResize = 'ew-resize',
  NsResize = 'ns-resize',
  NeswResize = 'nesw-resize',
  NwseResize = 'nwse-resize',
}

interface ScrubState {
  active: boolean;
  pointerId: number | null;
  pointerType: ScrubPointerType | null;
  lastX: number;
  lastY: number;
  currentX: number;
  currentY: number;
  maxX: number;
  maxY: number;
  voxelPerPixelX: number;
  voxelPerPixelY: number;
  pendingX: number;
  pendingY: number;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getPointerDistance(points: Array<{ x: number; y: number }>): number {
  if (points.length < 2) return 0;
  const [first, second] = points;
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function normalizeWheelDelta(
  event: WheelEvent<HTMLDivElement>,
  surfaceHeight: number,
): number {
  if (event.deltaMode === DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === DOM_DELTA_PAGE) return event.deltaY * surfaceHeight;
  return event.deltaY;
}

function resolveScrubCursor(deltaX: number, deltaY: number): ScrubCursor {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  if (absX < 2 && absY < 2) return ScrubCursor.Crosshair;
  if (absX >= absY * 1.5) return ScrubCursor.EwResize;
  if (absY >= absX * 1.5) return ScrubCursor.NsResize;
  return deltaX * deltaY >= 0 ? ScrubCursor.NwseResize : ScrubCursor.NeswResize;
}

export interface SliceInteractionParams {
  image: SliceImage | null;
  zoom: number;
  imageRect: Rect;
  cursorWidth: number;
  cursorHeight: number;
  surfaceHeight: number;
  onSelect?: (point: { xRatio: number; yRatio: number }) => void;
  onEdit?: (
    point: { xRatio: number; yRatio: number },
    phase: 'start' | 'move' | 'end',
  ) => void;
  onWindowLevelDrag?: (
    delta: { x: number; y: number },
    phase: 'start' | 'move' | 'end',
  ) => void;
  onZoomChange?: (nextZoom: number) => void;
}

export interface SliceInteraction {
  /** CSS cursor reflecting the active scrub direction. */
  scrubCursor: string;
  handlers: {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
    onWheel: (event: WheelEvent<HTMLDivElement>) => void;
  };
}

/**
 * Pointer/wheel interaction for a slice surface: drag-to-scrub (one voxel per
 * frame), wheel + pinch zoom, and a direction-aware scrub cursor. Extracted
 * verbatim from SliceCanvas so the carefully tuned feel is preserved.
 */
export function useSliceInteraction({
  image,
  zoom,
  imageRect,
  cursorWidth,
  cursorHeight,
  surfaceHeight,
  onSelect,
  onEdit,
  onWindowLevelDrag,
  onZoomChange,
}: SliceInteractionParams): SliceInteraction {
  const [scrubCursor, setScrubCursor] = useState<ScrubCursor>(
    ScrubCursor.Crosshair,
  );
  const dragRef = useRef<ScrubState>({
    active: false,
    pointerId: null,
    pointerType: null,
    lastX: 0,
    lastY: 0,
    currentX: 0,
    currentY: 0,
    maxX: 1,
    maxY: 1,
    voxelPerPixelX: 0,
    voxelPerPixelY: 0,
    pendingX: 0,
    pendingY: 0,
  });
  const rafRef = useRef<number | null>(null);
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ startDistance: number; startZoom: number } | null>(
    null,
  );

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const toSelectionPoint = (localX: number, localY: number) => ({
    xRatio: clamp(
      (localX - imageRect.left) / Math.max(1, imageRect.width),
      0,
      1,
    ),
    yRatio: clamp(
      (localY - imageRect.top) / Math.max(1, imageRect.height),
      0,
      1,
    ),
  });

  const cancelScrubFrame = () => {
    if (rafRef.current === null) return;

    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const emitScrubSelection = () => {
    if (!onSelect || !image) return;

    const { currentX, currentY, maxX, maxY } = dragRef.current;
    onSelect({
      xRatio: maxX > 0 ? currentX / maxX : 0,
      yRatio: maxY > 0 ? currentY / maxY : 0,
    });
  };

  const scheduleScrubFrame = () => {
    if (rafRef.current !== null) return;

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;

      if (!dragRef.current.active || !onSelect || !image) return;

      const stepX =
        dragRef.current.pendingX >= 1
          ? 1
          : dragRef.current.pendingX <= -1
            ? -1
            : 0;
      const stepY =
        dragRef.current.pendingY >= 1
          ? 1
          : dragRef.current.pendingY <= -1
            ? -1
            : 0;

      if (stepX === 0 && stepY === 0) return;

      dragRef.current.pendingX -= stepX;
      dragRef.current.pendingY -= stepY;
      dragRef.current.currentX = clamp(
        dragRef.current.currentX + stepX,
        0,
        dragRef.current.maxX,
      );
      dragRef.current.currentY = clamp(
        dragRef.current.currentY + stepY,
        0,
        dragRef.current.maxY,
      );
      emitScrubSelection();

      if (
        Math.abs(dragRef.current.pendingX) >= 1 ||
        Math.abs(dragRef.current.pendingY) >= 1
      ) {
        scheduleScrubFrame();
      }
    });
  };

  const pointFromEvent = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const updateScrubCursor = (
    pointerType: ScrubPointerType | null,
    deltaX: number,
    deltaY: number,
  ) => {
    if (pointerType !== ScrubPointerType.Mouse) return;

    const nextCursor = resolveScrubCursor(deltaX, deltaY);
    setScrubCursor((current) =>
      current === nextCursor ? current : nextCursor,
    );
  };

  const startScrub = (
    pointerId: number,
    pointerType: ScrubPointerType,
    origin: { x: number; y: number },
    selection: { xRatio: number; yRatio: number },
  ) => {
    const maxX = Math.max(0, cursorWidth - 1);
    const maxY = Math.max(0, cursorHeight - 1);
    const centered = zoom > MIN_ZOOM;
    const effectiveWidth = Math.max(
      1,
      centered ? Math.max(imageRect.width, maxX || 1) : imageRect.width,
    );
    const effectiveHeight = Math.max(
      1,
      centered ? Math.max(imageRect.height, maxY || 1) : imageRect.height,
    );

    dragRef.current.active = true;
    dragRef.current.pointerId = pointerId;
    dragRef.current.pointerType = pointerType;
    dragRef.current.lastX = origin.x;
    dragRef.current.lastY = origin.y;
    dragRef.current.currentX = clamp(
      Math.round(selection.xRatio * maxX),
      0,
      maxX,
    );
    dragRef.current.currentY = clamp(
      Math.round(selection.yRatio * maxY),
      0,
      maxY,
    );
    dragRef.current.maxX = maxX;
    dragRef.current.maxY = maxY;
    dragRef.current.voxelPerPixelX = maxX > 0 ? maxX / effectiveWidth : 0;
    dragRef.current.voxelPerPixelY = maxY > 0 ? maxY / effectiveHeight : 0;
    dragRef.current.pendingX = 0;
    dragRef.current.pendingY = 0;
    setScrubCursor(ScrubCursor.Crosshair);
  };

  const stopScrub = () => {
    dragRef.current.active = false;
    dragRef.current.pointerId = null;
    dragRef.current.pointerType = null;
    dragRef.current.pendingX = 0;
    dragRef.current.pendingY = 0;
    cancelScrubFrame();
    setScrubCursor(ScrubCursor.Crosshair);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!image) return;

    if (event.pointerType === 'mouse') {
      if (event.button !== 0 || (!onSelect && !onEdit && !onWindowLevelDrag)) {
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      const point = pointFromEvent(event);
      const selection = toSelectionPoint(point.x, point.y);
      if (onWindowLevelDrag) {
        dragRef.current.active = true;
        dragRef.current.pointerId = event.pointerId;
        dragRef.current.pointerType = ScrubPointerType.Mouse;
        dragRef.current.lastX = point.x;
        dragRef.current.lastY = point.y;
        setScrubCursor(ScrubCursor.NwseResize);
        onWindowLevelDrag({ x: 0, y: 0 }, 'start');
        return;
      }
      if (onEdit) {
        dragRef.current.active = true;
        dragRef.current.pointerId = event.pointerId;
        dragRef.current.pointerType = ScrubPointerType.Mouse;
        dragRef.current.lastX = point.x;
        dragRef.current.lastY = point.y;
        onEdit(selection, 'start');
        return;
      }
      startScrub(event.pointerId, ScrubPointerType.Mouse, point, selection);
      emitScrubSelection();
      return;
    }

    if (event.pointerType === 'touch') {
      touchPointsRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      event.currentTarget.setPointerCapture(event.pointerId);

      if (touchPointsRef.current.size >= 2 && onZoomChange) {
        stopScrub();
        pinchRef.current = {
          startDistance: getPointerDistance([
            ...touchPointsRef.current.values(),
          ]),
          startZoom: zoom,
        };
        return;
      }

      if (onWindowLevelDrag) {
        const point = pointFromEvent(event);
        dragRef.current.active = true;
        dragRef.current.pointerId = event.pointerId;
        dragRef.current.pointerType = ScrubPointerType.Touch;
        dragRef.current.lastX = point.x;
        dragRef.current.lastY = point.y;
        onWindowLevelDrag({ x: 0, y: 0 }, 'start');
      } else if (onEdit) {
        const point = pointFromEvent(event);
        dragRef.current.active = true;
        dragRef.current.pointerId = event.pointerId;
        dragRef.current.pointerType = ScrubPointerType.Touch;
        dragRef.current.lastX = point.x;
        dragRef.current.lastY = point.y;
        onEdit(toSelectionPoint(point.x, point.y), 'start');
      } else if (onSelect) {
        const point = pointFromEvent(event);
        const selection = toSelectionPoint(point.x, point.y);
        startScrub(event.pointerId, ScrubPointerType.Touch, point, selection);
        emitScrubSelection();
      }
      return;
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') {
      if (
        !dragRef.current.active ||
        dragRef.current.pointerId !== event.pointerId ||
        (!onSelect && !onEdit && !onWindowLevelDrag)
      ) {
        return;
      }

      event.preventDefault();
      const point = pointFromEvent(event);
      if (onWindowLevelDrag) {
        const delta = {
          x: point.x - dragRef.current.lastX,
          y: point.y - dragRef.current.lastY,
        };
        dragRef.current.lastX = point.x;
        dragRef.current.lastY = point.y;
        onWindowLevelDrag(delta, 'move');
        return;
      }
      if (onEdit) {
        dragRef.current.lastX = point.x;
        dragRef.current.lastY = point.y;
        onEdit(toSelectionPoint(point.x, point.y), 'move');
        return;
      }
      updateScrubCursor(
        ScrubPointerType.Mouse,
        point.x - dragRef.current.lastX,
        point.y - dragRef.current.lastY,
      );
      dragRef.current.pendingX +=
        (point.x - dragRef.current.lastX) * dragRef.current.voxelPerPixelX;
      dragRef.current.pendingY +=
        (point.y - dragRef.current.lastY) * dragRef.current.voxelPerPixelY;
      dragRef.current.lastX = point.x;
      dragRef.current.lastY = point.y;
      scheduleScrubFrame();
      return;
    }

    if (event.pointerType !== 'touch') return;

    const touchPoint = touchPointsRef.current.get(event.pointerId);
    if (!touchPoint) return;

    touchPoint.x = event.clientX;
    touchPoint.y = event.clientY;

    if (
      dragRef.current.active &&
      dragRef.current.pointerId === event.pointerId &&
      dragRef.current.pointerType === ScrubPointerType.Touch &&
      (onSelect || onEdit || onWindowLevelDrag)
    ) {
      event.preventDefault();
      const point = pointFromEvent(event);
      if (onWindowLevelDrag) {
        const delta = {
          x: point.x - dragRef.current.lastX,
          y: point.y - dragRef.current.lastY,
        };
        dragRef.current.lastX = point.x;
        dragRef.current.lastY = point.y;
        onWindowLevelDrag(delta, 'move');
        return;
      }
      if (onEdit) {
        dragRef.current.lastX = point.x;
        dragRef.current.lastY = point.y;
        onEdit(toSelectionPoint(point.x, point.y), 'move');
        return;
      }
      updateScrubCursor(
        ScrubPointerType.Touch,
        point.x - dragRef.current.lastX,
        point.y - dragRef.current.lastY,
      );
      dragRef.current.pendingX +=
        (point.x - dragRef.current.lastX) * dragRef.current.voxelPerPixelX;
      dragRef.current.pendingY +=
        (point.y - dragRef.current.lastY) * dragRef.current.voxelPerPixelY;
      dragRef.current.lastX = point.x;
      dragRef.current.lastY = point.y;
      scheduleScrubFrame();
      return;
    }

    const pinch = pinchRef.current;
    if (
      !pinch ||
      touchPointsRef.current.size < 2 ||
      !onZoomChange ||
      pinch.startDistance <= 0
    ) {
      return;
    }

    event.preventDefault();
    const nextZoom = clamp(
      pinch.startZoom *
        (getPointerDistance([...touchPointsRef.current.values()]) /
          pinch.startDistance),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    onZoomChange(nextZoom);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') {
      if (
        dragRef.current.active &&
        dragRef.current.pointerId === event.pointerId
      ) {
        if (onWindowLevelDrag) {
          onWindowLevelDrag({ x: 0, y: 0 }, 'end');
        } else if (onEdit) {
          const point = pointFromEvent(event);
          onEdit(toSelectionPoint(point.x, point.y), 'end');
        } else if (
          Math.abs(dragRef.current.pendingX) >= 1 ||
          Math.abs(dragRef.current.pendingY) >= 1
        ) {
          scheduleScrubFrame();
        }
        stopScrub();
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

    if (event.pointerType === 'touch') {
      const wasScrubbing =
        dragRef.current.active && dragRef.current.pointerId === event.pointerId;
      if (wasScrubbing) {
        if (onWindowLevelDrag) {
          onWindowLevelDrag({ x: 0, y: 0 }, 'end');
        } else if (onEdit) {
          const point = pointFromEvent(event);
          onEdit(toSelectionPoint(point.x, point.y), 'end');
        } else if (
          Math.abs(dragRef.current.pendingX) >= 1 ||
          Math.abs(dragRef.current.pendingY) >= 1
        ) {
          scheduleScrubFrame();
        }
        stopScrub();
      }

      touchPointsRef.current.delete(event.pointerId);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (touchPointsRef.current.size < 2) {
        pinchRef.current = null;
      } else if (onZoomChange) {
        pinchRef.current = {
          startDistance: getPointerDistance([
            ...touchPointsRef.current.values(),
          ]),
          startZoom: zoom,
        };
      }
      return;
    }
  };

  const onPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (
      dragRef.current.active &&
      dragRef.current.pointerId === event.pointerId
    ) {
      stopScrub();
    }

    if (event.pointerType === 'touch') {
      touchPointsRef.current.delete(event.pointerId);
      if (touchPointsRef.current.size < 2) {
        pinchRef.current = null;
      }
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!onZoomChange || !image) return;

    event.preventDefault();
    const scale = Math.exp(
      -normalizeWheelDelta(event, surfaceHeight) * 0.0015,
    );
    onZoomChange(clamp(zoom * scale, MIN_ZOOM, MAX_ZOOM));
  };

  return {
    scrubCursor,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onWheel,
    },
  };
}
