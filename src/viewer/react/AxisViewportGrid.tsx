import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SliceImage, Vec3, ViewerSlices, VolumeCursor } from '../../types';
import { VolumeAxis } from '../../types';
import { Select } from '../../components/Select';
import { cn } from '../../utils/cn';
import { defaultAxisViewportLabels, type AxisViewportLabels } from '../labels';
import { defaultViewerTheme, type ViewerTheme } from '../theme';
import { SliceCanvas } from './SliceCanvas';
import { SliceCanvasFit } from './SliceCanvas.constants';
import { ViewportFrame } from './ViewportFrame';
import type {
  CompletedSliceMeasurement,
  MeasureMode,
  SliceMeasurementShape,
} from './MeasurementOverlay';

/**
 * Pane arrangement:
 *  - `row`   three slice panes side by side (the original layout)
 *  - `quad`  2×2: axial | extra (3D) over coronal | sagittal, the classic
 *            dental "XYZ" view
 *  - `focus` the selected axis large, the other two stacked beside it
 */
export type AxisViewportLayout = 'row' | 'quad' | 'focus';
/** A slice axis, or `extra` for the injected pane (normally 3D). */
export type AxisViewportPaneId = VolumeAxis | 'extra';

interface AxisViewportGridProps {
  cursor: { x: number; y: number; z: number } | null;
  dimensions: Vec3;
  spacing: Vec3;
  mprZoom: number;
  overlays?: Partial<Record<VolumeAxis, SliceImage | null>>;
  cropRects?: Partial<
    Record<
      VolumeAxis,
      {
        min: { xRatio: number; yRatio: number };
        max: { xRatio: number; yRatio: number };
        enabled: boolean;
      }
    >
  >;
  annotations?: Partial<
    Record<
      VolumeAxis,
      Array<{
        id: string;
        point: { xRatio: number; yRatio: number };
        label: string;
        color: string;
        selected?: boolean;
      }>
    >
  >;
  brushPreviews?: Partial<
    Record<
      VolumeAxis,
      {
        radiusXRatio: number;
        radiusYRatio: number;
        color: string;
        visible: boolean;
      }
    >
  >;
  selectedAxis?: VolumeAxis;
  slices: ViewerSlices;
  hasVolume: boolean;
  compact?: boolean;
  /** Per-plane colors for labels, badges, and crosshairs. */
  theme?: ViewerTheme;
  /** User-facing strings (English defaults otherwise). */
  labels?: AxisViewportLabels;
  /** Extra classes merged onto the root element. */
  className?: string;
  onSelectAxis: (
    axis: VolumeAxis,
  ) => (point: { xRatio: number; yRatio: number }) => void;
  onEditAxis?: (
    axis: VolumeAxis,
    point: { xRatio: number; yRatio: number },
    phase: 'start' | 'move' | 'end',
  ) => void;
  onProbeAxis?: (
    axis: VolumeAxis,
    point: { xRatio: number; yRatio: number } | null,
  ) => void;
  onCropAxis?: (
    axis: VolumeAxis,
    rect: {
      min: { xRatio: number; yRatio: number };
      max: { xRatio: number; yRatio: number };
      enabled: boolean;
    },
  ) => void;
  onAnnotationSelect?: (annotationId: string) => void;
  onAnnotationMove?: (
    axis: VolumeAxis,
    annotationId: string,
    point: { xRatio: number; yRatio: number },
  ) => void;
  onMeasurementComplete?: (
    axis: VolumeAxis,
    measurement: CompletedSliceMeasurement,
  ) => void;
  onWindowLevelDrag?: (
    delta: { x: number; y: number },
    phase: 'start' | 'move' | 'end',
  ) => void;
  onSelectedAxisChange?: (axis: VolumeAxis) => void;
  onZoomChange: (zoom: number) => void;
  layout?: AxisViewportLayout;
  /** Extra pane (e.g. the 3D viewport) placed by the `quad` layout. */
  extraPane?: ReactNode;
  /** Pane shown alone, filling the grid. */
  maximizedPane?: AxisViewportPaneId | null;
  onToggleMaximize?: (pane: AxisViewportPaneId) => void;
  /** Show the axis dropdown in compact mode (default true). */
  showAxisSelector?: boolean;
  invert?: boolean;
  measureMode?: MeasureMode;
  measurementShapes?: Partial<Record<VolumeAxis, SliceMeasurementShape[]>>;
  /** Wheel paging; also enables the step buttons in the slice navigator. */
  onSliceStep?: (axis: VolumeAxis, delta: number) => void;
  /** Enables the per-pane slice slider. */
  onSliceIndexChange?: (axis: VolumeAxis, index: number) => void;
  maximizeLabels?: { maximize: string; restore: string; previous: string; next: string; slice: string };
}

