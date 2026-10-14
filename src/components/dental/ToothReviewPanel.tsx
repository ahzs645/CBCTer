import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Hint } from './PanelSection';
import { Button } from '../Button';
import {
  DENTAL_SEG_VARIANTS,
  type DentalSegVariantId,
} from '../../lib/segmentation/dentalSegVariants';
import { useState } from 'react';
import { useTranslation } from '../../i18n';
import type { StudyState } from '../../domain/types';
import type { ToothInstance } from '../../lib/case/types';
import { FDI_NUMBERS } from '../../lib/case/teeth';
import {
  archOrder,
  selectionIds,
  teethInGroup,
  type ToothGroupId,
} from '../../lib/case/toothSelection';
import {
  ToothArchGrid,
  ToothGroupChips,
  ToothModelExportForm,
  ToothShowControl,
  type ToothModelRequest,
} from './ToothPicker';
import { localToothLabel } from './toothNames';
interface Props {
  state: StudyState;
  busy: boolean;
  error: string;
  onClose: () => void;
  /** Shown as a side-panel tab (desktop) instead of a floating sheet. */
  docked?: boolean;
  onSelect: (id: string, additive?: boolean) => void;
  onPickGroup: (group: ToothGroupId) => void;
  onSeparate: (
    source: string,
    values: number[],
    minMm3: number,
    core: number,
  ) => void;
  onChange: (id: string, changes: Partial<ToothInstance>) => void;
  onCorrect: (erase: boolean) => void;
  onNewTooth: () => void;
  onImportModel: (file: File) => void;
  onAnatomy: (variant: DentalSegVariantId) => void;
  anatomyBusy: boolean;
  onCancelAnatomy: () => void;
  onSurface: () => void;
  surfaceBusy: boolean;
  onSplit: (axis: 0 | 1 | 2) => void;
  onMerge: (id: string) => void;
  onVisibility: (
    mode: 'all' | 'selected' | 'hide-teeth',
    bone: boolean,
  ) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Most numbers sit on the wrong side of the midline. */
  mirrored: boolean;
  onSwapSides: () => void;
  overlaps: Array<[ToothInstance, ToothInstance]>;
  /** Pairs that share a large surface: one tooth the model cut in two. */
  splits?: Array<{ a: ToothInstance; b: ToothInstance; sharedMm2: number }>;
  onMergePair?: (keepId: string, mergeId: string) => void;
  onFocus?: (id: string) => void;
  exportBusy: boolean;
  exportStatus: string;
  onExportModel: (request: ToothModelRequest) => void;
}
const field =
  'min-h-8 [@media(pointer:coarse)]:min-h-9 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs';
const button =
  'inline-flex min-h-8 [@media(pointer:coarse)]:min-h-9 items-center justify-center gap-1 rounded border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs hover:bg-slate-700 disabled:opacity-40';
const heading =
  'text-[11px] font-semibold uppercase tracking-wide text-slate-400';

/**
 * Review of proposed tooth outlines. The arch grid and the selected tooth's
 * actions come first; ways to add outlines (draw, import, run a model,
 * separate a mask) sit in a collapsed section below.
 */
