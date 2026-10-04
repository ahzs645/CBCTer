import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from '../../i18n';

const SHORTCUTS: Array<{ keys: string[]; item: string }> = [
  { keys: ['N', 'Esc'], item: 'navigate' },
  { keys: ['W'], item: 'contrast' },
  { keys: ['D'], item: 'distance' },
  { keys: ['A'], item: 'angle' },
  { keys: ['E'], item: 'area' },
  { keys: ['P'], item: 'polygon' },
  { keys: ['I'], item: 'invert' },
  { keys: ['1–6'], item: 'presets' },
  { keys: ['↑', '↓'], item: 'slice' },
  { keys: ['Wheel'], item: 'wheel' },
  { keys: ['+', '−', '0'], item: 'zoom' },
  { keys: ['F'], item: 'maximize' },
  { keys: ['S'], item: 'snapshot' },
  { keys: ['?'], item: 'help' },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t('dental.shortcuts.close')}
        className="absolute inset-0 bg-slate-950/70"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('dental.shortcuts.title')}
        className="relative w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">
            {t('dental.shortcuts.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('dental.shortcuts.close')}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.item} className="contents">
              <dt className="flex gap-1">
                {shortcut.keys.map((key) => (
                  <kbd
                    key={key}
                    className="min-w-6 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-center font-mono text-[11px] text-slate-200"
                  >
                    {key}
                  </kbd>
                ))}
              </dt>
              <dd className="self-center text-slate-300">
                {t(`dental.shortcuts.items.${shortcut.item}`)}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