interface AxisViewportDefinition {
  axis: VolumeAxis;
  badge: string;
  color: string;
  label: string;
  orientation: string;
  image: SliceImage | null;
  status: string;
  crosshairPoint?: { x: number; y: number };
  crosshairSpace?: [number, number];
  crosshairColors: { vertical: string; horizontal: string };
  mmPerPixel?: { x: number; y: number };
  overlay?: SliceImage | null;
  cropRect?: NonNullable<AxisViewportGridProps['cropRects']>[VolumeAxis];
  annotations?: NonNullable<AxisViewportGridProps['annotations']>[VolumeAxis];
  brushPreview?: NonNullable<AxisViewportGridProps['brushPreviews']>[VolumeAxis];
  exportName: string;
  sliceIndex: number;
  sliceCount: number;
}

interface AxisViewportPaneProps {
  axisSelector?: React.ReactNode;
  definition: AxisViewportDefinition;
  compact: boolean;
  mprZoom: number;
  onSelect: (point: { xRatio: number; yRatio: number }) => void;
  onProbe?: (point: { xRatio: number; yRatio: number } | null) => void;
  onEdit?: (
    point: { xRatio: number; yRatio: number },
    phase: 'start' | 'move' | 'end',
  ) => void;
  onMeasurementComplete?: (measurement: CompletedSliceMeasurement) => void;
  onWindowLevelDrag?: (
    delta: { x: number; y: number },
    phase: 'start' | 'move' | 'end',
  ) => void;
  onCropRectChange?: NonNullable<AxisViewportGridProps['onCropAxis']>;
  onAnnotationSelect?: (annotationId: string) => void;
  onAnnotationMove?: (
    annotationId: string,
    point: { xRatio: number; yRatio: number },
  ) => void;
  onZoomChange: (zoom: number) => void;
  invert?: boolean;
  measureMode?: MeasureMode;
  measurementShapes?: SliceMeasurementShape[];
  onSliceStep?: (delta: number) => void;
  onSliceIndexChange?: (index: number) => void;
  maximized?: boolean;
  onToggleMaximize?: () => void;
  maximizeLabels: NonNullable<AxisViewportGridProps['maximizeLabels']>;
}

const DEFAULT_MAXIMIZE_LABELS: NonNullable<AxisViewportGridProps['maximizeLabels']> = {
  maximize: 'Maximize view',
  restore: 'Restore layout',
  previous: 'Previous slice',
  next: 'Next slice',
  slice: 'Slice',
};

