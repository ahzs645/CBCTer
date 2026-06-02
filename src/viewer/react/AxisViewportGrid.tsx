import type { SliceImage, Vec3, ViewerSlices, VolumeCursor } from '../../types';
import { VolumeAxis } from '../../types';
import { Select } from '../../components/Select';
import { cn } from '../../utils/cn';
import { defaultAxisViewportLabels, type AxisViewportLabels } from '../labels';
import { defaultViewerTheme, type ViewerTheme } from '../theme';
import { SliceCanvas } from './SliceCanvas';
import { SliceCanvasFit } from './SliceCanvas.constants';
import { ViewportFrame } from './ViewportFrame';
import type { CompletedSliceMeasurement } from './MeasurementOverlay';

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
      actions={compact ? axisSelector : undefined}
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
      />
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
  const axes = [VolumeAxis.Coronal, VolumeAxis.Sagittal, VolumeAxis.Axial];

  if (compact) {
    return (
      <div className={cn('min-h-0 min-w-0 bg-slate-800', className)}>
        <AxisViewportPane
          compact
          definition={axisDefinitions[selectedAxis]}
          axisSelector={axisSelector}
          mprZoom={mprZoom}
          onZoomChange={onZoomChange}
          onEdit={
            onEditAxis
              ? (point, phase) => onEditAxis(selectedAxis, point, phase)
              : undefined
          }
          onProbe={(point) => onProbeAxis?.(selectedAxis, point)}
          onMeasurementComplete={(measurement) =>
            onMeasurementComplete?.(selectedAxis, measurement)
          }
          onWindowLevelDrag={onWindowLevelDrag}
          onCropRectChange={onCropAxis}
          onAnnotationSelect={onAnnotationSelect}
          onAnnotationMove={(annotationId, point) =>
            onAnnotationMove?.(selectedAxis, annotationId, point)
          }
          onSelect={onSelectAxis(selectedAxis)}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'grid min-h-0 min-w-0 grid-cols-3 gap-px bg-slate-800',
        className,
      )}
    >
      {axes.map((axis) => (
        <AxisViewportPane
          key={axis}
          compact={false}
          definition={axisDefinitions[axis]}
          mprZoom={mprZoom}
          onZoomChange={onZoomChange}
          onEdit={
            onEditAxis
              ? (point, phase) => onEditAxis(axis, point, phase)
              : undefined
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
        />
      ))}
    </div>
  );
}
