/**
 * Cache policy for the service worker (src/sw.ts), kept free of worker globals
 * so it can be unit tested.
 */

/** Replaced in the built sw.js with a hash of the build (see vite.config.ts). */
export const SW_VERSION_PLACEHOLDER = '__CBCTER_SW_VERSION__';

const CACHE_PREFIX = 'cbcter-';
/** Caches written by earlier builds, before names carried a version. */
const LEGACY_CACHE_PREFIXES = ['voxel-viewer-shell-'];

/** Runtime cache limits: entries beyond these are evicted oldest first. */
export const MAX_RUNTIME_ENTRIES = 80;
/** Responses larger than this are served but never stored (bytes). */
export const MAX_RUNTIME_ENTRY_BYTES = 40 * 1024 * 1024;

export function cacheNamesFor(version: string) {
  return {
    /** App shell precached on install: index.html, hashed bundles, icons. */
    shell: `${CACHE_PREFIX}shell-${version}`,
    /** Same-origin static files fetched later (lazy chunks, wasm, images). */
    runtime: `${CACHE_PREFIX}runtime-${version}`,
  };
}

/**
 * Caches to delete when a new worker activates: every cache this app created
 * that is not in `keep`. Caches made by anything else on the origin are left.
 */
export function pruneCacheNames(
  names: readonly string[],
  keep: readonly string[],
): string[] {
  const kept = new Set(keep);
  return names.filter(
    (name) =>
      !kept.has(name) &&
      (name.startsWith(CACHE_PREFIX) ||
        LEGACY_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix))),
  );
}

/** Scan data and models are large and fetched by range: never cache them. */
const LARGE_DATA_PATH =
  /\.(zip|nii|gz|dcm|raw|onnx|ort|npy|nrrd|vol)$|\/(sample-cbct|sample-dicom|e2e-sample-cbct|models)\//i;

export function isLargeDataPath(pathname: string): boolean {
  return LARGE_DATA_PATH.test(pathname);
}

/** A full, same-origin, reasonably small response that may be stored. */
export function isStorableResponse(response: Response): boolean {
  if (response.status !== 200) return false;
  if (response.type !== 'basic' && response.type !== 'default') return false;
  if (response.headers.has('content-range')) return false;
  const length = Number(response.headers.get('content-length'));
  return !(Number.isFinite(length) && length > MAX_RUNTIME_ENTRY_BYTES);
}

/** Removes the oldest entries so at most `max` remain. */
export async function trimCache(
  cache: Pick<Cache, 'keys' | 'delete'>,
  max = MAX_RUNTIME_ENTRIES,
): Promise<number> {
  const keys = await cache.keys();
  const excess = keys.slice(0, Math.max(0, keys.length - max));
  await Promise.all(excess.map((request) => cache.delete(request)));
  return excess.length;
}
