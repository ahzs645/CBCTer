import {
  Camera,
  CircleHelp,
  FileArchive,
  FileText,
  Layers3,
  LayoutGrid,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  ScanLine,
  SunMoon,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { StudyTool } from '../../domain/types';
import { useTranslation } from '../../i18n';
import type {
  DentalWindowPreset,
  DentalWindowPresetId,
} from '../../lib/dental/windowPresets';
import { cn } from '../../utils/cn';
import { Select } from '../Select';
import { DENTAL_TOOLS, type DentalLayout } from './tools';

interface DentalToolbarProps {
  scanLabel: string;
  formatLabel?: string;
  activeTool: StudyTool;
  presets: DentalWindowPreset[];
  activePresetId: DentalWindowPresetId | null;
  invert: boolean;
  zoom: number;
  layout: DentalLayout;
  sidebarVisible: boolean;
  onToolChange: (tool: StudyTool) => void;
  onPresetChange: (id: DentalWindowPresetId) => void;
  onInvertChange: (invert: boolean) => void;
  onZoomChange: (zoom: number) => void;
  onLayoutChange: (layout: DentalLayout) => void;
  onSnapshot: () => void;
  onReport: () => void;
  onExportPackage: () => void;
  onOpenPanoramic: () => void;
  onOpenTeeth: () => void;
  onShowShortcuts: () => void;
  onSidebarVisibleChange: (visible: boolean) => void;
}

function Divider() {
  return <span className="mx-1 h-6 w-px shrink-0 bg-slate-800" aria-hidden="true" />;
}

function IconButton({
  label,
  active = false,
  onClick,
  children,
  showLabel = false,
  shortcut,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  showLabel?: boolean;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded border px-2 text-xs transition',
        active
          ? 'border-sky-500/70 bg-sky-500/15 text-sky-100'
          : 'border-transparent text-slate-300 hover:border-slate-700 hover:bg-slate-900 hover:text-slate-100',
      )}
    >
      {children}
      {showLabel ? <span className="hidden 2xl:inline">{label}</span> : null}
    </button>
  );
}

const ZOOM_STEP = 1.25;

export function DentalToolbar({
  scanLabel,
  formatLabel,
  activeTool,
  presets,
  activePresetId,
  invert,
  zoom,
  layout,
  sidebarVisible,
  onToolChange,
  onPresetChange,
  onInvertChange,
  onZoomChange,
  onLayoutChange,
  onSnapshot,
  onReport,
  onExportPackage,
  onOpenPanoramic,
  onOpenTeeth,
  onShowShortcuts,
  onSidebarVisibleChange,
}: DentalToolbarProps) {
  const { t } = useTranslation();

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-slate-800 bg-slate-950 px-2">
      <div className="mr-1 min-w-0 max-w-[14rem] shrink">
        <div className="truncate text-sm font-semibold text-slate-100" title={scanLabel}>
          {scanLabel}
        </div>
        {formatLabel ? (
          <div className="truncate text-[11px] text-slate-500">{formatLabel}</div>
        ) : null}
      </div>
      <Divider />

      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
        role="toolbar"
        aria-label={t('dental.toolbar.tools')}
      >
        <div className="flex items-center gap-0.5 rounded-md border border-slate-800 bg-slate-900/60 p-0.5">
          {DENTAL_TOOLS.map((item) => {
            const Icon = item.icon;
            return (
              <IconButton
                key={item.tool}
                label={t(`dental.toolbar.${item.labelKey}`)}
                shortcut={item.shortcut}
                active={activeTool === item.tool}
                showLabel
                onClick={() =>
                  onToolChange(
                    activeTool === item.tool && item.tool !== 'crosshair'
                      ? 'crosshair'
                      : item.tool,
                  )
                }
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            );
          })}
        </div>
        <Divider />

        <Select
          size="sm"
          aria-label={t('dental.presets.title')}
          value={activePresetId ?? ''}
          onChange={(value) => onPresetChange(value as DentalWindowPresetId)}
          buttonClassName="min-w-[8.5rem]"
          options={[
            ...(activePresetId
              ? []
              : [{ value: '', label: t('dental.presets.title') }]),
            ...presets.map((preset, index) => ({
              value: preset.id,
              label: `${index + 1} · ${t(`dental.presets.${preset.id}`)}`,
            })),
          ]}
        />
        <IconButton
          label={t('dental.toolbar.invert')}
          shortcut="I"
          active={invert}
          showLabel
          onClick={() => onInvertChange(!invert)}
        >
          <SunMoon className="h-4 w-4" aria-hidden="true" />
        </IconButton>
        <Divider />

        <IconButton
          label={t('dental.toolbar.zoomOut')}
          shortcut="-"
          onClick={() => onZoomChange(zoom / ZOOM_STEP)}
        >
          <ZoomOut className="h-4 w-4" aria-hidden="true" />
        </IconButton>
        <span className="w-10 shrink-0 text-center font-mono text-[11px] tabular-nums text-slate-400">
          {zoom.toFixed(1)}×
        </span>
        <IconButton
          label={t('dental.toolbar.zoomIn')}
          shortcut="+"
          onClick={() => onZoomChange(zoom * ZOOM_STEP)}
        >
          <ZoomIn className="h-4 w-4" aria-hidden="true" />
        </IconButton>
        <IconButton
          label={t('dental.toolbar.resetView')}
          shortcut="0"
          onClick={() => onZoomChange(1)}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </IconButton>
        <Divider />

        <span className="inline-flex shrink-0 items-center gap-1 text-slate-500">
          <LayoutGrid className="h-4 w-4" aria-hidden="true" />
          <Select
            size="sm"
            aria-label={t('dental.toolbar.layout')}
            value={layout}
            onChange={(value) => onLayoutChange(value as DentalLayout)}
            options={[
              { value: 'quad', label: t('dental.toolbar.layoutQuad') },
              { value: 'focus', label: t('dental.toolbar.layoutFocus') },
              { value: '3d', label: t('dental.toolbar.layout3d') },
            ]}
          />
        </span>
      </div>

      <Divider />
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton label={t('dental.toolbar.panoramic')} showLabel onClick={onOpenPanoramic}>
          <ScanLine className="h-4 w-4" aria-hidden="true" />
        </IconButton>
        <IconButton label={t('dental.toolbar.teeth')} onClick={onOpenTeeth}>
          <Layers3 className="h-4 w-4" aria-hidden="true" />
        </IconButton>
        <IconButton label={t('dental.toolbar.snapshot')} shortcut="S" onClick={onSnapshot}>
          <Camera className="h-4 w-4" aria-hidden="true" />
        </IconButton>
        <IconButton label={t('dental.toolbar.report')} showLabel onClick={onReport}>
          <FileText className="h-4 w-4" aria-hidden="true" />
        </IconButton>
        <IconButton label={t('dental.toolbar.exportPackage')} onClick={onExportPackage}>
          <FileArchive className="h-4 w-4" aria-hidden="true" />
        </IconButton>
        <IconButton label={t('dental.toolbar.shortcuts')} shortcut="?" onClick={onShowShortcuts}>
          <CircleHelp className="h-4 w-4" aria-hidden="true" />
        </IconButton>
        <IconButton
          label={sidebarVisible ? t('dental.toolbar.hidePanel') : t('dental.toolbar.showPanel')}
          active={sidebarVisible}
          onClick={() => onSidebarVisibleChange(!sidebarVisible)}
        >
          {sidebarVisible ? (
            <PanelRightClose className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
          )}
        </IconButton>
      </div>
    </header>
  );
}
