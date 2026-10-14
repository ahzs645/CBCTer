import { useTranslation } from '../../i18n';
import { cn } from '../../utils/cn';
import { Button } from '../Button';
import { FOCUS_RING } from '../Button.constants';

export type CanalSide = 'right' | 'left';

const linkButton = cn('rounded underline', FOCUS_RING);

/**
 * Nerve canal tracing: pick the canal's two ends on the slices for each side;
 * the app snaps them to the dark canal, follows it between them, draws it on
 * every slice and reports how close the teeth come to it.
 */
export function CanalPanel({
  traced,
  picking,
  pickedPoints,
  busy,
  status,
  distances,
  onPick,
  onCancel,
  onClear,
}: {
  traced: Record<CanalSide, number | null>;
  picking: CanalSide | null;
  pickedPoints: number;
  busy: boolean;
  status: string;
  distances: Array<{ name: string; distanceMm: number; side: CanalSide }>;
  onPick: (side: CanalSide) => void;
  onCancel: () => void;
  onClear: (side: CanalSide) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 text-xs text-slate-300">
      {picking ? (
        <div
          className="rounded border border-pink-400/50 bg-pink-950/30 p-2 text-pink-100"
          role="status"
        >
          {t(
            pickedPoints === 0
              ? `dental.canal.pickFirst.${picking}`
              : `dental.canal.pickSecond.${picking}`,
          )}
          <button
            type="button"
            className={cn('ml-2', linkButton)}
            onClick={onCancel}
          >
            {t('dental.canal.cancel')}
          </button>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-1.5">
        {(['right', 'left'] as const).map((side) => (
          <div key={side} className="space-y-1">
            <Button
              variant="secondary"
              size="sm"
              block
              className={cn(
                'min-h-8 px-2.5 text-xs',
                picking === side && 'border-pink-400',
              )}
              disabled={busy || Boolean(picking)}
              onClick={() => onPick(side)}
            >
              {traced[side] != null
                ? t(`dental.canal.retrace.${side}`)
                : t(`dental.canal.trace.${side}`)}
            </Button>
            {traced[side] != null ? (
              <p className="text-[11px] text-slate-400">
                {t('dental.canal.traced', {
                  length: traced[side]!.toFixed(0),
                })}{' '}
                ·{' '}
                <button
                  type="button"
                  className={linkButton}
                  onClick={() => onClear(side)}
                >
                  {t('dental.canal.remove')}
                </button>
              </p>
            ) : null}
          </div>
        ))}
      </div>
      {status ? <p role="status">{status}</p> : null}
      {distances.length ? (
        <table className="w-full text-[11px]">
          <caption className="text-left text-slate-400">
            {t('dental.canal.closest')}
          </caption>
          <tbody>
            {distances.map((row) => (
              <tr key={`${row.side}-${row.name}`}>
                <td className="py-0.5">{row.name}</td>
                <td
                  className={cn(
                    'py-0.5 text-right font-mono',
                    row.distanceMm < 2 ? 'text-amber-200' : 'text-slate-300',
                  )}
                >
                  {t('dental.units.mm', { value: row.distanceMm.toFixed(1) })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className="text-[10px] leading-snug text-slate-400">
        {t('dental.canal.hint')}
      </p>
    </div>
  );
}
