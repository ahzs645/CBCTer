import { Eye, EyeOff } from 'lucide-react';
import type { ToothInstance } from '../../lib/case/types';
import { cn } from '../../utils/cn';

export interface LayerRow {
  tooth: ToothInstance;
  name: string;
  color: string;
}

/**
 * Per-structure visibility and colour for the tooth outlines, plus one
 * opacity for all of them (like a layer list in an image editor).
 */
export function LayerList({
  rows,
  hidden,
  opacity,
  onToggle,
  onShowAll,
  onColor,
  onOpacity,
}: {
  rows: LayerRow[];
  hidden: Set<string>;
  opacity: number;
  onToggle: (id: string) => void;
  onShowAll: (visible: boolean) => void;
  onColor: (id: string, color: string) => void;
  onOpacity: (opacity: number) => void;
}) {
  const allVisible = rows.every((row) => !hidden.has(row.tooth.id));
  return (
    <div className="space-y-1.5 text-xs text-slate-300">
      <label className="block">
        <span className="flex justify-between text-[11px]">
          <span>Outline opacity</span>
          <span className="font-mono">{Math.round(opacity * 100)}%</span>
        </span>
        <input
          type="range"
          aria-label="Outline opacity"
          min={0}
          max={2}
          step={0.05}
          value={opacity}
          onChange={(e) => onOpacity(Number(e.target.value))}
          className="h-6 w-full accent-sky-400"
        />
      </label>
      <button
        type="button"
        className="text-[11px] text-sky-300 underline"
        onClick={() => onShowAll(!allVisible)}
      >
        {allVisible ? 'Hide all outlines' : 'Show all outlines'}
      </button>
      <ul
        className="grid grid-cols-2 gap-x-2 gap-y-0.5"
        aria-label="Tooth layers"
      >
        {rows.map(({ tooth, name, color }) => {
          const visible = !hidden.has(tooth.id);
          return (
            <li key={tooth.id} className="flex min-w-0 items-center gap-1.5">
              <input
                type="color"
                aria-label={`${name} colour`}
                value={color}
                onChange={(e) => onColor(tooth.id, e.target.value)}
                className="h-5 w-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
              />
              <button
                type="button"
                aria-pressed={visible}
                aria-label={`${visible ? 'Hide' : 'Show'} ${name}`}
                onClick={() => onToggle(tooth.id)}
                className={cn(
                  'flex min-h-7 min-w-0 flex-1 items-center gap-1 rounded px-1 text-left hover:bg-slate-800',
                  !visible && 'text-slate-500 line-through',
                )}
              >
                {visible ? (
                  <Eye className="h-3 w-3 shrink-0" aria-hidden="true" />
                ) : (
                  <EyeOff className="h-3 w-3 shrink-0" aria-hidden="true" />
                )}
                <span className="truncate">{name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
