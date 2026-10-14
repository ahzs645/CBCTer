import { cn } from '../../utils/cn';

export type CanalSide = 'right' | 'left';

const button =
  'inline-flex min-h-8 [@media(pointer:coarse)]:min-h-9 items-center justify-center rounded border border-slate-600 bg-slate-800 px-2.5 text-xs hover:bg-slate-700 disabled:opacity-40';

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
  const sideLabel = (side: CanalSide) =>
    side === 'right' ? "Patient's right" : "Patient's left";
  return (
    <div className="space-y-2 text-xs text-slate-300">
      {picking ? (
        <div
          className="rounded border border-pink-400/50 bg-pink-950/30 p-2 text-pink-100"
          role="status"
        >
          {sideLabel(picking)} canal: click{' '}
          {pickedPoints === 0 ? 'one end of the canal' : 'the other end'} on a
          slice.
          <button type="button" className="ml-2 underline" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-1.5">
        {(['right', 'left'] as const).map((side) => (
          <div key={side} className="space-y-1">
            <button
              type="button"
              className={cn(
                button,
                'w-full',
                picking === side && 'border-pink-400',
              )}
              disabled={busy || Boolean(picking)}
              onClick={() => onPick(side)}
            >
              {traced[side] != null ? 'Re-trace' : 'Trace'} {side}
            </button>
            {traced[side] != null ? (
              <p className="text-[11px] text-slate-400">
                {traced[side]!.toFixed(0)} mm traced ·{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => onClear(side)}
                >
                  remove
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
            Closest teeth to the canal (surface to canal wall)
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
                  {row.distanceMm.toFixed(1)} mm
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className="text-[10px] leading-snug text-slate-400">
        The canal is a thin dark tube with a bright rim low in the back of the
        lower jaw; it is easiest to see on coronal slices. Tracing is
        approximate and assumes a 2.5 mm canal. Check it slice by slice; it is
        not suitable for implant or surgical planning.
      </p>
    </div>
  );
}
