import { Layers } from 'lucide-react';
import { useTranslation } from '../../i18n';
import type { ParsedVolumeMeta } from '../../types';
import { cn } from '../../utils/cn';

/**
 * Full / phone level toggle for scan packages that carry both. Switching
 * reopens the package at the other level (only that level is read).
 */
export function PackageLevelSwitch({
  meta,
  busy,
  onChange,
}: {
  meta: ParsedVolumeMeta;
  busy: boolean;
  onChange: (level: 'full' | 'half') => void;
}) {
  const { t } = useTranslation();
  const levels = meta.packageLevels ?? [];
  if (levels.length < 2 || !meta.packageLevel) return null;
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300">
          <Layers className="h-3.5 w-3.5" aria-hidden="true" />
          {t('dental.package.levelTitle')}
        </span>
        <div
          className="inline-flex rounded border border-slate-700 p-0.5"
          role="group"
          aria-label={t('dental.package.levelTitle')}
        >
          {levels.map((level) => (
            <button
              key={level.id}
              type="button"
              disabled={busy}
              aria-pressed={meta.packageLevel === level.id}
              title={`${level.dimensions.join(' × ')} · ${level.spacing[0].toFixed(2)} mm`}
              onClick={() => meta.packageLevel !== level.id && onChange(level.id)}
              className={cn(
                'h-6 rounded px-2 text-[11px] transition disabled:opacity-50',
                meta.packageLevel === level.id
                  ? 'bg-slate-200 text-slate-950'
                  : 'text-slate-400 hover:text-slate-100',
              )}
            >
              {level.id === 'full'
                ? t('dental.package.levelFull')
                : t('dental.package.levelHalf')}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{t('dental.package.levelHint')}</p>
    </div>
  );
}
