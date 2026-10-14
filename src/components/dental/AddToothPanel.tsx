import { useState } from 'react';
import { Hint } from './PanelSection';
import { useTranslation } from '../../i18n';
import { cn } from '../../utils/cn';
import { Button } from '../Button';
import { FOCUS_RING } from '../Button.constants';

export interface AddToothDraft {
  fdi: number | null;
  volumeMm3: number;
  leaked: boolean;
}

/**
 * Outline a tooth the model missed: choose its number, click its crown on a
 * slice, then keep, loosen or tighten the estimated outline.
 */
export function AddToothPanel({
  fdiChoices,
  picking,
  busy,
  status,
  draft,
  added,
  onStart,
  onCancel,
  onKeep,
  onAdjust,
  onDiscard,
  onRemove,
}: {
  /** Numbers to offer, most likely missing first. */
  fdiChoices: number[];
  picking: number | null;
  busy: boolean;
  status: string;
  draft: AddToothDraft | null;
  added: Array<{ id: string; name: string }>;
  onStart: (fdi: number) => void;
  onCancel: () => void;
  onKeep: () => void;
  /** Positive: take more (looser); negative: take less (tighter). */
  onAdjust: (direction: 1 | -1) => void;
  onDiscard: () => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [fdi, setFdi] = useState(fdiChoices[0] ?? 11);
  const chosen = fdiChoices.includes(fdi) ? fdi : (fdiChoices[0] ?? 11);
  return (
    <div className="space-y-2 text-xs text-slate-300">
      <Hint more={t('dental.addTooth.introMore')}>
        {t('dental.addTooth.introShort')}
      </Hint>
      {picking !== null ? (
        <div
          role="status"
          className="rounded border border-emerald-400/50 bg-emerald-950/30 p-2 text-emerald-100"
        >
          {t('dental.addTooth.picking', { fdi: picking })}
          <button
            type="button"
            className={cn('ml-2 rounded underline', FOCUS_RING)}
            onClick={onCancel}
          >
            {t('dental.addTooth.cancel')}
          </button>
        </div>
      ) : draft ? (
        <div className="space-y-1.5 rounded border border-emerald-400/50 bg-emerald-950/30 p-2 text-emerald-100">
          <p role="status">
            {t('dental.addTooth.draft', {
              fdi: draft.fdi ?? '?',
              volume: Math.round(draft.volumeMm3),
            })}
          </p>
          {draft.leaked ? (
            <p className="text-amber-200">{t('dental.addTooth.leaked')}</p>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={onKeep}
            >
              {t('dental.addTooth.keep')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => onAdjust(1)}
            >
              {t('dental.addTooth.looser')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => onAdjust(-1)}
            >
              {t('dental.addTooth.tighter')}
            </Button>
            <Button
              variant="quiet"
              size="sm"
              disabled={busy}
              onClick={onDiscard}
            >
              {t('dental.addTooth.discard')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <select
            aria-label={t('dental.addTooth.number')}
            className={cn(
              'rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs [@media(pointer:coarse)]:min-h-11',
              FOCUS_RING,
            )}
            value={chosen}
            onChange={(e) => setFdi(Number(e.target.value))}
          >
            {fdiChoices.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            disabled={busy || !fdiChoices.length}
            onClick={() => onStart(chosen)}
          >
            {busy ? t('dental.addTooth.working') : t('dental.addTooth.start')}
          </Button>
        </div>
      )}
      {status ? <p className="text-slate-300">{status}</p> : null}
      {added.length ? (
        <div>
          <p className="text-[11px] text-slate-400">
            {t('dental.addTooth.added')}
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {added.map((tooth) => (
              <li key={tooth.id} className="flex items-center gap-2">
                <span className="flex-1 text-emerald-200">{tooth.name}</span>
                <button
                  type="button"
                  className={cn('rounded underline', FOCUS_RING)}
                  aria-label={t('dental.addTooth.remove', { name: tooth.name })}
                  onClick={() => onRemove(tooth.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
