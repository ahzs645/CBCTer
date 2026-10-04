import { Download, Eye, EyeOff, LocateFixed, Trash2 } from 'lucide-react';
import type { StudyMeasurement } from '../../domain/types';
import { useTranslation } from '../../i18n';
import {
  formatMeasurementValue,
  measurementSliceNumber,
} from '../../lib/dental/report';
import { cn } from '../../utils/cn';
import { Button } from '../Button';

interface MeasurementsPanelProps {
  measurements: StudyMeasurement[];
  activeMeasurementId?: string;
  touch?: boolean;
  onGoTo: (measurement: StudyMeasurement) => void;
  onToggleVisible: (measurementId: string) => void;
  onRename: (measurementId: string, name: string) => void;
  onDelete: (measurementId: string) => void;
  onDeleteAll: () => void;
  onExportCsv: () => void;
}

export function MeasurementsPanel({
  measurements,
  activeMeasurementId,
  touch = false,
  onGoTo,
  onToggleVisible,
  onRename,
  onDelete,
  onDeleteAll,
  onExportCsv,
}: MeasurementsPanelProps) {
  const { t } = useTranslation();
  const iconButton = cn(
    'inline-flex shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-slate-800 hover:text-slate-100',
    touch ? 'h-10 w-10' : 'h-7 w-7',
  );

  if (measurements.length === 0) {
    return (
      <p className="rounded border border-dashed border-slate-700 px-2.5 py-2 text-xs text-slate-500">
        {t('dental.measures.empty')}
      </p>
    );
  }

  return (
    <div className="space-y-2 text-xs">
      <ul className="space-y-1.5">
        {measurements.map((measurement) => {
          const slice = measurementSliceNumber(measurement);
          return (
            <li
              key={measurement.id}
              className={cn(
                'flex items-center gap-1 rounded border bg-slate-950 py-1 pl-2.5 pr-1',
                activeMeasurementId === measurement.id
                  ? 'border-sky-500/70'
                  : 'border-slate-800',
                !measurement.visible && 'opacity-60',
              )}
            >
              <div className="min-w-0 flex-1">
                <input
                  value={measurement.name}
                  aria-label={t('dental.measures.rename')}
                  onChange={(event) =>
                    onRename(measurement.id, event.currentTarget.value)
                  }
                  className="w-full truncate rounded border border-transparent bg-transparent px-0.5 text-base font-medium text-slate-200 hover:border-slate-700 focus:border-sky-500 focus:outline-none sm:text-xs"
                />
                <div className="flex flex-wrap gap-x-2 px-0.5 text-[11px] text-slate-500">
                  <span className="font-mono text-amber-200">
                    {formatMeasurementValue(measurement)}
                  </span>
                  {measurement.plane && slice != null ? (
                    <span>
                      {t('dental.measures.planeSlice', {
                        plane: t(`dental.views.${measurement.plane}`),
                        slice,
                      })}
                    </span>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                className={iconButton}
                title={t('dental.measures.goTo')}
                aria-label={t('dental.measures.goTo')}
                onClick={() => onGoTo(measurement)}
              >
                <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={iconButton}
                title={measurement.visible ? t('dental.measures.hide') : t('dental.measures.show')}
                aria-label={measurement.visible ? t('dental.measures.hide') : t('dental.measures.show')}
                onClick={() => onToggleVisible(measurement.id)}
              >
                {measurement.visible ? (
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                className={iconButton}
                title={t('dental.measures.delete')}
                aria-label={t('dental.measures.delete')}
                onClick={() => onDelete(measurement.id)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className={touch ? 'h-10' : undefined}
          onClick={onExportCsv}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          CSV
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={touch ? 'h-10' : undefined}
          onClick={() => {
            if (window.confirm(t('dental.measures.confirmClearAll'))) onDeleteAll();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          {t('dental.measures.clearAll')}
        </Button>
      </div>
    </div>
  );
}
