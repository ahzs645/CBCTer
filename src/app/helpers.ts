import { i18n } from '../i18n';
import type { ImportIssue, ImportProgress, Vec3 } from '../types';
import { ImportStage } from '../types';

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function isBusy(progress: ImportProgress): boolean {
  return ![ImportStage.Idle, ImportStage.Ready, ImportStage.Error].includes(
    progress.stage,
  );
}

export function makeImportIssue(error: unknown): ImportIssue {
  if (error && typeof error === 'object') {
    const value = error as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
    };

    if (typeof value.message === 'string') {
      const code =
        typeof value.code === 'string'
          ? value.code
          : typeof value.name === 'string'
            ? value.name
            : 'E_IMPORT';

      if (code === 'E_FORMAT') {
        return {
          code,
          message: i18n.t('errors.unsupportedFolderLayout'),
        };
      }

      return {
        code,
        message: value.message,
      };
    }
  }

  return {
    code: 'E_IMPORT',
    message: i18n.t('errors.failedToLoadSelectedScanFolder'),
  };
}

export function formatSpacing(spacing: Vec3): string {
  return spacing.map((value) => value.toFixed(2)).join(' x ');
}
