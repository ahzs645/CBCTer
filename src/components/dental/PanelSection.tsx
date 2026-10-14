import { ChevronRight, Info } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import { cn } from '../../utils/cn';
import { FOCUS_RING } from '../Button.constants';

function readOpen(key: string | undefined, fallback: boolean) {
  if (!key) return fallback;
  try {
    const value = window.localStorage.getItem(`cbcter.section.${key}`);
    return value === null ? fallback : value === '1';
  } catch {
    return fallback;
  }
}

/**
 * A side-panel section. Secondary tools pass `collapsible` so the panel
 * opens short: the header shows the title and a one-line `summary` of the
 * tool's state, and the open/closed choice is remembered per `id`.
 */
export function PanelSection({
  id,
  title,
  summary,
  collapsible = false,
  defaultOpen = true,
  children,
}: {
  id?: string;
  title: string;
  summary?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() =>
    collapsible ? readOpen(id, defaultOpen) : true,
  );
  const heading = (
    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
      {title}
    </span>
  );
  if (!collapsible)
    return (
      <section className="space-y-2 border-b border-slate-800 px-3 py-2.5 [@media(pointer:coarse)]:space-y-4">
        <h2>{heading}</h2>
        {children}
      </section>
    );
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      if (id)
        window.localStorage.setItem(`cbcter.section.${id}`, next ? '1' : '0');
    } catch {
      // Remembering is a convenience; private windows may refuse it.
    }
  };
  return (
    <section className="border-b border-slate-800 px-3 py-1.5">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          className={cn(
            'touch-target flex min-h-8 w-full items-center gap-1.5 rounded text-left',
            FOCUS_RING,
          )}
        >
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform',
              open && 'rotate-90',
            )}
            aria-hidden="true"
          />
          {heading}
          {summary && !open ? (
            <span className="ml-auto truncate pl-2 text-[11px] normal-case text-slate-500">
              {summary}
            </span>
          ) : null}
        </button>
      </h2>
      {open ? (
        <div className="space-y-2 pb-1 pt-1 [@media(pointer:coarse)]:space-y-4 [@media(pointer:coarse)]:pt-2">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * One short line of help, with the longer explanation one tap away instead
 * of always on screen.
 */
export function Hint({
  children,
  more,
  className,
}: {
  children?: ReactNode;
  /** The longer explanation, shown on request. */
  more?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        'text-[11px] leading-snug text-slate-400 [@media(pointer:coarse)]:pt-2',
        className,
      )}
    >
      <p>
        {children}
        {more ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? t('dental.hint.less') : t('dental.hint.more')}
            title={open ? t('dental.hint.less') : t('dental.hint.more')}
            onClick={() => setOpen((value) => !value)}
            className={cn(
              'touch-target ml-1 inline-flex h-4 w-4 translate-y-[3px] items-center justify-center rounded-full text-slate-500 hover:text-slate-200',
              FOCUS_RING,
            )}
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </p>
      {open ? <p className="mt-1 text-slate-300">{more}</p> : null}
    </div>
  );
}
