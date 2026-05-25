import { Languages } from 'lucide-react';
import { normalizeLocale, useTranslation } from '../i18n';
import { cn } from '../utils/cn';
import { Select } from './Select';

interface LanguageSelectProps {
  floating?: boolean;
  className?: string;
}

export function LanguageSelect({
  floating = true,
  className,
}: LanguageSelectProps) {
  const { t, i18n } = useTranslation();
  const locale = normalizeLocale(i18n.resolvedLanguage ?? i18n.language);

  return (
    <div
      className={cn(
        floating ? 'absolute right-3 top-3 z-50 md:right-4 md:top-4' : '',
        className,
      )}
    >
      <label className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-slate-900/95 pl-2 pr-1.5 text-[11px] text-slate-300 shadow-lg shadow-slate-950/20 ring-1 ring-white/8">
        <Languages
          className="h-3.5 w-3.5 shrink-0 text-slate-500"
          aria-hidden="true"
        />
        <Select
          variant="bare"
          size="sm"
          align="right"
          className="min-w-0"
          buttonClassName="max-w-28 pl-0 text-[11px]"
          value={locale}
          onChange={(value) => void i18n.changeLanguage(value)}
          aria-label={t('common.language')}
          options={[
            { value: 'en', label: t('common.languages.en') },
            { value: 'uk', label: t('common.languages.uk') },
          ]}
        />
      </label>
    </div>
  );
}
