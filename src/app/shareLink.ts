/**
 * Share links open a remote scan package directly:
 *   https://<site>/#url=<encoded package URL>&tooth=<FDI>
 * The hash never reaches the hosting server or Referer headers. `?url=` is
 * accepted too. Only the package URL and the view travel in the link; the
 * scan itself stays wherever it is hosted.
 */
export interface ShareLink {
  url: string;
  /** FDI number of a tooth to select after opening. */
  tooth?: number;
  /** Small case corrections (see lib/case/caseEdits editsToLinkParams). */
  edits?: Record<string, string>;
}

/**
 * File-sharing pages that refuse to serve files to other websites. Google
 * Drive answers browser requests from another site with 403 (it rejects
 * `Sec-Fetch-Site: cross-site`, which pages cannot change), and the others
 * return HTML pages without CORS headers.
 */
const BLOCKED_HOSTS: Array<[RegExp, string]> = [
  [
    /(^|\.)(drive|docs)\.google\.com$|^drive\.usercontent\.google\.com$/i,
    'Google Drive',
  ],
  [/(^|\.)dropbox(usercontent)?\.com$/i, 'Dropbox'],
  [/(^|\.)(onedrive\.live\.com|1drv\.ms|sharepoint\.com)$/i, 'OneDrive'],
  [/(^|\.)icloud\.com$/i, 'iCloud'],
  [/(^|\.)wetransfer\.com$|^we\.tl$/i, 'WeTransfer'],
];

/** A friendly explanation when a link points at a host browsers can't read. */
export function blockedHostMessage(url: string): string | null {
  let host: string;
  try {
    host = new URL(url.trim()).hostname;
  } catch {
    return null;
  }
  const match = BLOCKED_HOSTS.find(([pattern]) => pattern.test(host));
  return match
    ? `${match[1]} doesn't let other websites read its files, so CBCTer can't open this link directly. Download the file, then drop it on this page (or use Open ZIP file). To share a link that opens in CBCTer, host the .cbct.zip on a server that allows cross-site range requests, such as Hugging Face, GitHub (raw files under 100 MB) or an S3/R2 bucket with CORS.`
    : null;
}

export function readShareLink(location: {
  hash: string;
  search: string;
}): ShareLink | null {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(location.search);
  const url = params.get('url') ?? query.get('url');
  if (!url || !/^https:\/\//i.test(url)) return null;
  const tooth = Number(params.get('tooth') ?? query.get('tooth'));
  const edits: Record<string, string> = {};
  for (const key of ['swap', 'merge']) {
    const value = params.get(key) ?? query.get(key);
    if (value) edits[key] = value;
  }
  return {
    url,
    ...(Number.isInteger(tooth) && tooth >= 11 && tooth <= 85 ? { tooth } : {}),
    ...(Object.keys(edits).length ? { edits } : {}),
  };
}

export function buildShareLink(page: string, link: ShareLink): string {
  const base = page.replace(/[#?].*$/, '');
  const params = new URLSearchParams({ url: link.url });
  if (link.tooth) params.set('tooth', String(link.tooth));
  for (const [key, value] of Object.entries(link.edits ?? {}))
    params.set(key, value);
  return `${base}#${params.toString()}`;
}
