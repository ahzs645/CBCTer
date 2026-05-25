import type { TFunction } from 'i18next';
import { PLANE_COLORS } from '../constants';
import { useTranslation } from '../i18n';
import type { SliceImage, Vec3, ViewerSlices, VolumeCursor } from '../types';
import { VolumeAxis } from '../types';
import { Select } from './Select';
import { SliceCanvas } from './SliceCanvas';
import { SliceCanvasFit } from './SliceCanvas.constants';
import { ViewportFrame } from './ViewportFrame';

interface AxisViewportGridProps {
  cursor: { x: number; y: number; z: number } | null;
  dimensions: Vec3;
  mprZoom: number;
  selectedAxis?: VolumeAxis;
  slices: ViewerSlices;
  hasVolume: boolean;
  compact?: boolean;
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
  labelKey: string;
  orientationKey: string;
  image: SliceImage | null;
  status: string;
  crosshairPoint?: { x: number; y: number };
  crosshairSpace?: [number, number];
  crosshairColors: { vertical: string; horizontal: string };
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
  const { t } = useTranslation();
  const subtitleLabelClass =
    'inline-flex items-center gap-1.5 text-[11px] text-slate-400';
  const axisBadgeClass =
    'rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] backdrop-blur-[1px]';
  const titleClass = 'font-semibold';

  return (
    <ViewportFrame
      title={
        <span className={titleClass} style={{ color: definition.color }}>
          {t(definition.labelKey)}
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
          {t(definition.orientationKey)}
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
        crosshairPoint={definition.crosshairPoint}
        crosshairSpace={definition.crosshairSpace}
        crosshairColors={definition.crosshairColors}
        fit={SliceCanvasFit.Contain}
        zoom={mprZoom}
        onZoomChange={onZoomChange}
        onSelect={onSelect}
      />
    </ViewportFrame>
  );
}

function resolveAxisDefinitions(
  cursor: VolumeCursor | null,
  dimensions: Vec3,
  slices: ViewerSlices,
  hasVolume: boolean,
  t: TFunction<'translation', undefined>,
): Record<VolumeAxis, AxisViewportDefinition> {
  return {
    [VolumeAxis.Coronal]: {
      axis: VolumeAxis.Coronal,
      badge: 'XZ',
      color: PLANE_COLORS.coronal,
      labelKey: 'axisViewport.coronal.label',
      orientationKey: 'axisViewport.coronal.orientation',
      image: slices.coronal,
      status: cursor
        ? t('axisViewport.coronal.status', {
            current: cursor.y + 1,
            total: Math.max(1, dimensions[1]),
          })
        : t('axisViewport.noVolume'),
      crosshairPoint: cursor
        ? { x: cursor.x, y: dimensions[2] - 1 - cursor.z }
        : undefined,
      crosshairSpace: hasVolume ? [dimensions[0], dimensions[2]] : undefined,
      crosshairColors: {
        vertical: PLANE_COLORS.sagittal,
        horizontal: PLANE_COLORS.axial,
      },
    },
    [VolumeAxis.Sagittal]: {
      axis: VolumeAxis.Sagittal,
      badge: 'YZ',
      color: PLANE_COLORS.sagittal,
      labelKey: 'axisViewport.sagittal.label',
      orientationKey: 'axisViewport.sagittal.orientation',
      image: slices.sagittal,
      status: cursor
        ? t('axisViewport.sagittal.status', {
            current: cursor.x + 1,
            total: Math.max(1, dimensions[0]),
          })
        : t('axisViewport.noVolume'),
      crosshairPoint: cursor
        ? { x: cursor.y, y: dimensions[2] - 1 - cursor.z }
        : undefined,
      crosshairSpace: hasVolume ? [dimensions[1], dimensions[2]] : undefined,
      crosshairColors: {
        vertical: PLANE_COLORS.coronal,
        horizontal: PLANE_COLORS.axial,
      },
    },
    [VolumeAxis.Axial]: {
      axis: VolumeAxis.Axial,
      badge: 'XY',
      color: PLANE_COLORS.axial,
      labelKey: 'axisViewport.axial.label',
      orientationKey: 'axisViewport.axial.orientation',
      image: slices.axial,
      status: cursor
        ? t('axisViewport.axial.status', {
            current: cursor.z + 1,
            total: Math.max(1, dimensions[2]),
          })
        : t('axisViewport.noVolume'),
      crosshairPoint: cursor ? { x: cursor.x, y: cursor.y } : undefined,
      crosshairSpace: hasVolume ? [dimensions[0], dimensions[1]] : undefined,
      crosshairColors: {
        vertical: PLANE_COLORS.sagittal,
        horizontal: PLANE_COLORS.coronal,
      },
    },
  };
}

export function AxisViewportGrid({
  compact = false,
  cursor,
  dimensions,
  mprZoom,
  selectedAxis = VolumeAxis.Coronal,
  slices,
  hasVolume,
  onSelectAxis,
  onSelectedAxisChange,
  onZoomChange,
}: AxisViewportGridProps) {
  const { t } = useTranslation();
  const axisSelector = (
    <label className="pointer-events-auto">
      <span className="sr-only">{t('axisViewport.selectAxisView')}</span>
      <Select
        variant="overlay"
        size="sm"
        value={selectedAxis}
        onChange={(value) => onSelectedAxisChange?.(value as VolumeAxis)}
        options={[
          { value: VolumeAxis.Coronal, label: t('axisViewport.options.coronal') },
          { value: VolumeAxis.Sagittal, label: t('axisViewport.options.sagittal') },
          { value: VolumeAxis.Axial, label: t('axisViewport.options.axial') },
        ]}
      />
    </label>
  );
  const axisDefinitions = resolveAxisDefinitions(
    cursor,
    dimensions,
    slices,
    hasVolume,
    t,
  );
  const axes = [VolumeAxis.Coronal, VolumeAxis.Sagittal, VolumeAxis.Axial];

  if (compact) {
    return (
      <div className="min-h-0 min-w-0 bg-slate-800">
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
    <div className="grid min-h-0 min-w-0 grid-cols-3 gap-px bg-slate-800">
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
