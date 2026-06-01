/// <reference lib="webworker" />

interface BuildManifestEntry {
  file?: string;
  css?: string[];
  assets?: string[];
}

type BuildManifest = Record<string, BuildManifestEntry>;

const CACHE_NAME = 'voxel-viewer-shell-v1';
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

const isCacheableResponse = (response: Response) =>
  response.ok && (response.type === 'basic' || response.type === 'default');

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
  const cache = await caches.open(CACHE_NAME);
  const urls = await getBuildAssetUrls();
  await cache.addAll(urls);
  await sw.skipWaiting();
}

sw.addEventListener('install', (event) => {
  event.waitUntil(installAppShell());
});

async function activateAppShell(): Promise<void> {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter((cacheName) => cacheName !== CACHE_NAME)
      .map((cacheName) => caches.delete(cacheName)),
  );
  await sw.clients.claim();
}

sw.addEventListener('activate', (event) => {
  event.waitUntil(activateAppShell());
});

async function networkFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);

    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone());
    }

    return withCrossOriginIsolation(response);
  } catch {
    const fallback =
      (await cache.match(request)) ??
      (await cache.match(INDEX_URL)) ??
      (await cache.match(ROOT_URL));
    return fallback ? withCrossOriginIsolation(fallback) : Response.error();
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) return withCrossOriginIsolation(cachedResponse);

  const response = await fetch(request);

  if (isCacheableResponse(response)) {
    await cache.put(request, response.clone());
  }

  return withCrossOriginIsolation(response);
}

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

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
