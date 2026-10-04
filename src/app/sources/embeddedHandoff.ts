import {
  ScanFolderSourceKind,
  type ScanFolderEntry,
  type ScanFolderSource,
} from '../../types';

/**
 * Receiving a scan folder from the page that embeds the viewer.
 *
 * A health-record app (Mere) keeps a person's CBCT as a folder of DICOM files
 * and opens the viewer in an iframe to show it. Popups don't work for this:
 * the viewer is served with `Cross-Origin-Opener-Policy: same-origin`, which
 * severs `window.opener`, so the files travel by `postMessage` into the frame
 * instead. Files are structured-cloneable, so nothing is uploaded anywhere —
 * they move from one tab's memory to the frame's.
 *
 * Protocol (version 1):
 *   viewer → parent  { type: 'cbcter:ready', protocol: 1 }
 *   parent → viewer  { type: 'cbcter:scan-folder', protocol: 1,
 *                      label: string,
 *                      entries: [{ name, relativePath, file: File }] }
 *
 * The viewer only takes the folder from its own parent window, and only when
 * opened with `?handoff=postmessage`. An origin allowlist can be set at build
 * time with `VITE_HANDOFF_ORIGINS` (comma-separated); left empty, any parent
 * is accepted, since the files are ones the person chose to open.
 */

export const HANDOFF_PROTOCOL = 1;
export const READY_MESSAGE = 'cbcter:ready';
export const FOLDER_MESSAGE = 'cbcter:scan-folder';

export function isHandoffRequested(search: string, isFramed: boolean): boolean {
  return (
    isFramed && new URLSearchParams(search).get('handoff') === 'postmessage'
  );
}

export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function isOriginAllowed(origin: string, allowed: string[]): boolean {
  return allowed.length === 0 || allowed.includes(origin);
}

const isFile = (value: unknown): value is File =>
  typeof File !== 'undefined' && value instanceof File;

/**
 * A handoff message → a scan folder source, or null if it isn't one. Entries
 * without a real File, or with a path that tries to climb out of the folder,
 * are dropped rather than trusted.
 */
export function toScanFolderSource(data: unknown): ScanFolderSource | null {
  if (!data || typeof data !== 'object') return null;
  const message = data as {
    type?: unknown;
    protocol?: unknown;
    label?: unknown;
    entries?: unknown;
  };
  if (message.type !== FOLDER_MESSAGE || message.protocol !== HANDOFF_PROTOCOL)
    return null;
  if (!Array.isArray(message.entries)) return null;

  const entries: ScanFolderEntry[] = [];
  for (const entry of message.entries as Array<Record<string, unknown>>) {
    if (!entry || !isFile(entry.file)) continue;
    const name =
      typeof entry.name === 'string' && entry.name
        ? entry.name
        : entry.file.name;
    const relativePath =
      typeof entry.relativePath === 'string' && entry.relativePath
        ? entry.relativePath
        : name;
    if (relativePath.split('/').includes('..')) continue;
    entries.push({ name, relativePath, file: entry.file });
  }
  if (entries.length === 0) return null;

  return {
    kind: ScanFolderSourceKind.Handoff,
    label:
      typeof message.label === 'string' && message.label
        ? message.label
        : 'Shared scan',
    entries,
  };
}

/**
 * Tell the parent we're ready and wait for a folder. Returns a function that
 * stops listening.
 */
export function listenForHandoff(
  onSource: (source: ScanFolderSource) => void,
  {
    win = window,
    allowedOrigins = parseAllowedOrigins(
      import.meta.env?.VITE_HANDOFF_ORIGINS as string | undefined,
    ),
  }: { win?: Window; allowedOrigins?: string[] } = {},
): () => void {
  const parent = win.parent;
  const onMessage = (event: MessageEvent) => {
    if (event.source !== parent) return;
    if (!isOriginAllowed(event.origin, allowedOrigins)) return;
    const source = toScanFolderSource(event.data);
    if (source) onSource(source);
  };
  win.addEventListener('message', onMessage);
  // The ready signal carries no data, so it can go to whichever origin
  // embedded us; the folder itself is only accepted from that parent.
  parent.postMessage(
    { type: READY_MESSAGE, protocol: HANDOFF_PROTOCOL },
    allowedOrigins.length === 1 ? allowedOrigins[0] : '*',
  );
  return () => win.removeEventListener('message', onMessage);
}
