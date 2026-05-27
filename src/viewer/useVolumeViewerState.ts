import debounce from 'lodash/debounce';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  extractAxialImage,
  extractCoronalImage,
  extractSagittalImage,
  type LoadedVolume,
  type RangeBounds,
  type SliceWindowLevel,
  type Vec3,
  type ViewerSlices,
  VolumeAxis,
  type VolumeCursor,
} from './core';

/**
 * Headless viewer state for a single loaded volume: cursor, window/level,
 * MPR zoom, selected axis, and the three derived 2D slices. It carries no
 * loading, i18n, or rendering concerns, so any consumer that already has a
 * `LoadedVolume` can drive the viewer components by passing this hook's output
 * as props. State re-initializes automatically when the volume identity
 * changes.
 */

const DEFAULT_MPR_ZOOM = 1;
const DEFAULT_WINDOW_LEVEL: SliceWindowLevel = { window: 3200, level: 1600 };
const EMPTY_SLICES: ViewerSlices = {
  axial: null,
  coronal: null,
  sagittal: null,
};
const WINDOW_MIN = 256;
const WINDOW_MAX = 4095;
const LEVEL_MIN = 0;
const LEVEL_MAX = 4095;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createCenterCursor(volume: LoadedVolume): VolumeCursor {
  const [x, y, z] = volume.meta.dimensions;
  return {
    x: Math.floor(x / 2),
    y: Math.floor(y / 2),
    z: Math.floor(z / 2),
  };
}

function resolveWindowBounds(volume: LoadedVolume | null): RangeBounds {
  if (!volume) return { min: WINDOW_MIN, max: WINDOW_MAX };
  const span = Math.round(
    volume.meta.scalarRange[1] - volume.meta.scalarRange[0],
  );
  return {
    min: WINDOW_MIN,
    max: Math.max(WINDOW_MAX, span, volume.meta.initialWindowLevel.window),
  };
}

function resolveLevelBounds(volume: LoadedVolume | null): RangeBounds {
  if (!volume) return { min: LEVEL_MIN, max: LEVEL_MAX };
  return {
    min: Math.min(LEVEL_MIN, Math.floor(volume.meta.scalarRange[0])),
    max: Math.max(
      LEVEL_MAX,
      Math.ceil(volume.meta.scalarRange[1]),
      volume.meta.initialWindowLevel.level,
    ),
  };
}

export interface VolumeViewerState {
  cursor: VolumeCursor | null;
  slices: ViewerSlices;
  /** Live (uncommitted) window/level, e.g. while dragging a slider. */
  windowLevelDraft: SliceWindowLevel;
  /** Committed window/level that the slices are rendered with. */
  windowLevel: SliceWindowLevel;
  mprZoom: number;
  selectedAxis: VolumeAxis;
  dimensions: Vec3;
  spacing: Vec3;
  windowBounds: RangeBounds;
  levelBounds: RangeBounds;
  setCursor: (cursor: VolumeCursor | null) => void;
  setMprZoom: (zoom: number) => void;
  setSelectedAxis: (axis: VolumeAxis) => void;
  updateCursor: (
    axis: VolumeAxis,
  ) => (point: { xRatio: number; yRatio: number }) => void;
  handleWindowChange: (value: number) => void;
  handleWindowCommit: (value: number) => void;
  handleLevelChange: (value: number) => void;
  handleLevelCommit: (value: number) => void;
  handleWindowLevelDrag: (
    delta: { x: number; y: number },
    phase: 'start' | 'move' | 'end',
  ) => void;
}

