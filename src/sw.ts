/// <reference lib="webworker" />

import {
  cacheNamesFor,
  isLargeDataPath,
  isStorableResponse,
  pruneCacheNames,
  SW_VERSION_PLACEHOLDER,
  trimCache,
} from './lib/pwa/swCache';

interface BuildManifestEntry {
  file?: string;
  css?: string[];
  assets?: string[];
}

type BuildManifest = Record<string, BuildManifestEntry>;

// The build replaces the placeholder with a hash of the emitted files, so
// every deploy that changes the app installs a new worker with fresh caches
// and the previous deploy's caches are deleted when it activates.
const SW_VERSION: string = SW_VERSION_PLACEHOLDER;
const { shell: SHELL_CACHE, runtime: RUNTIME_CACHE } = cacheNamesFor(SW_VERSION);
const APP_SHELL_PATHS = [
  '',
  'index.html',
  'asset-manifest.json',
  'manifest.webmanifest',
  'favicon.png',
  'apple-touch-icon.png',
  'icons/pwa-192x192.png',
  'icons/pwa-512x512.png',
  'icons/maskable-512x512.png',
] as const;
const STATIC_DESTINATIONS = new Set<RequestDestination>([
  'document',
  'font',
  'image',
  'manifest',
  'script',
  'style',
  'worker',
]);

const sw = globalThis as unknown as ServiceWorkerGlobalScope;
const toAppUrl = (path: string) =>
  new URL(path, sw.registration.scope).toString();
const APP_SHELL_URLS = APP_SHELL_PATHS.map(toAppUrl);
const ASSET_MANIFEST_URL = toAppUrl('asset-manifest.json');
const INDEX_URL = toAppUrl('index.html');
const ROOT_URL = toAppUrl('');

async function storeRuntime(request: Request, response: Response) {
  if (!isStorableResponse(response)) return;
  const cache = await caches.open(RUNTIME_CACHE);
  await cache.put(request, response.clone());
  // Keep the runtime cache bounded; failures here only cost a cache miss.
  void trimCache(cache).catch(() => undefined);
}

// Static hosts like GitHub Pages can't send the Cross-Origin-Opener-Policy /
// Cross-Origin-Embedder-Policy headers that cross-origin isolation — and thus
// `SharedArrayBuffer` and onnxruntime-web's multi-threaded wasm — depend on.
// The worker re-stamps them onto every same-origin response so the document
// becomes isolated without any server cooperation. `credentialless` keeps
// cross-origin no-cors subresources loading without requiring CORP on them.
// See main.tsx for the one-time reload that lets a freshly installed worker
// take control of the first page load.
function withCrossOriginIsolation(response: Response): Response {
  // Opaque responses (status 0) have immutable, unreadable headers.
  if (response.status === 0) return response;

  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function getBuildAssetUrls(): Promise<string[]> {
  const assetUrls = new Set(APP_SHELL_URLS);

  try {
    const response = await fetch(ASSET_MANIFEST_URL, { cache: 'no-store' });
    if (!response.ok) return [...assetUrls];

    const manifest = (await response.json()) as BuildManifest;

    for (const entry of Object.values(manifest)) {
      if (!entry || typeof entry !== 'object') continue;

      if (typeof entry.file === 'string') {
        assetUrls.add(toAppUrl(entry.file));
      }

      for (const cssFile of entry.css ?? []) {
        assetUrls.add(toAppUrl(cssFile));
      }

      for (const assetFile of entry.assets ?? []) {
        assetUrls.add(toAppUrl(assetFile));
      }
    }
  } catch {
    return [...assetUrls];
  }

  return [...assetUrls];
}

async function installAppShell(): Promise<void> {
  const cache = await caches.open(SHELL_CACHE);
  const urls = await getBuildAssetUrls();
  // Bypass the HTTP cache so a new deploy never precaches a stale index.html.
  await cache.addAll(urls.map((url) => new Request(url, { cache: 'reload' })));
  await sw.skipWaiting();
}

sw.addEventListener('install', (event) => {
  event.waitUntil(installAppShell());
});

async function activateAppShell(): Promise<void> {
  const cacheNames = await caches.keys();
  await Promise.all(
    pruneCacheNames(cacheNames, [SHELL_CACHE, RUNTIME_CACHE]).map(
      (cacheName) => caches.delete(cacheName),
    ),
  );
  await sw.clients.claim();
}

sw.addEventListener('activate', (event) => {
  event.waitUntil(activateAppShell());
});

async function cached(request: Request | string) {
  const shell = await caches.open(SHELL_CACHE);
  const hit = await shell.match(request);
  if (hit) return hit;
  return (await caches.open(RUNTIME_CACHE)).match(request);
}

async function networkFirst(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    await storeRuntime(request, response);
    return withCrossOriginIsolation(response);
  } catch {
    const fallback =
      (await cached(request)) ??
      (await cached(INDEX_URL)) ??
      (await cached(ROOT_URL));
    return fallback ? withCrossOriginIsolation(fallback) : Response.error();
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cachedResponse = await cached(request);
  if (cachedResponse) return withCrossOriginIsolation(cachedResponse);

  const response = await fetch(request);
  await storeRuntime(request, response);
  return withCrossOriginIsolation(response);
}

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('Range')) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Scan packages, samples and models stream through untouched.
  if (isLargeDataPath(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (
    STATIC_DESTINATIONS.has(request.destination) ||
    url.pathname.startsWith(new URL('assets/', sw.registration.scope).pathname)
  ) {
    event.respondWith(cacheFirst(request));
  }
});