export function ToothReviewPanel(p: Props) {
  const { t } = useTranslation();
  const toothLabel = (tooth: ToothInstance) => localToothLabel(t, tooth);
  const optionName = (tooth: ToothInstance, i: number) =>
    tooth.fdi
      ? t('dental.review.fdi', { fdi: tooth.fdi })
      : t('dental.review.unassignedN', { n: i + 1 });
  const teeth = p.state.toothInstances ?? [],
    selected = teeth.find((t) => t.id === p.state.selectedInstanceId);
  const chosen = selectionIds(p.state);
  const live = teeth.filter((t) => t.review !== 'rejected');
  const reviewed = teeth.filter((t) => t.review !== 'unreviewed').length;
  const ordered = archOrder(live);
  const visibleOverlaps = p.overlaps.filter(
    ([a, b]) =>
      !p.splits?.some(
        (pair) =>
          (pair.a.id === a.id && pair.b.id === b.id) ||
          (pair.a.id === b.id && pair.b.id === a.id),
      ),
  );
  const [model, setModel] = useState<DentalSegVariantId>('full');
  const [source, setSource] = useState(
      p.state.activeSegmentGroupId ?? p.state.activeMaskId ?? '',
    ),
    [values, setValues] = useState('3,4'),
    [minMm3, setMinMm3] = useState(0.5),
    [core, setCore] = useState(3),
    [axis, setAxis] = useState<0 | 1 | 2>(0),
    [merge, setMerge] = useState(''),
    [multi, setMulti] = useState(false);
  const step = (delta: number, from = selected?.id) => {
    if (!ordered.length) return;
    const index = ordered.findIndex((t) => t.id === from);
    p.onSelect(ordered[(index + delta + ordered.length) % ordered.length].id);
  };
  const acceptAndNext = () => {
    if (!selected) return;
    p.onChange(selected.id, { review: 'accepted' });
    const next = ordered
      .slice(ordered.findIndex((t) => t.id === selected.id) + 1)
      .concat(ordered)
      .find((t) => t.review === 'unreviewed' && t.id !== selected.id);
    if (next) p.onSelect(next.id);
  };
  return (
    <aside
      role="region"
      aria-label={t('dental.review.region')}
      className={
        p.docked
          ? 'h-full space-y-2.5 overflow-y-auto bg-slate-900 p-3'
          : 'absolute inset-x-0 bottom-0 z-40 max-h-[60dvh] space-y-2.5 overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-3 shadow-xl md:inset-x-auto md:bottom-8 md:right-2 md:top-14 md:max-h-none md:w-96 md:rounded-xl'
      }
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">{t('dental.review.title')}</h2>
          {teeth.length ? (
            <p className="text-xs text-slate-400">
              {t('dental.review.progress', {
                reviewed,
                total: teeth.length,
              })}
            </p>
          ) : null}
        </div>
        <button
          className={button}
          onClick={p.onClose}
          aria-label={t('dental.review.closeLabel')}
        >
          {t('dental.review.close')}
        </button>
      </div>
      {teeth.length ? (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-slate-800"
          aria-hidden="true"
        >
          <div
            className="h-full bg-emerald-500"
            style={{ width: `${(reviewed / teeth.length) * 100}%` }}
          />
        </div>
      ) : null}
      {p.error && (
        <p className="text-sm text-rose-300" role="alert">
          {p.error}
        </p>
      )}
      {p.mirrored ? (
        <div className="flex items-start gap-2 rounded border border-amber-400/40 bg-amber-950/40 px-2 py-1.5">
          <Hint
            className="flex-1 text-xs text-amber-100"
            more={t('dental.review.mirrored')}
          >
            {t('dental.teethPanel.mirroredShort')}
          </Hint>
          <Button
            variant="secondary"
            size="xs"
            aria-label={t('dental.review.swap')}
            onClick={p.onSwapSides}
          >
            {t('dental.teethPanel.swapShort')}
          </Button>
        </div>
      ) : null}
      {p.splits?.length ? (
        <div className="rounded border border-amber-400/40 bg-amber-950/30 p-2 text-xs text-amber-100">
          <Hint
            className="text-xs text-amber-100"
            more={t('dental.teethPanel.splitsDetail')}
          >
            {t('dental.teethPanel.splitsShort', { count: p.splits.length })}
          </Hint>
          <ul className="mt-1 space-y-0.5">
            {p.splits.map(({ a, b, sharedMm2 }) => (
              <li key={`${a.id}-${b.id}`} className="flex items-center gap-2">
                <span className="flex-1">
                  {t('dental.review.splitPair', {
                    a: toothLabel(a),
                    b: toothLabel(b),
                    area: Math.round(sharedMm2),
                  })}
                </span>
                {p.onMergePair ? (
                  <button
                    type="button"
                    className="underline"
                    onClick={() =>
                      (a.fdi ?? 99) <= (b.fdi ?? 99)
                        ? p.onMergePair!(a.id, b.id)
                        : p.onMergePair!(b.id, a.id)
                    }
                  >
                    {t('dental.review.merge')}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {/* Overlaps already listed as split teeth above are not repeated. */}
      {visibleOverlaps.length ? (
        <div className="rounded border border-amber-400/40 bg-amber-950/30 p-2 text-xs text-amber-100">
          {visibleOverlaps.map(([a, b]) => (
            <p key={`${a.id}-${b.id}`}>
              {t('dental.review.overlap', {
                a: toothLabel(a),
                b: toothLabel(b),
              })}
            </p>
          ))}
        </div>
      ) : null}
      {teeth.length ? (
        <section className="space-y-2">
          <ToothArchGrid
            teeth={teeth}
            selectedIds={chosen}
            focusId={selected?.id}
            multi={multi}
            onSelect={(id, additive) => p.onSelect(id, additive)}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={t('dental.review.previous')}
              className={button}
              onClick={() => step(-1)}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t('dental.review.selected')}</span>
              <select
                className={field}
                aria-label={t('dental.review.selectedInstance')}
                value={selected?.id ?? ''}
                onChange={(e) => p.onSelect(e.target.value)}
              >
                <option value="">{t('dental.review.selectPlaceholder')}</option>
                {teeth.map((tooth, i) => (
                  <option key={tooth.id} value={tooth.id}>
                    {t('dental.review.option', {
                      name: optionName(tooth, i),
                      review: t(`dental.reviewState.${tooth.review}`),
                      voxels: tooth.voxelCount,
                    })}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              aria-label={t('dental.review.next')}
              className={button}
              onClick={() => step(1)}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <label
            className="flex min-h-8 items-center gap-2 text-xs text-slate-300"
            title={t('dental.review.multiTitle')}
          >
            <input
              type="checkbox"
              className="h-4 w-4 accent-sky-400"
              checked={multi}
              onChange={(e) => setMulti(e.target.checked)}
            />
            {t('dental.review.multi')}
          </label>
          <ToothGroupChips
            available={(group) => teethInGroup(teeth, group).length}
            onPick={p.onPickGroup}
          />
        </section>
      ) : null}
      {selected && (
        <section className="grid gap-2">
          <div className="flex items-center gap-2">
            <h3 className={`${heading} flex-1`}>
              {toothLabel(selected)} ·{' '}
              {t(`dental.reviewState.${selected.review}`)}
            </h3>
            {p.onFocus ? (
              <button
                type="button"
                className={`${button} border-sky-500/60`}
                onClick={() => p.onFocus!(selected.id)}
              >
                {t('dental.review.focus')}
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`${button} border-emerald-500/50`}
              onClick={acceptAndNext}
              title={t('dental.review.acceptNextTitle')}
            >
              {t('dental.review.acceptNext')}
            </button>
            <button
              className={button}
              onClick={() => p.onChange(selected.id, { review: 'accepted' })}
            >
              {t('dental.review.accept')}
            </button>
            <button
              className={button}
              onClick={() => p.onChange(selected.id, { review: 'rejected' })}
            >
              {t('dental.review.reject')}
            </button>
            <label className="text-xs">
              <span className="sr-only">{t('dental.review.fdiNumber')}</span>
              <select
                className={field}
                aria-label={t('dental.review.fdiNumber')}
                value={selected.fdi ?? ''}
                onChange={(e) =>
                  p.onChange(selected.id, {
                    fdi: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">{t('dental.review.unassigned')}</option>
                {FDI_NUMBERS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <details>
            <summary className="cursor-pointer py-1.5 text-xs">
              {t('dental.review.fix')}
            </summary>
            <div className="grid gap-2">
              <div className="grid grid-cols-2 gap-2">
                <button className={button} onClick={() => p.onCorrect(false)}>
                  {t('dental.review.correct')}
                </button>
                <button className={button} onClick={() => p.onCorrect(true)}>
                  {t('dental.review.erase')}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  className={field}
                  aria-label={t('dental.review.splitPlane')}
                  value={axis}
                  onChange={(e) => setAxis(Number(e.target.value) as 0 | 1 | 2)}
                >
                  <option value={0}>{t('dental.review.sagittal')}</option>
                  <option value={1}>{t('dental.review.coronal')}</option>
                  <option value={2}>{t('dental.review.axial')}</option>
                </select>
                <button className={button} onClick={() => p.onSplit(axis)}>
                  {t('dental.review.splitAt')}
                </button>
              </div>
              <label className="text-xs">
                {t('dental.review.mergeInto')}
                <select
                  className={field}
                  aria-label={t('dental.review.mergeTooth')}
                  value={merge}
                  onChange={(e) => setMerge(e.target.value)}
                >
                  <option value="">{t('dental.review.chooseOther')}</option>
                  {teeth
                    .filter(
                      (t) =>
                        t.id !== selected.id && t.groupId === selected.groupId,
                    )
                    .map((tooth, i) => (
                      <option key={tooth.id} value={tooth.id}>
                        {optionName(tooth, i)}
                      </option>
                    ))}
                </select>
              </label>
              <button
                disabled={!merge}
                className={button}
                onClick={() => {
                  p.onMerge(merge);
                  setMerge('');
                }}
              >
                {t('dental.review.mergeOutlines')}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={button}
                  disabled={!p.canUndo}
                  onClick={p.onUndo}
                >
                  {t('dental.review.undo')}
                </button>
                <button
                  className={button}
                  disabled={!p.canRedo}
                  onClick={p.onRedo}
                >
                  {t('dental.review.redo')}
                </button>
              </div>
            </div>
          </details>
          <button
            className={button}
            disabled={p.surfaceBusy}
            onClick={p.onSurface}
          >
            {p.surfaceBusy
              ? t('dental.review.generating')
              : t('dental.review.regenerate')}
          </button>
        </section>
      )}
      <section className="space-y-2">
        <h3 className={heading}>{t('dental.review.show')}</h3>
        <ToothShowControl
          mode={p.state.toothVisibility ?? 'all'}
          hasSelection={chosen.length > 0}
          onChange={(mode) =>
            p.onVisibility(mode, p.state.showSurroundingBone ?? false)
          }
        />
        <label className="flex min-h-8 items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="h-4 w-4 accent-sky-400"
            checked={p.state.showSurroundingBone ?? false}
            onChange={(e) =>
              p.onVisibility(p.state.toothVisibility ?? 'all', e.target.checked)
            }
          />
          {t('dental.review.showBone')}
        </label>
      </section>
      {teeth.length ? (
        <section className="space-y-2">
          <h3 className={heading}>{t('dental.review.exportTitle')}</h3>
          <ToothModelExportForm
            count={teeth.filter((t) => chosen.includes(t.id)).length}
            busy={p.exportBusy}
            status={p.exportStatus}
            onExport={p.onExportModel}
          />
        </section>
      ) : null}
      <details
        open={!teeth.length}
        className="rounded border border-slate-800 p-2"
      >
        <summary className="cursor-pointer py-1.5 text-xs font-medium">
          {t('dental.review.add')}
        </summary>
        <div className="space-y-2">
          <button className={button} onClick={p.onNewTooth}>
            {t('dental.review.draw')}
          </button>
          <label className={`${button} block cursor-pointer`}>
            {t('dental.review.import')}
            <input
              aria-label={t('dental.review.import')}
              type="file"
              accept=".zip"
              className="sr-only"
              disabled={p.busy || p.anatomyBusy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) p.onImportModel(file);
                e.target.value = '';
              }}
            />
          </label>
          <p className="text-xs text-slate-400">
            {t('dental.review.importHint')}
          </p>
          {(p.state.analysisModels ?? []).length > 0 && (
            <details>
              <summary className="cursor-pointer py-1.5 text-xs">
                {t('dental.review.loaded', {
                  count: p.state.analysisModels!.length,
                })}
              </summary>
              <ul className="text-xs text-slate-300">
                {p.state.analysisModels!.map((m) => (
                  <li key={m.id}>
                    {m.name} —{' '}
                    {p.state.analysisLayers?.some(
                      (l) => l.modelId === m.id && l.role === 'teeth',
                    )
                      ? t('dental.review.awaiting', {
                          count: (p.state.toothInstances ?? []).filter(
                            (tooth) =>
                              tooth.review === 'unreviewed' &&
                              p.state.analysisLayers?.some(
                                (l) =>
                                  l.id === tooth.groupId && l.modelId === m.id,
                              ),
                          ).length,
                        })
                      : t('dental.review.structures')}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details>
            <summary className="cursor-pointer py-1.5 text-xs">
              {t('dental.review.propose')}
            </summary>
            <label className="text-xs">
              {t('dental.review.anatomyModel')}
              <select
                className={field}
                aria-label={t('dental.review.anatomyModel')}
                value={model}
                disabled={p.anatomyBusy}
                onChange={(e) => setModel(e.target.value as DentalSegVariantId)}
              >
                {Object.values(DENTAL_SEG_VARIANTS).map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={button}
              disabled={p.anatomyBusy}
              onClick={() => p.onAnatomy(model)}
            >
              {p.anatomyBusy
                ? t('dental.review.segmenting')
                : t('dental.review.runModel')}
            </button>
            {p.anatomyBusy && (
              <button className={button} onClick={p.onCancelAnatomy}>
                {t('dental.review.cancelModel')}
              </button>
            )}
            <p className="mt-2 text-xs text-slate-400">
              {t('dental.review.modelHint')}
            </p>
            <a
              className={`${button} mt-2 block text-center`}
              target="_blank"
              rel="noreferrer"
              href="https://colab.research.google.com/github/ahzs645/CBCTer/blob/main/notebooks/CBCTer_GPU_models.ipynb"
            >
              {t('dental.review.cloud')}
            </a>
            <p className="mt-2 text-xs text-slate-400">
              {t('dental.review.cloudHint')}
            </p>
          </details>
          <details open={!teeth.length}>
            <summary className="cursor-pointer py-1.5 text-xs">
              {t('dental.review.separate')}
            </summary>
            <div className="grid gap-2">
              <label className="text-xs">
                {t('dental.review.source')}
                <select
                  aria-label={t('dental.review.separationSource')}
                  className={field}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option value="">{t('dental.review.selectSource')}</option>
                  {p.state.segmentGroups
                    .filter(
                      (g) =>
                        !p.state.analysisLayers?.some(
                          (l) => l.id === g.id && l.role === 'teeth',
                        ),
                    )
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  {p.state.masks.map((m) => (
                    <option key={m.id} value={m.id}>
                      {t('dental.review.binaryMask', { name: m.name })}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                {t('dental.review.values')}
                <input
                  className={field}
                  value={values}
                  onChange={(e) => setValues(e.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">
                  {t('dental.review.minSize')}
                  <input
                    type="number"
                    min=".01"
                    step=".1"
                    className={field}
                    value={minMm3}
                    onChange={(e) => setMinMm3(Number(e.target.value))}
                  />
                </label>
                <label className="text-xs">
                  {t('dental.review.coreSize')}
                  <input
                    type="number"
                    min="1"
                    max="20"
                    className={field}
                    value={core}
                    onChange={(e) => setCore(Number(e.target.value))}
                  />
                </label>
              </div>
              <button
                className={button}
                disabled={p.busy || !source}
                onClick={() =>
                  p.onSeparate(
                    source,
                    values.split(',').map(Number),
                    minMm3,
                    core,
                  )
                }
              >
                {p.busy
                  ? t('dental.review.separating')
                  : t('dental.review.proposeSeparate')}
              </button>
              <p className="text-xs text-slate-400">
                {t('dental.review.separateHint')}
              </p>
            </div>
          </details>
        </div>
      </details>
    </aside>
  );
}
