/**
 * Resolve a model-weight URL. Defaults to the app's own `/models/` (served from
 * the build), but can be pointed at an external bucket/CDN (e.g. Cloudflare R2)
 * for the large nnU-Net weights that are too big to ship in git, by setting
 * `VITE_MODEL_BASE_URL` at build time.
 */
export function modelUrl(file: string): string {
  const raw =
    import.meta.env.VITE_MODEL_BASE_URL ??
    `${import.meta.env.BASE_URL}models/`;
  const base = raw.endsWith('/') ? raw : `${raw}/`;
  return `${base}${file}`;
}
