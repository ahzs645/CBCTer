import { Crosshair, Download, MapPin, Trash2 } from 'lucide-react';
import type { ToothCondition, ToothFinding } from '../../domain/types';
import { useTranslation } from '../../i18n';
import {
  PERMANENT_CHART_ROWS,
  PRIMARY_CHART_ROWS,
  TOOTH_CONDITIONS,
  toothConditionDefinition,
} from '../../lib/dental/toothChart';
import { cn } from '../../utils/cn';
import { Button } from '../Button';
import { COARSE_TARGET, FOCUS_RING } from '../Button.constants';
import { localToothName } from './toothNames';

export type Dentition = 'permanent' | 'primary';

interface ToothChartPanelProps {
  findings: ToothFinding[];
  selectedFdi: number | null;
  dentition: Dentition;
  caseNotes: string;
  /**
   * @deprecated Ignored: targets grow on touch screens by themselves
   * (`[@media(pointer:coarse)]`). Kept so existing callers still compile.
   */
  touch?: boolean;
  onDentitionChange: (dentition: Dentition) => void;
  onSelectTooth: (fdi: number | null) => void;
  onToggleCondition: (fdi: number, condition: ToothCondition) => void;
  onNoteChange: (fdi: number, note: string) => void;
  onPinToCursor: (fdi: number) => void;
  onGoToTooth: (fdi: number) => void;
  onClearTooth: (fdi: number) => void;
  onCaseNotesChange: (notes: string) => void;
  onExportCsv: () => void;
}

