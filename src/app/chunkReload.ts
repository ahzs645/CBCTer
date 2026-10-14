const CHUNK_RELOAD_KEY = 'cbcter:chunk-reload';

/** A lazy page or worker script from an older deploy is no longer served. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|Importing a module script failed|Failed to fetch dynamically|error loading dynamically imported|ChunkLoadError/i.test(
    message,
  );
}

/** Reload once to pick up the new deploy; a second failure is shown. */
export function reloadForNewDeploy(): boolean {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export function clearChunkReloadMarker() {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    // Storage can be unavailable in private modes; nothing to clear.
  }
}
