import {
  Contrast,
  Crosshair,
  Ellipsis,
  Ruler,
  Smile,
  X,
} from 'lucide-react';
import { type PointerEvent, type ReactNode, useRef, useState } from 'react';
import { useTranslation } from '../../i18n';
import { PLANE_COLORS } from '../../constants';
import { VolumeAxis } from '../../types';
import { cn } from '../../utils/cn';

export type MobileView = VolumeAxis | '3d';
export type MobileSheet = 'contrast' | 'measure' | 'chart' | 'more';

const VIEW_COLORS: Record<MobileView, string> = {
  [VolumeAxis.Axial]: PLANE_COLORS.axial,
  [VolumeAxis.Coronal]: PLANE_COLORS.coronal,
  [VolumeAxis.Sagittal]: PLANE_COLORS.sagittal,
  '3d': '#e2e8f0',
};

export function MobileTopBar({
  scanLabel,
  view,
  onViewChange,
}: {
  scanLabel: string;
  view: MobileView;
  onViewChange: (view: MobileView) => void;
}) {
  const { t } = useTranslation();
  const views: Array<{ id: MobileView; label: string }> = [
    { id: VolumeAxis.Axial, label: t('dental.views.axial') },
    { id: VolumeAxis.Coronal, label: t('dental.views.coronal') },
    { id: VolumeAxis.Sagittal, label: t('dental.views.sagittal') },
    { id: '3d', label: t('dental.views.threeD') },
  ];
  return (
    <header className="shrink-0 border-b border-slate-800 bg-slate-950 px-2 pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))]">
      <div className="truncate px-1 pb-1 text-xs font-medium text-slate-300" title={scanLabel}>
        {scanLabel}
      </div>
      <div className="grid grid-cols-4 gap-1" role="tablist">
        {views.map((item) => {
          const active = item.id === view;
          const color = VIEW_COLORS[item.id];
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onViewChange(item.id)}
              className={cn(
                'h-9 rounded border text-xs font-semibold transition',
                active
                  ? 'bg-slate-800 text-slate-50'
                  : 'border-slate-800 text-slate-400 active:bg-slate-900',
              )}
              style={active ? { borderColor: color, color } : undefined}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </header>
  );
}

export function MobileDock({
  activeSheet,
  navigateActive,
  measureActive,
  contrastActive,
  chartCount,
  onNavigate,
  onSheetChange,
}: {
  activeSheet: MobileSheet | null;
  navigateActive: boolean;
  measureActive: boolean;
  contrastActive: boolean;
  chartCount: number;
  onNavigate: () => void;
  onSheetChange: (sheet: MobileSheet | null) => void;
}) {
  const { t } = useTranslation();
  const item = (
    key: string,
    label: string,
    icon: ReactNode,
    active: boolean,
    onClick: () => void,
    badge?: number,
  ) => (
    <button
      key={key}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'relative flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] transition',
        active ? 'bg-sky-500/15 text-sky-100' : 'text-slate-400 active:bg-slate-900',
      )}
    >
      {icon}
      <span className="max-w-full truncate px-0.5">{label}</span>
      {badge ? (
        <span className="absolute right-2 top-1 min-w-4 rounded-full bg-sky-500 px-1 text-[10px] font-semibold leading-4 text-slate-950">
          {badge}
        </span>
      ) : null}
    </button>
  );
  const toggle = (sheet: MobileSheet) =>
    onSheetChange(activeSheet === sheet ? null : sheet);

  return (
    <nav className="grid shrink-0 grid-cols-5 gap-1 border-t border-slate-800 bg-slate-950 px-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-1.5">
      {item(
        'navigate',
        t('dental.toolbar.navigate'),
        <Crosshair className="h-5 w-5" aria-hidden="true" />,
        navigateActive && activeSheet == null,
        onNavigate,
      )}
      {item(
        'measure',
        t('dental.toolbar.measure'),
        <Ruler className="h-5 w-5" aria-hidden="true" />,
        activeSheet === 'measure' || measureActive,
        () => toggle('measure'),
      )}
      {item(
        'contrast',
        t('dental.toolbar.contrast'),
        <Contrast className="h-5 w-5" aria-hidden="true" />,
        activeSheet === 'contrast' || contrastActive,
        () => toggle('contrast'),
      )}
      {item(
        'chart',
        t('dental.chart.tab'),
        <Smile className="h-5 w-5" aria-hidden="true" />,
        activeSheet === 'chart',
        () => toggle('chart'),
        chartCount,
      )}
      {item(
        'more',
        t('dental.toolbar.more'),
        <Ellipsis className="h-5 w-5" aria-hidden="true" />,
        activeSheet === 'more',
        () => toggle('more'),
      )}
    </nav>
  );
}

const DISMISS_DRAG_PX = 80;

export function BottomSheet({
  title,
  onClose,
  children,
  tall = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Use most of the screen (forms); short sheets keep the image visible. */
  tall?: boolean;
}) {
  const { t } = useTranslation();
  const [dragOffset, setDragOffset] = useState(0);
  const dragStartRef = useRef<number | null>(null);

  // Drag the grab handle / header down to dismiss, like a native sheet.
  const onDragStart = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    dragStartRef.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onDragMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current == null) return;
    setDragOffset(Math.max(0, event.clientY - dragStartRef.current));
  };
  const onDragEnd = () => {
    if (dragStartRef.current == null) return;
    dragStartRef.current = null;
    if (dragOffset > DISMISS_DRAG_PX) onClose();
    setDragOffset(0);
  };

  return (
    // Covers the bottom dock: the sheet sits above the whole viewer.
    <section
      role="dialog"
      aria-label={title}
      className={cn(
        'absolute inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t border-slate-700 bg-slate-900/97 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_32px_rgba(0,0,0,0.45)] backdrop-blur',
        tall ? 'max-h-[85dvh]' : 'max-h-[55dvh]',
        dragOffset === 0 && 'transition-transform duration-150',
      )}
      style={{ transform: dragOffset ? `translateY(${dragOffset}px)` : undefined }}
    >
      <div
        className="shrink-0 touch-none select-none"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <div className="flex justify-center pb-1 pt-2">
          <span className="h-1 w-10 rounded-full bg-slate-600" aria-hidden="true" />
        </div>
        <div className="flex items-center justify-between px-3 pb-2">
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('dental.shortcuts.close')}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-400 active:bg-slate-800"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
        {children}
      </div>
    </section>
  );
}

export function MobileActionButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'flex min-h-12 items-center gap-2 rounded-lg border px-3 text-left text-sm transition disabled:opacity-40',
        active
          ? 'border-sky-500/70 bg-sky-500/15 text-sky-100'
          : 'border-slate-700 bg-slate-950 text-slate-200 active:bg-slate-800',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">{label}</span>
    </button>
  );
}
