import { useTranslation } from '../../i18n';
import type { SliceWindowLevel, Vec3, VolumeCursor } from '../../types';

interface ViewerStatusBarProps {
  cursor: VolumeCursor | null;
  dimensions: Vec3;
  spacing: Vec3;
  windowLevel: SliceWindowLevel;
  zoom: number;
  probe: { voxel: [number, number, number]; value: number; label?: string } | null;
  toolHint: string;
}

/** Desktop footer: crosshair position, hovered value, contrast, zoom. */
export function ViewerStatusBar({
  cursor,
  dimensions,
  spacing,
  windowLevel,
  zoom,
  probe,
  toolHint,
}: ViewerStatusBarProps) {
  const { t } = useTranslation();
  const mm = cursor
    ? [cursor.x * spacing[0], cursor.y * spacing[1], cursor.z * spacing[2]]
        .map((value) => value.toFixed(1))
        .join(', ')
    : '—';
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 overflow-hidden border-t border-slate-800 bg-slate-950 px-3 font-mono text-[11px] text-slate-400">
      <span className="shrink-0">
        {t('dental.status.position')}{' '}
        <span className="text-slate-200">{mm} mm</span>
      </span>
      {cursor ? (
        <span className="hidden shrink-0 lg:inline">
          Z {cursor.z + 1}/{dimensions[2]} · Y {cursor.y + 1}/{dimensions[1]} · X{' '}
          {cursor.x + 1}/{dimensions[0]}
        </span>
      ) : null}
      <span className="shrink-0">
        {t('dental.status.value')}{' '}
        <span className="text-slate-200">
          {probe ? `${probe.value}${probe.label ? ` · ${probe.label}` : ''}` : '—'}
        </span>
      </span>
      <span className="shrink-0">
        {t('dental.status.windowLevel', {
          window: windowLevel.window,
          level: windowLevel.level,
        })}
      </span>
      <span className="shrink-0">
        {t('dental.status.zoom')} {zoom.toFixed(1)}×
      </span>
      <span className="ml-auto truncate font-sans text-slate-500">{toolHint}</span>
    </footer>
  );
}
