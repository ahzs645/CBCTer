import { useEffect } from 'react';

export const DEFAULT_UNSAVED_MESSAGE =
  'You have unsaved changes. Leave anyway?';

/**
 * Builds the `beforeunload` listener that asks the browser to confirm leaving.
 * Browsers show their own wording; `message` only reaches very old ones.
 */
export function createUnsavedHandler(message = DEFAULT_UNSAVED_MESSAGE) {
  return (event: BeforeUnloadEvent) => {
    event.preventDefault();
    // Legacy Chrome/Edge and Safari still need returnValue set.
    event.returnValue = message;
    return message;
  };
}

/**
 * While `dirty`, warns before the tab is closed, reloaded or navigated away.
 * The listener is removed as soon as the edits are saved, so a clean page
 * stays eligible for the back/forward cache.
 */
export function useUnsavedWarning(dirty: boolean, message?: string) {
  useEffect(() => {
    if (!dirty || typeof window === 'undefined') return;
    const handler = createUnsavedHandler(message);
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, message]);
}