export function useVolumeViewerState(
  volume: LoadedVolume | null,
): VolumeViewerState {
  const initialWindowLevel = volume?.meta.initialWindowLevel ?? DEFAULT_WINDOW_LEVEL;
  const [cursor, setCursor] = useState<VolumeCursor | null>(() =>
    volume ? createCenterCursor(volume) : null,
  );
  const [windowLevelDraft, setWindowLevelDraft] =
    useState<SliceWindowLevel>(initialWindowLevel);
  const [windowLevel, setWindowLevel] =
    useState<SliceWindowLevel>(initialWindowLevel);
  const dragWindowLevelRef = useRef<SliceWindowLevel>(initialWindowLevel);
  const [mprZoom, setMprZoom] = useState(DEFAULT_MPR_ZOOM);
  const [selectedAxis, setSelectedAxis] = useState<VolumeAxis>(
    volume?.meta.nativeAxis ?? VolumeAxis.Coronal,
  );

  const debouncedCommitWindowLevel = useMemo(
    () =>
      debounce((next: SliceWindowLevel) => {
        setWindowLevel(next);
      }, 96),
    [],
  );
  // Cancel any pending committed-window-level update when the volume changes
  // (or on unmount) so a stale slider value can't land on the new volume.
  useEffect(
    () => () => debouncedCommitWindowLevel.cancel(),
    [volume, debouncedCommitWindowLevel],
  );

  // Re-initialize all volume-derived state when the volume changes. Done in
  // render (not an effect) so the first paint of a new volume is already
  // centered and windowed — no flash of stale/default state. This is React's
  // sanctioned "adjust state during render" pattern, tracked via state.
  const [trackedVolume, setTrackedVolume] = useState<LoadedVolume | null>(
    volume,
  );
  if (trackedVolume !== volume) {
    setTrackedVolume(volume);
    const wl = volume?.meta.initialWindowLevel ?? DEFAULT_WINDOW_LEVEL;
    setCursor(volume ? createCenterCursor(volume) : null);
    setWindowLevelDraft(wl);
    setWindowLevel(wl);
    setMprZoom(DEFAULT_MPR_ZOOM);
    setSelectedAxis(volume?.meta.nativeAxis ?? VolumeAxis.Coronal);
  }

  const slices = useMemo<ViewerSlices>(() => {
    if (!volume || !cursor) return EMPTY_SLICES;
    return {
      axial: extractAxialImage(volume, cursor, windowLevel),
      coronal: extractCoronalImage(volume, cursor, windowLevel),
      sagittal: extractSagittalImage(volume, cursor, windowLevel),
    };
  }, [cursor, volume, windowLevel]);

  const dimensions: Vec3 = volume?.meta.dimensions ?? [0, 0, 0];
  const spacing: Vec3 = volume?.meta.spacing ?? [0, 0, 0];
  const windowBounds = resolveWindowBounds(volume);
  const levelBounds = resolveLevelBounds(volume);

  const updateCursor =
    (axis: VolumeAxis) =>
    ({ xRatio, yRatio }: { xRatio: number; yRatio: number }) => {
      if (!volume) return;

      setCursor((current) => {
        if (!current) return current;

        const [width, height, depth] = volume.meta.dimensions;
        if (axis === VolumeAxis.Axial) {
          const next = {
            x: clamp(Math.round(xRatio * (width - 1)), 0, width - 1),
            y: clamp(Math.round(yRatio * (height - 1)), 0, height - 1),
            z: current.z,
          };
          return next.x === current.x && next.y === current.y ? current : next;
        }

        if (axis === VolumeAxis.Coronal) {
          const next = {
            x: clamp(Math.round(xRatio * (width - 1)), 0, width - 1),
            y: current.y,
            z: clamp(Math.round((1 - yRatio) * (depth - 1)), 0, depth - 1),
          };
          return next.x === current.x && next.z === current.z ? current : next;
        }

        const next = {
          x: current.x,
          y: clamp(Math.round(xRatio * (height - 1)), 0, height - 1),
          z: clamp(Math.round((1 - yRatio) * (depth - 1)), 0, depth - 1),
        };
        return next.y === current.y && next.z === current.z ? current : next;
      });
    };

  const updateWindowLevelDraft = (next: SliceWindowLevel) => {
    dragWindowLevelRef.current = next;
    setWindowLevelDraft(next);
    debouncedCommitWindowLevel(next);
  };

  const flushWindowLevelDraft = (next: SliceWindowLevel) => {
    debouncedCommitWindowLevel.cancel();
    dragWindowLevelRef.current = next;
    setWindowLevelDraft(next);
    setWindowLevel(next);
  };

  const handleWindowChange = (value: number) =>
    updateWindowLevelDraft({ ...windowLevelDraft, window: value });
  const handleWindowCommit = (value: number) =>
    flushWindowLevelDraft({ ...windowLevelDraft, window: value });
  const handleLevelChange = (value: number) =>
    updateWindowLevelDraft({ ...windowLevelDraft, level: value });
  const handleLevelCommit = (value: number) =>
    flushWindowLevelDraft({ ...windowLevelDraft, level: value });
  const handleWindowLevelDrag = (
    delta: { x: number; y: number },
    phase: 'start' | 'move' | 'end',
  ) => {
    if (phase === 'start') {
      dragWindowLevelRef.current = windowLevelDraft;
      return;
    }
    if (phase === 'end') {
      flushWindowLevelDraft(dragWindowLevelRef.current);
      return;
    }
    const windowRange = Math.max(1, windowBounds.max - windowBounds.min);
    const levelRange = Math.max(1, levelBounds.max - levelBounds.min);
    const current = dragWindowLevelRef.current;
    const next = {
      window: clamp(
        Math.round(current.window - delta.y * (windowRange / 300)),
        windowBounds.min,
        windowBounds.max,
      ),
      level: clamp(
        Math.round(current.level + delta.x * (levelRange / 300)),
        levelBounds.min,
        levelBounds.max,
      ),
    };
    dragWindowLevelRef.current = next;
    updateWindowLevelDraft(next);
  };

  return {
    cursor,
    slices,
    windowLevelDraft,
    windowLevel,
    mprZoom,
    selectedAxis,
    dimensions,
    spacing,
    windowBounds,
    levelBounds,
    setCursor,
    setMprZoom,
    setSelectedAxis,
    updateCursor,
    handleWindowChange,
    handleWindowCommit,
    handleLevelChange,
    handleLevelCommit,
    handleWindowLevelDrag,
  };
}
