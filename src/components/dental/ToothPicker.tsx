import { Check, Download, X } from 'lucide-react';
import { Hint } from './PanelSection';
import { useState } from 'react';
import { useTranslation } from '../../i18n';
import type { ToothInstance } from '../../lib/case/types';
import {
  TOOTH_GROUPS,
  mirrorFdi,
  type ToothGroupId,
} from '../../lib/case/toothSelection';
import { PERMANENT_CHART_ROWS } from '../../lib/dental/toothChart';
import { cn } from '../../utils/cn';
import { localToothLabel, localToothName } from './toothNames';

export type ToothShowMode = 'all' | 'selected' | 'hide-teeth';

const REVIEW_STYLE: Record<ToothInstance['review'], string> = {
  unreviewed: 'border-slate-600 bg-slate-800 text-slate-100',
  accepted: 'border-emerald-500/60 bg-emerald-500/15 text-emerald-50',
  corrected: 'border-amber-400/60 bg-amber-400/15 text-amber-50',
  rejected: 'border-rose-500/40 bg-rose-950/40 text-rose-200 line-through',
};

/**
 * The 32 permanent teeth in chart layout (patient right on the viewer's left)
 * showing which have an outline and its review state. Click selects a tooth;
 * Ctrl/⌘/Shift-click (or `multi`) adds or removes it from the selection.
 */
export function ToothArchGrid({
  teeth,
  selectedIds,
  focusId,
  swapSides = false,
  multi = false,
  touch = false,
  onSelect,
}: {
  teeth: ToothInstance[];
  selectedIds: string[];
  focusId?: string | null;
  /** Show numbers mirrored left/right (view-only correction). */
  swapSides?: boolean;
  /** Taps add to the selection instead of replacing it. */
  multi?: boolean;
  touch?: boolean;
  onSelect: (id: string, additive: boolean) => void;
}) {
  const { t: tr } = useTranslation();
  const toothName = (fdi: number) => localToothName(tr, fdi);
  const shown = (t: ToothInstance) => (swapSides ? mirrorFdi(t.fdi) : t.fdi);
  const byFdi = new Map<number, ToothInstance>();
  // Outlines without a number, or sharing one with another outline, are listed
  // under the chart so none of them disappears.
  const extras: ToothInstance[] = [];
  for (const t of teeth) {
    const fdi = shown(t);
    const taken = fdi ? byFdi.get(fdi) : undefined;
    if (!fdi) extras.push(t);
    else if (!taken) byFdi.set(fdi, t);
    else if (taken.review === 'rejected' && t.review !== 'rejected') {
      byFdi.set(fdi, t);
      extras.push(taken);
    } else extras.push(t);
  }
  const selected = new Set(selectedIds);
  const cell = (
    fdi: number | null,
    t: ToothInstance | undefined,
    label: string,
  ) => {
    if (!t)
      return (
        <span
          key={`empty-${fdi}`}
          title={
            fdi
              ? tr('dental.picker.noOutline', { fdi, name: toothName(fdi) })
              : undefined
          }
          className={cn(
            'flex min-w-0 items-center justify-center rounded border border-dashed border-slate-800 font-mono text-slate-600',
            touch ? 'h-11 text-sm' : 'h-7 text-[10px]',
          )}
        >
          {fdi}
        </span>
      );
    const isSelected = selected.has(t.id);
    return (
      <button
        key={t.id}
        type="button"
        aria-pressed={isSelected}
        // The raw review state stays in the accessible name; tests match it.
        aria-label={`${label}${fdi ? ` ${toothName(fdi)}` : ''}, ${t.review}`}
        title={`${label}${fdi ? ` · ${toothName(fdi)}` : ''} · ${tr(`dental.reviewState.${t.review}`)}`}
        onClick={(event) =>
          onSelect(
            t.id,
            multi || event.ctrlKey || event.metaKey || event.shiftKey,
          )
        }
        className={cn(
          'touch-target flex w-full min-w-0 items-center justify-center rounded border font-mono tabular-nums transition hover:brightness-125',
          touch ? 'h-11 text-sm' : 'h-7 text-[10px] tracking-tighter',
          REVIEW_STYLE[t.review],
          isSelected &&
            'ring-2 ring-sky-400 ring-offset-1 ring-offset-slate-950',
          focusId === t.id && 'ring-yellow-400',
        )}
      >
        {fdi ?? label.replace(/\D+/g, 'U')}
        {t.review === 'accepted' || t.review === 'corrected' ? (
          <Check
            className="absolute right-0 top-0 h-2.5 w-2.5"
            aria-hidden="true"
          />
        ) : t.review === 'rejected' ? (
          <X
            className="absolute right-0 top-0 h-2.5 w-2.5"
            aria-hidden="true"
          />
        ) : null}
      </button>
    );
  };
  const row = (numbers: number[]) => (
    <div className="grid grid-cols-16 gap-px">
      {numbers.map((fdi, index) => (
        <div
          key={fdi}
          className={cn(
            'min-w-0',
            index === 8 && 'border-l-2 border-slate-500 pl-px',
          )}
        >
          {cell(fdi, byFdi.get(fdi), tr('dental.toothNames.unknown', { fdi }))}
        </div>
      ))}
    </div>
  );
  const extrasRow = extras.length ? (
        <div className="flex flex-wrap items-center gap-1 pt-1 text-[11px] text-slate-400">
          <span>{tr('dental.picker.extras')}</span>
          {extras.map((t, i) => (
            <span key={t.id} className={touch ? 'w-11' : 'w-9'}>
              {shown(t)
                ? cell(
                    shown(t),
                    t,
                    tr('dental.picker.duplicate', { fdi: shown(t) }),
                  )
                : cell(null, t, localToothLabel(tr, { ...t, fdi: null }, i))}
            </span>
          ))}
        </div>
      ) : null;
  // Phones: one row of eight per quadrant, so each tooth is about 44 px
  // wide instead of a sixteenth of the screen.
  const quadrant = (key: string, numbers: number[]) => (
    <div key={key}>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">
        {tr(`dental.picker.quadrant.${key}`)}
      </div>
      <div className="grid grid-cols-8 gap-1">
        {numbers.map((fdi) => (
          <div key={fdi} className="min-w-0">
            {cell(fdi, byFdi.get(fdi), tr('dental.toothNames.unknown', { fdi }))}
          </div>
        ))}
      </div>
    </div>
  );
  if (touch)
    return (
      <div
        className="space-y-1.5"
        role="group"
        aria-label={tr('dental.picker.teeth')}
      >
        {quadrant('upperRight', PERMANENT_CHART_ROWS.upper.slice(0, 8))}
        {quadrant('upperLeft', PERMANENT_CHART_ROWS.upper.slice(8))}
        {quadrant('lowerRight', PERMANENT_CHART_ROWS.lower.slice(0, 8))}
        {quadrant('lowerLeft', PERMANENT_CHART_ROWS.lower.slice(8))}
        {extrasRow}
      </div>
    );
  return (
    <div
      className="space-y-1"
      role="group"
      aria-label={tr('dental.picker.teeth')}
    >
      <div className="flex justify-between text-[10px] uppercase tracking-wide text-slate-400">
        <span>{tr('dental.picker.patientRight')}</span>
        <span>{tr('dental.chart.upper')}</span>
        <span>{tr('dental.picker.patientLeft')}</span>
      </div>
      {row(PERMANENT_CHART_ROWS.upper)}
      {row(PERMANENT_CHART_ROWS.lower)}
      <div className="text-center text-[10px] uppercase tracking-wide text-slate-400">
        {tr('dental.chart.lower')}
      </div>
      {extrasRow}
    </div>
  );
}