function ToothCell({
  fdi,
  name,
  finding,
  selected,
  onClick,
}: {
  fdi: number;
  name: string;
  finding?: ToothFinding;
  selected: boolean;
  onClick: () => void;
}) {
  const missing = finding?.conditions.includes('missing');
  const colors = (finding?.conditions ?? [])
    .filter((condition) => condition !== 'missing')
    .slice(0, 3)
    .map((condition) => toothConditionDefinition(condition).color);
  return (
    <button
      type="button"
      onClick={onClick}
      title={name}
      aria-label={`${fdi} ${name}`}
      aria-pressed={selected}
      className={cn(
        'touch-target flex w-full min-w-0 flex-col items-center justify-center rounded border font-mono tabular-nums transition',
        'h-9 text-[10px] tracking-tighter [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-[11px] [@media(pointer:coarse)]:tracking-normal',
        FOCUS_RING,
        selected
          ? 'border-sky-400 bg-sky-500/20 text-sky-50'
          : finding
            ? 'border-slate-600 bg-slate-800/80 text-slate-100 hover:bg-slate-700'
            : 'border-slate-800 bg-slate-950 text-slate-400 hover:bg-slate-900 hover:text-slate-200',
        missing && 'text-slate-500 line-through',
      )}
    >
      <span>{fdi}</span>
      <span className="flex h-1.5 gap-0.5" aria-hidden="true">
        {colors.map((color, index) => (
          <span
            key={index}
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: color }}
          />
        ))}
      </span>
      {finding?.point ? (
        <MapPin
          className="absolute right-0.5 top-0.5 h-2.5 w-2.5 text-sky-300"
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}

export function ToothChartPanel({
  findings,
  selectedFdi,
  dentition,
  caseNotes,
  onDentitionChange,
  onSelectTooth,
  onToggleCondition,
  onNoteChange,
  onPinToCursor,
  onGoToTooth,
  onClearTooth,
  onCaseNotesChange,
  onExportCsv,
}: ToothChartPanelProps) {
  const { t } = useTranslation();
  const rows = dentition === 'primary' ? PRIMARY_CHART_ROWS : PERMANENT_CHART_ROWS;
  const byFdi = new Map(findings.map((finding) => [finding.fdi, finding]));
  const selected = selectedFdi != null ? byFdi.get(selectedFdi) : undefined;
  const half = rows.upper.length / 2;
  // Touch screens wrap each arch into one row per side (8 or 5 teeth), so a
  // tooth is a comfortable tap instead of a sixteenth of the panel.
  const columns =
    dentition === 'primary'
      ? 'grid-cols-10 [@media(pointer:coarse)]:grid-cols-5 [@media(pointer:coarse)]:gap-1'
      : 'grid-cols-16 [@media(pointer:coarse)]:grid-cols-8 [@media(pointer:coarse)]:gap-1';

  const renderRow = (teeth: number[]) => (
    <div className={cn('grid gap-px', columns)}>
      {teeth.map((fdi, index) => (
        <div
          key={fdi}
          className={cn(
            'min-w-0',
            index === half &&
              'border-l-2 border-slate-500 pl-px [@media(pointer:coarse)]:border-l-0 [@media(pointer:coarse)]:pl-0',
          )}
        >
          <ToothCell
            fdi={fdi}
            name={localToothName(t, fdi)}
            finding={byFdi.get(fdi)}
            selected={selectedFdi === fdi}
            onClick={() => onSelectTooth(selectedFdi === fdi ? null : fdi)}
          />
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-3 text-xs text-slate-300">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-slate-500">
          {t('dental.chart.summary', { count: findings.length })}
        </div>
        <div
          className="inline-flex rounded border border-slate-700 p-0.5"
          role="group"
          aria-label={t('dental.chart.title')}
        >
          {(['permanent', 'primary'] as const).map((option) => (
            <Button
              key={option}
              variant="quiet"
              size="xs"
              pressed={dentition === option}
              onClick={() => onDentitionChange(option)}
              className="px-2"
            >
              {t(`dental.chart.${option}`)}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <div>
          <div className="mb-1 flex justify-between text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <span>{t('dental.chart.patientRight')}</span>
            <span>{t('dental.chart.upper')}</span>
            <span>{t('dental.chart.patientLeft')}</span>
          </div>
          {renderRow(rows.upper)}
          <div className="my-1 border-t border-dashed border-slate-700" />
          {renderRow(rows.lower)}
          <div className="mt-1 text-center text-[10px] uppercase tracking-[0.14em] text-slate-500">
            {t('dental.chart.lower')}
          </div>
        </div>
      </div>

      {selectedFdi == null ? (
        <p className="rounded border border-dashed border-slate-700 px-2.5 py-2 text-slate-500">
          {t('dental.chart.selectTooth')}
        </p>
      ) : (
        <div className="space-y-2.5 rounded border border-slate-700 bg-slate-950/80 p-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-100">
                {selectedFdi}
              </div>
              <div className="truncate text-[11px] text-slate-400">
                {localToothName(t, selectedFdi)}
              </div>
            </div>
            <div className="shrink-0 text-[11px] text-slate-500">
              {selected?.point ? t('dental.chart.pinned') : t('dental.chart.notPinned')}
            </div>
          </div>

          <div>
            <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
              {t('dental.chart.findings')}
            </div>
            <div className="flex flex-wrap gap-1">
              {TOOTH_CONDITIONS.map((condition) => {
                const active = selected?.conditions.includes(condition.id) ?? false;
                return (
                  <button
                    key={condition.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onToggleCondition(selectedFdi, condition.id)}
                    className={cn(
                      'inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[11px] transition',
                      COARSE_TARGET,
                      FOCUS_RING,
                      active
                        ? 'border-transparent text-slate-950'
                        : 'border-slate-700 text-slate-300 hover:bg-slate-800',
                    )}
                    style={active ? { backgroundColor: condition.color } : undefined}
                  >
                    {!active ? (
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: condition.color }}
                        aria-hidden="true"
                      />
                    ) : null}
                    {t(`dental.chart.conditions.${condition.id}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-slate-500">
              {t('dental.chart.note')}
            </span>
            <textarea
              rows={2}
              value={selected?.note ?? ''}
              placeholder={t('dental.chart.notePlaceholder')}
              onChange={(event) => onNoteChange(selectedFdi, event.currentTarget.value)}
              className="w-full resize-y rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-base text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none sm:text-xs"
            />
          </label>

          <div className="grid grid-cols-2 gap-1.5">
            <Button
              variant="primary"
              size="sm"
              onClick={() => onPinToCursor(selectedFdi)}
            >
              <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
              {selected?.point ? t('dental.chart.repin') : t('dental.chart.pin')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!selected?.point}
              onClick={() => onGoToTooth(selectedFdi)}
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {t('dental.chart.goTo')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="col-span-2"
              disabled={!selected}
              onClick={() => onClearTooth(selectedFdi)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('dental.chart.clear')}
            </Button>
          </div>
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-slate-500">
          {t('dental.chart.caseNotes')}
        </span>
        <textarea
          rows={3}
          value={caseNotes}
          placeholder={t('dental.chart.caseNotesPlaceholder')}
          onChange={(event) => onCaseNotesChange(event.currentTarget.value)}
          className="w-full resize-y rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-base text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none sm:text-xs"
        />
      </label>

      <Button
        variant="ghost"
        size="sm"
        block
        disabled={findings.length === 0}
        onClick={onExportCsv}
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        {t('dental.chart.exportCsv')}
      </Button>
    </div>
  );
}
