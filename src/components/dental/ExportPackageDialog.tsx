import { FileArchive, LoaderCircle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n';
import {
  anonymousScanName,
  type ScanPackageContents,
  scanPackageFileName,
} from '../../lib/import/scanPackage';
import type { Vec3 } from '../../types';
import { cn } from '../../utils/cn';
import { Button } from '../Button';

interface ExportPackageDialogProps {
  scanId: string;
  dimensions: Vec3;
  /** Phones get a bottom sheet with bigger targets. */
  touch?: boolean;
  onExport: (options: {
    name: string;
    contents: ScanPackageContents;
    includePreview: boolean;
  }) => Promise<{ bytes: number }>;
  onClose: () => void;
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

/**
 * "Export slim package": writes a `.cbct.zip` with only the volume and its
 * geometry, so a vendor disc export can be shared and reopened without the
 * vendor viewer, installers, raw projections or patient metadata.
 */
export function ExportPackageDialog({
  scanId,
  dimensions,
  touch = false,
  onExport,
  onClose,
}: ExportPackageDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(() => anonymousScanName(scanId));
  const [contents, setContents] = useState<ScanPackageContents>('full+half');
  const [includePreview, setIncludePreview] = useState(true);
  const [status, setStatus] = useState<
    { state: 'idle' } | { state: 'packing' } | { state: 'done'; bytes: number } | { state: 'error'; message: string }
  >({ state: 'idle' });

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && status.state !== 'packing') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [onClose, status.state]);

  const voxels = dimensions[0] * dimensions[1] * dimensions[2];
  const rawBytes = (half: boolean) => (half ? voxels / 8 : voxels) * 2;
  const halfDims = dimensions.map((size) => Math.max(1, Math.floor(size / 2)));

  const run = async () => {
    setStatus({ state: 'packing' });
    try {
      const result = await onExport({
        name: name.trim() || anonymousScanName(scanId),
        contents,
        includePreview,
      });
      setStatus({ state: 'done', bytes: result.bytes });
    } catch (error) {
      setStatus({
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const option = (value: ScanPackageContents, title: string, detail: string) => (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition',
        touch && 'min-h-12',
        contents === value
          ? 'border-sky-500/70 bg-sky-500/10'
          : 'border-slate-700 hover:bg-slate-800/60',
      )}
    >
      <input
        type="radio"
        name="package-resolution"
        className="mt-1 accent-sky-400"
        checked={contents === value}
        onChange={() => setContents(value)}
      />
      <span>
        <span className="block text-sm text-slate-100">{title}</span>
        <span className="block text-[11px] text-slate-400">{detail}</span>
      </span>
    </label>
  );

  return (
    <div
      className={cn(
        'absolute inset-0 z-50 flex',
        touch ? 'items-end' : 'items-center justify-center p-4',
      )}
    >
      <button
        type="button"
        aria-label={t('dental.shortcuts.close')}
        className="absolute inset-0 bg-slate-950/70"
        onClick={() => status.state !== 'packing' && onClose()}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('dental.package.title')}
        className={cn(
          'relative w-full border-slate-700 bg-slate-900 shadow-2xl',
          touch
            ? 'max-h-[90dvh] overflow-y-auto rounded-t-2xl border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]'
            : 'max-w-md rounded-lg border p-4',
        )}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <FileArchive className="h-4 w-4 text-sky-300" aria-hidden="true" />
              {t('dental.package.title')}
            </h2>
            <p className="mt-1 text-xs text-slate-400">{t('dental.package.description')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={status.state === 'packing'}
            aria-label={t('dental.shortcuts.close')}
            className={cn(
              'inline-flex shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40',
              touch ? 'h-10 w-10' : 'h-7 w-7',
            )}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-slate-500">
            {t('dental.package.name')}
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-base text-slate-100 focus:border-sky-500 focus:outline-none sm:text-sm"
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            {t('dental.package.nameHint')} · {scanPackageFileName(name || 'cbct')}
          </span>
        </label>

        <div className="mt-3 space-y-1.5">
          {option(
            'full+half',
            t('dental.package.both'),
            t('dental.package.bothDetail', {
              full: formatMb(rawBytes(false)),
              half: formatMb(rawBytes(true)),
            }),
          )}
          {option(
            'full',
            t('dental.package.full'),
            t('dental.package.sizeDetail', {
              dims: dimensions.join(' × '),
              size: formatMb(rawBytes(false)),
            }),
          )}
          {option(
            'half',
            t('dental.package.half'),
            t('dental.package.sizeDetail', {
              dims: halfDims.join(' × '),
              size: formatMb(rawBytes(true)),
            }),
          )}
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            className="h-4 w-4 accent-sky-400"
            checked={includePreview}
            onChange={(event) => setIncludePreview(event.currentTarget.checked)}
          />
          {t('dental.package.preview')}
        </label>

        <p className="mt-3 rounded border border-slate-800 bg-slate-950/70 px-2.5 py-2 text-[11px] leading-4 text-slate-400">
          {t('dental.package.excluded')}
        </p>

        {status.state === 'done' ? (
          <p className="mt-3 text-xs text-emerald-300" role="status">
            {t('dental.package.done', { size: formatMb(status.bytes) })}
          </p>
        ) : null}
        {status.state === 'error' ? (
          <p className="mt-3 text-xs text-rose-300" role="alert">
            {status.message}
          </p>
        ) : null}

        <Button
          variant="primary"
          block
          className={cn('mt-3', touch && 'h-12 text-sm')}
          disabled={status.state === 'packing'}
          onClick={() => void run()}
        >
          {status.state === 'packing' ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <FileArchive className="h-4 w-4" aria-hidden="true" />
          )}
          {status.state === 'packing' ? t('dental.package.packing') : t('dental.package.export')}
        </Button>
      </section>
    </div>
  );
}