const chip =
  'min-h-7 touch-target rounded-full border border-slate-700 bg-slate-900 px-2.5 text-[11px] text-slate-200 hover:border-sky-500/60 hover:bg-slate-800 disabled:opacity-40';

export function ToothGroupChips({
  onPick,
  available,
}: {
  onPick: (group: ToothGroupId) => void;
  available: (group: ToothGroupId) => number;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-wrap gap-1.5 [@media(pointer:coarse)]:gap-3"
      aria-label={t('dental.picker.groupsLabel')}
    >
      {TOOTH_GROUPS.map((g) => {
        const count = available(g.id);
        const label = t(`dental.picker.groups.${g.id}`);
        return (
          <button
            key={g.id}
            type="button"
            className={chip}
            disabled={!count}
            onClick={() => onPick(g.id)}
            title={t('dental.picker.groupTitle', { group: label, count })}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

const segment =
  'min-h-7 touch-target flex-1 rounded px-2 text-[11px] transition aria-pressed:bg-sky-500/20 aria-pressed:text-sky-50 text-slate-300 hover:bg-slate-800 disabled:opacity-40';

export function ToothShowControl({
  mode,
  hasSelection,
  onChange,
}: {
  mode: ToothShowMode;
  hasSelection: boolean;
  onChange: (mode: ToothShowMode) => void;
}) {
  const { t } = useTranslation();
  const options: Array<[ToothShowMode, string]> = [
    ['all', t('dental.picker.showAll')],
    ['selected', t('dental.picker.onlySelected')],
    ['hide-teeth', t('dental.picker.hideTeeth')],
  ];
  return (
    <div
      className="flex gap-0.5 rounded-md border border-slate-700 bg-slate-950 p-0.5"
      role="group"
      aria-label={t('dental.picker.show')}
    >
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className={segment}
          aria-pressed={mode === value}
          disabled={value === 'selected' && !hasSelection}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export interface ToothModelRequest {
  crownOnly: boolean;
  gumOffsetMm: number;
  /** Add one printable piece: the crowns joined on a horseshoe base. */
  archModel: boolean;
  baseHeightMm: number;
  /** Simplify the surfaces (well under a voxel of error) for smaller files. */
  smaller: boolean;
}

/**
 * STL export of the selected teeth: whole teeth, or crowns above an estimated
 * gumline, for example canine to canine as a fallback model for a retainer.
 */
export function ToothModelExportForm({
  count,
  busy,
  status,
  onExport,
}: {
  count: number;
  busy: boolean;
  status: string;
  onExport: (request: ToothModelRequest) => void;
}) {
  const { t } = useTranslation();
  const [crownOnly, setCrownOnly] = useState(true);
  const [gumOffsetMm, setGumOffsetMm] = useState(2);
  const [archModel, setArchModel] = useState(true);
  const [baseHeightMm, setBaseHeightMm] = useState(8);
  const [smaller, setSmaller] = useState(true);
  return (
    <div className="space-y-2 text-xs text-slate-300">
      <div
        className="flex gap-0.5 rounded-md border border-slate-700 bg-slate-950 p-0.5"
        role="group"
        aria-label={t('dental.picker.modelShape')}
      >
        <button
          type="button"
          className={segment}
          aria-pressed={crownOnly}
          onClick={() => setCrownOnly(true)}
        >
          {t('dental.picker.crowns')}
        </button>
        <button
          type="button"
          className={segment}
          aria-pressed={!crownOnly}
          onClick={() => setCrownOnly(false)}
        >
          {t('dental.picker.wholeTeeth')}
        </button>
      </div>
      {crownOnly ? (
        <label className="block">
          <span className="flex justify-between">
            <span>{t('dental.picker.gumOffset')}</span>
            <span className="font-mono">
              {t('dental.units.mm', { value: gumOffsetMm.toFixed(1) })}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={4}
            step={0.5}
            value={gumOffsetMm}
            aria-label={t('dental.picker.gumOffsetLabel')}
            onChange={(e) => setGumOffsetMm(Number(e.target.value))}
            className="h-6 w-full accent-sky-400"
          />
        </label>
      ) : null}
      {crownOnly ? (
        <label className="flex min-h-8 items-center gap-2 [@media(pointer:coarse)]:min-h-11">
          <input
            type="checkbox"
            className="h-4 w-4 accent-sky-400"
            checked={archModel}
            onChange={(e) => setArchModel(e.target.checked)}
          />
          <span className="flex-1">{t('dental.picker.archModel')}</span>
          {archModel ? (
            <select
              aria-label={t('dental.picker.baseHeight')}
              className="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-xs [@media(pointer:coarse)]:min-h-11"
              value={baseHeightMm}
              onChange={(e) => setBaseHeightMm(Number(e.target.value))}
            >
              {[5, 8, 12, 15].map((mm) => (
                <option key={mm} value={mm}>
                  {t('dental.picker.base', { mm })}
                </option>
              ))}
            </select>
          ) : null}
        </label>
      ) : null}
      <label className="flex min-h-8 items-center gap-2 [@media(pointer:coarse)]:min-h-11">
        <input
          type="checkbox"
          className="h-4 w-4 accent-sky-400"
          checked={smaller}
          onChange={(e) => setSmaller(e.target.checked)}
        />
        <span className="flex-1">
          {t('dental.picker.smaller')}{' '}
          <span className="text-slate-400">
            {t('dental.picker.smallerDetail')}
          </span>
        </span>
      </label>
      <button
        type="button"
        disabled={busy || !count}
        onClick={() =>
          onExport({
            crownOnly,
            gumOffsetMm,
            archModel: crownOnly && archModel,
            baseHeightMm,
            smaller,
          })
        }
        className="inline-flex min-h-8 touch-target w-full items-center justify-center gap-1.5 rounded border border-sky-500/60 bg-sky-500/15 px-2.5 text-xs text-sky-50 hover:bg-sky-500/25 disabled:opacity-40"
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        {busy
          ? t('dental.picker.building')
          : t('dental.picker.export', { count })}
      </button>
      {status ? (
        <p role="status" className="text-slate-300">
          {status}
        </p>
      ) : null}
      <Hint more={t('dental.picker.disclaimer')}>
        {t('dental.picker.disclaimerShort')}
      </Hint>
    </div>
  );
}