function SliceNavigator({
  color,
  compact,
  index,
  count,
  labels,
  onStep,
  onChange,
}: {
  color: string;
  compact: boolean;
  index: number;
  count: number;
  labels: NonNullable<AxisViewportGridProps['maximizeLabels']>;
  onStep?: (delta: number) => void;
  onChange: (index: number) => void;
}) {
  const buttonClass = cn(
    'inline-flex shrink-0 items-center justify-center rounded text-slate-200 transition hover:bg-slate-800 active:bg-slate-700 disabled:opacity-40',
    compact ? 'h-10 w-10' : 'h-7 w-7',
  );
  return (
    <div
      className={cn(
        'pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex items-center gap-1 bg-gradient-to-t from-slate-950/90 via-slate-950/70 to-transparent px-2',
        compact ? 'pb-1.5 pt-4' : 'pb-1 pt-3',
      )}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {onStep ? (
        <button
          type="button"
          className={buttonClass}
          aria-label={labels.previous}
          title={labels.previous}
          disabled={index <= 0}
          onClick={() => onStep(-1)}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
      <input
        type="range"
        min={0}
        max={Math.max(0, count - 1)}
        step={1}
        value={index}
        aria-label={labels.slice}
        className={cn('min-w-0 flex-1 cursor-pointer', compact ? 'h-10' : 'h-6')}
        style={{ accentColor: color }}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      {onStep ? (
        <button
          type="button"
          className={buttonClass}
          aria-label={labels.next}
          title={labels.next}
          disabled={index >= count - 1}
          onClick={() => onStep(1)}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
      <span
        className="w-[4.5rem] shrink-0 text-right font-mono text-[11px] tabular-nums"
        style={{ color }}
      >
        {index + 1}/{count}
      </span>
    </div>
  );
}

function AxisViewportPane({
  axisSelector,
  compact,
  definition,
  mprZoom,
  onEdit,
  onMeasurementComplete,
  onProbe,
  onSelect,
  onWindowLevelDrag,
  onCropRectChange,
  onAnnotationSelect,
  onAnnotationMove,
  onZoomChange,
  invert,
  measureMode,
  measurementShapes,
  onSliceStep,
  onSliceIndexChange,
  maximized = false,
  onToggleMaximize,
  maximizeLabels,
}: AxisViewportPaneProps) {
  const subtitleLabelClass =
    'inline-flex items-center gap-1.5 text-[11px] text-slate-400';
  const axisBadgeClass =
    'rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] backdrop-blur-[1px]';
  const titleClass = 'font-semibold';

  return (
    <ViewportFrame
      title={
        <span className={titleClass} style={{ color: definition.color }}>
          {definition.label}
        </span>
      }
      subtitle={
        <span className={subtitleLabelClass}>
          <span
            className={axisBadgeClass}
            style={{
              color: definition.color,
              borderColor: `${definition.color}55`,
              backgroundColor: `${definition.color}22`,
            }}
          >
            {definition.badge}
          </span>
          {definition.orientation}
        </span>
      }
      status={definition.status}
      statusStyle={{
        color: definition.color,
        borderColor: `${definition.color}40`,
        backgroundColor: `${definition.color}14`,
      }}
      actions={
        axisSelector || onToggleMaximize ? (
          <>
            {axisSelector}
            {onToggleMaximize ? (
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-white/10 bg-slate-950/70 text-slate-300 transition hover:bg-slate-800 hover:text-slate-100"
                aria-label={maximized ? maximizeLabels.restore : maximizeLabels.maximize}
                title={maximized ? maximizeLabels.restore : maximizeLabels.maximize}
                onClick={onToggleMaximize}
              >
                {maximized ? (
                  <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            ) : null}
          </>
        ) : undefined
      }
    >
      <SliceCanvas
        image={definition.image}
        overlay={definition.overlay}
        crosshairPoint={definition.crosshairPoint}
        crosshairSpace={definition.crosshairSpace}
        crosshairColors={definition.crosshairColors}
        fit={SliceCanvasFit.Contain}
        zoom={mprZoom}
        onZoomChange={onZoomChange}
        onEdit={onEdit}
        onWindowLevelDrag={onWindowLevelDrag}
        onProbe={onProbe}
        onMeasurementComplete={onMeasurementComplete}
        onSelect={onSelect}
        cropRect={definition.cropRect}
        onCropRectChange={(rect) => onCropRectChange?.(definition.axis, rect)}
        annotations={definition.annotations}
        brushPreview={definition.brushPreview}
        onAnnotationSelect={onAnnotationSelect}
        onAnnotationMove={onAnnotationMove}
        mmPerPixel={definition.mmPerPixel}
        exportName={definition.exportName}
        invert={invert}
        measureMode={measureMode}
        measurementShapes={measurementShapes}
        onSliceStep={onSliceStep}
      />
      {onSliceIndexChange && definition.sliceCount > 1 ? (
        <SliceNavigator
          color={definition.color}
          compact={compact}
          index={definition.sliceIndex}
          count={definition.sliceCount}
          labels={maximizeLabels}
          onStep={onSliceStep}
          onChange={onSliceIndexChange}
        />
      ) : null}
    </ViewportFrame>
  );
}

function resolveAxisDefinitions(
  cursor: VolumeCursor | null,
  dimensions: Vec3,
  spacing: Vec3,
  slices: ViewerSlices,
  hasVolume: boolean,
  theme: ViewerTheme,
  labels: AxisViewportLabels,
  overlays?: Partial<Record<VolumeAxis, SliceImage | null>>,
  cropRects?: AxisViewportGridProps['cropRects'],
  annotations?: AxisViewportGridProps['annotations'],
  brushPreviews?: AxisViewportGridProps['brushPreviews'],
): Record<VolumeAxis, AxisViewportDefinition> {
  const planeColors = theme.planeColors;
  return {
    [VolumeAxis.Coronal]: {
      axis: VolumeAxis.Coronal,
      badge: 'XZ',
      color: planeColors.coronal,
      label: labels.coronal.label,
      orientation: labels.coronal.orientation,
      image: slices.coronal,
      overlay: overlays?.[VolumeAxis.Coronal],
      cropRect: cropRects?.[VolumeAxis.Coronal],
      annotations: annotations?.[VolumeAxis.Coronal],
      brushPreview: brushPreviews?.[VolumeAxis.Coronal],
      status: cursor
        ? labels.status(
            VolumeAxis.Coronal,
            cursor.y + 1,
            Math.max(1, dimensions[1]),
          )
        : labels.noVolume,
      crosshairPoint: cursor
        ? { x: cursor.x, y: dimensions[2] - 1 - cursor.z }
        : undefined,
      crosshairSpace: hasVolume ? [dimensions[0], dimensions[2]] : undefined,
      crosshairColors: {
        vertical: planeColors.sagittal,
        horizontal: planeColors.axial,
      },
      mmPerPixel: hasVolume ? { x: spacing[0], y: spacing[2] } : undefined,
      exportName: 'coronal',
      sliceIndex: cursor?.y ?? 0,
      sliceCount: Math.max(1, dimensions[1]),
    },
    [VolumeAxis.Sagittal]: {
      axis: VolumeAxis.Sagittal,
      badge: 'YZ',
      color: planeColors.sagittal,
      label: labels.sagittal.label,
      orientation: labels.sagittal.orientation,
      image: slices.sagittal,
      overlay: overlays?.[VolumeAxis.Sagittal],
      cropRect: cropRects?.[VolumeAxis.Sagittal],
      annotations: annotations?.[VolumeAxis.Sagittal],
      brushPreview: brushPreviews?.[VolumeAxis.Sagittal],
      status: cursor
        ? labels.status(
            VolumeAxis.Sagittal,
            cursor.x + 1,
            Math.max(1, dimensions[0]),
          )
        : labels.noVolume,
      crosshairPoint: cursor
        ? { x: cursor.y, y: dimensions[2] - 1 - cursor.z }
        : undefined,
      crosshairSpace: hasVolume ? [dimensions[1], dimensions[2]] : undefined,
      crosshairColors: {
        vertical: planeColors.coronal,
        horizontal: planeColors.axial,
      },
      mmPerPixel: hasVolume ? { x: spacing[1], y: spacing[2] } : undefined,
      exportName: 'sagittal',
      sliceIndex: cursor?.x ?? 0,
      sliceCount: Math.max(1, dimensions[0]),
    },
    [VolumeAxis.Axial]: {
      axis: VolumeAxis.Axial,
      badge: 'XY',
      color: planeColors.axial,
      label: labels.axial.label,
      orientation: labels.axial.orientation,
      image: slices.axial,
      overlay: overlays?.[VolumeAxis.Axial],
      cropRect: cropRects?.[VolumeAxis.Axial],
      annotations: annotations?.[VolumeAxis.Axial],
      brushPreview: brushPreviews?.[VolumeAxis.Axial],
      status: cursor
        ? labels.status(
            VolumeAxis.Axial,
            cursor.z + 1,
            Math.max(1, dimensions[2]),
          )
        : labels.noVolume,
      crosshairPoint: cursor ? { x: cursor.x, y: cursor.y } : undefined,
      crosshairSpace: hasVolume ? [dimensions[0], dimensions[1]] : undefined,
      crosshairColors: {
        vertical: planeColors.sagittal,
        horizontal: planeColors.coronal,
      },
      mmPerPixel: hasVolume ? { x: spacing[0], y: spacing[1] } : undefined,
      exportName: 'axial',
      sliceIndex: cursor?.z ?? 0,
      sliceCount: Math.max(1, dimensions[2]),
    },
  };
}

export function AxisViewportGrid({
  compact = false,
  cursor,
  dimensions,
  spacing,
  mprZoom,
  overlays,
  cropRects,
  annotations,
  brushPreviews,
  selectedAxis = VolumeAxis.Coronal,
  slices,
  hasVolume,
  theme = defaultViewerTheme,
  labels = defaultAxisViewportLabels,
  className,
  onSelectAxis,
  onEditAxis,
  onProbeAxis,
  onCropAxis,
  onAnnotationSelect,
  onAnnotationMove,
  onMeasurementComplete,
  onSelectedAxisChange,
  onWindowLevelDrag,
  onZoomChange,
  layout = 'row',
  extraPane,
  maximizedPane = null,
  onToggleMaximize,
  showAxisSelector = true,
  invert,
  measureMode,
  measurementShapes,
  onSliceStep,
  onSliceIndexChange,
  maximizeLabels = DEFAULT_MAXIMIZE_LABELS,
}: AxisViewportGridProps) {
  const axisSelector = (
    <label className="pointer-events-auto">
      <span className="sr-only">{labels.selectAxisView}</span>
      <Select
        variant="overlay"
        size="sm"
        value={selectedAxis}
        onChange={(value) => onSelectedAxisChange?.(value as VolumeAxis)}
        options={[
          { value: VolumeAxis.Coronal, label: labels.options.coronal },
          { value: VolumeAxis.Sagittal, label: labels.options.sagittal },
          { value: VolumeAxis.Axial, label: labels.options.axial },
        ]}
      />
    </label>
  );
  const axisDefinitions = resolveAxisDefinitions(
    cursor,
    dimensions,
    spacing,
    slices,
    hasVolume,
    theme,
    labels,
    overlays,
    cropRects,
    annotations,
    brushPreviews,
  );

  const renderPane = (axis: VolumeAxis, paneCompact: boolean) => (
    <AxisViewportPane
      key={axis}
      compact={paneCompact}
      definition={axisDefinitions[axis]}
      axisSelector={paneCompact && showAxisSelector ? axisSelector : undefined}
      mprZoom={mprZoom}
      onZoomChange={onZoomChange}
      onEdit={
        onEditAxis ? (point, phase) => onEditAxis(axis, point, phase) : undefined
      }
      onProbe={(point) => onProbeAxis?.(axis, point)}
      onMeasurementComplete={(measurement) =>
        onMeasurementComplete?.(axis, measurement)
      }
      onWindowLevelDrag={onWindowLevelDrag}
      onCropRectChange={onCropAxis}
      onAnnotationSelect={onAnnotationSelect}
      onAnnotationMove={(annotationId, point) =>
        onAnnotationMove?.(axis, annotationId, point)
      }
      onSelect={onSelectAxis(axis)}
      invert={invert}
      measureMode={measureMode}
      measurementShapes={measurementShapes?.[axis]}
      onSliceStep={onSliceStep ? (delta) => onSliceStep(axis, delta) : undefined}
      onSliceIndexChange={
        onSliceIndexChange ? (index) => onSliceIndexChange(axis, index) : undefined
      }
      maximized={!paneCompact && maximizedPane === axis}
      onToggleMaximize={
        onToggleMaximize && !paneCompact ? () => onToggleMaximize(axis) : undefined
      }
      maximizeLabels={maximizeLabels}
    />
  );

  if (compact) {
    return (
      <div className={cn('min-h-0 min-w-0 bg-slate-800', className)}>
        {renderPane(selectedAxis, true)}
      </div>
    );
  }

  if (maximizedPane) {
    return (
      <div className={cn('grid min-h-0 min-w-0 grid-cols-1 bg-slate-800', className)}>
        {maximizedPane === 'extra' ? extraPane : renderPane(maximizedPane, false)}
      </div>
    );
  }

  if (layout === 'quad') {
    return (
      <div
        className={cn(
          'grid min-h-0 min-w-0 grid-cols-2 grid-rows-2 gap-px bg-slate-800',
          className,
        )}
      >
        {renderPane(VolumeAxis.Axial, false)}
        {extraPane ? (
          <div className="min-h-0 min-w-0">{extraPane}</div>
        ) : (
          renderPane(VolumeAxis.Coronal, false)
        )}
        {extraPane ? renderPane(VolumeAxis.Coronal, false) : null}
        {renderPane(VolumeAxis.Sagittal, false)}
      </div>
    );
  }

  if (layout === 'focus') {
    const others = [VolumeAxis.Axial, VolumeAxis.Coronal, VolumeAxis.Sagittal].filter(
      (axis) => axis !== selectedAxis,
    );
    return (
      <div
        className={cn(
          'grid min-h-0 min-w-0 grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] grid-rows-2 gap-px bg-slate-800',
          className,
        )}
      >
        <div className="row-span-2 min-h-0 min-w-0">
          {renderPane(selectedAxis, false)}
        </div>
        {others.map((axis) => renderPane(axis, false))}
      </div>
    );
  }

  const axes = [VolumeAxis.Coronal, VolumeAxis.Sagittal, VolumeAxis.Axial];
  return (
    <div
      className={cn(
        'grid min-h-0 min-w-0 grid-cols-3 gap-px bg-slate-800',
        className,
      )}
    >
      {axes.map((axis) => renderPane(axis, false))}
    </div>
  );
}
