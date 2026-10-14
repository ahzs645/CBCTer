import { X } from 'lucide-react';
import type { ScanComparison } from '../../lib/dental/compareScans';
import { cn } from '../../utils/cn';
import { Button } from '../Button';
import { FOCUS_RING } from '../Button.constants';

/**
 * Before/after comparison ("have my teeth moved?"): how far each tooth of a
 * later scan moved against the rest of the jaw. Presentational only; the
 * page loads the later scan and runs the comparison.
 */
export function ScanComparePanel({
  comparison,
  busy,
  status,
  onOpenAfterScan,
  onGoToTooth,
  onClose,
}: {
  comparison: ScanComparison | null;
  busy: boolean;
  status: string;
  onOpenAfterScan: () => void;
  onGoToTooth?: (fdi: number) => void;
  onClose?: () => void;
}) {
  return (
    <div className="space-y-2 text-xs text-slate-300">
      <div className="flex items-center gap-1.5">
        <Button
          variant="secondary"
          className="min-h-8 flex-1 px-2.5 text-xs"
          disabled={busy}
          onClick={onOpenAfterScan}
        >
          {comparison ? 'Open another later scan…' : 'Open a later scan…'}
        </Button>
        {onClose ? (
          <Button
            variant="quiet"
            size="icon"
            aria-label="Close comparison"
            title="Close comparison"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {status ? (
        <p role="status" aria-live="polite">
          {status}
        </p>
      ) : null}
      {comparison ? (
        <Results comparison={comparison} onGoToTooth={onGoToTooth} />
      ) : null}
      <p className="text-[10px] leading-snug text-slate-400">
        Compares tooth positions only. Small differences can come from scan
        noise; ask your orthodontist to confirm.
      </p>
    </div>
  );
}

function Results({
  comparison,
  onGoToTooth,
}: {
  comparison: ScanComparison;
  onGoToTooth?: (fdi: number) => void;
}) {
  const { teeth, noiseFloorMm, angleFloorDeg } = comparison;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <caption className="pb-0.5 text-left text-slate-400">
            Change since the earlier scan, largest first
          </caption>
          <thead className="text-slate-400">
            <tr>
              <th scope="col" className="py-0.5 pr-1 text-left font-normal">
                Tooth
              </th>
              <th scope="col" className="py-0.5 pr-1 text-right font-normal">
                Moved
              </th>
              <th scope="col" className="py-0.5 pr-1 text-left font-normal">
                Direction
              </th>
              <th
                scope="col"
                className="py-0.5 pr-1 text-right font-normal"
                title="Tipped or turned, in degrees"
              >
                Angle
              </th>
              <th
                scope="col"
                className="py-0.5 text-right font-normal"
                title="Largest surface difference once the tooth is lined up (wear, chips, fillings)"
              >
                Shape
              </th>
            </tr>
          </thead>
          <tbody>
            {teeth.map((t) => {
              const angle = t.rotationDeg > angleFloorDeg;
              const moved = t.translationMm > noiseFloorMm;
              return (
                <tr
                  key={t.beforeId}
                  className={cn(
                    'border-t border-slate-800',
                    !t.measurable && !t.shapeChanged && 'text-slate-500',
                  )}
                >
                  <td className="py-0.5 pr-1">
                    {onGoToTooth ? (
                      <button
                        type="button"
                        className={cn(
                          'rounded underline-offset-2 hover:underline',
                          FOCUS_RING,
                        )}
                        title={`Go to tooth ${t.fdi}`}
                        onClick={() => onGoToTooth(t.fdi)}
                      >
                        {t.fdi}
                      </button>
                    ) : (
                      t.fdi
                    )}
                    {t.reference ? (
                      <span
                        className="ml-0.5 text-slate-500"
                        title="Used to line the scans up"
                      >
                        ·
                      </span>
                    ) : null}
                  </td>
                  <td
                    className={cn(
                      'py-0.5 pr-1 text-right font-mono',
                      moved && 'text-amber-200',
                    )}
                  >
                    {t.translationMm.toFixed(1)}
                  </td>
                  <td className="py-0.5 pr-1">{t.direction}</td>
                  <td
                    className={cn(
                      'py-0.5 pr-1 text-right font-mono',
                      angle && 'text-amber-200',
                    )}
                  >
                    {angle ? `${Math.round(t.rotationDeg)}°` : '–'}
                  </td>
                  <td
                    className={cn(
                      'py-0.5 text-right font-mono',
                      t.shapeChanged && 'text-amber-200',
                    )}
                  >
                    {t.shapeChanged ? t.shapeChangeMm.toFixed(1) : '–'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-400">
        mm; changes under {noiseFloorMm.toFixed(1)} mm or{' '}
        {Math.round(angleFloorDeg)}° are below what the scans can show. · marks
        the teeth used to line the scans up.
      </p>
      <ul className="list-disc space-y-0.5 pl-4">
        {comparison.summary.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </>
  );
}
