import type { SliceImage, Vec3, ViewerSlices, VolumeCursor } from '../../types';
import { VolumeAxis } from '../../types';
import { Select } from '../../components/Select';
import { cn } from '../../utils/cn';
import { defaultAxisViewportLabels, type AxisViewportLabels } from '../labels';
import { defaultViewerTheme, type ViewerTheme } from '../theme';
import { SliceCanvas } from './SliceCanvas';
import { SliceCanvasFit } from './SliceCanvas.constants';
import { ViewportFrame } from './ViewportFrame';

interface AxisViewportGridProps {
  cursor: { x: number; y: number; z: number } | null;
  dimensions: Vec3;
  spacing: Vec3;
  mprZoom: number;
  overlays?: Partial<Record<VolumeAxis, SliceImage | null>>;
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
  exportName: string;
}

interface AxisViewportPaneProps {
  axisSelector?: React.ReactNode;
  definition: AxisViewportDefinition;
  compact: boolean;
  mprZoom: number;
  onSelect: (point: { xRatio: number; yRatio: number }) => void;
  onZoomChange: (zoom: number) => void;
}

function AxisViewportPane({
  axisSelector,
  compact,
  definition,
  mprZoom,
  onSelect,
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
        onSelect={onSelect}
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
  selectedAxis = VolumeAxis.Coronal,
  slices,
  hasVolume,
  theme = defaultViewerTheme,
  labels = defaultAxisViewportLabels,
  className,
  onSelectAxis,
  onSelectedAxisChange,
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
          onSelect={onSelectAxis(axis)}
        />
      ))}
    </div>
  );
}
