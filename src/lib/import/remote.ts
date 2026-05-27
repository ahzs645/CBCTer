import {
  filesToScanFolderSource,
  makeFileWithInferredType,
  type ImportDataSource,
  type LoadedDataSourceFile,
} from './dataSource';
import { getExtension, inferMimeType, normalizeArchivePath } from './fileTypes';

export interface RemoteManifestEntry {
  url: string;
  name?: string;
  mime?: string;
}

export interface RemoteManifest {
  name?: string;
  files?: RemoteManifestEntry[];
  resources?: RemoteManifestEntry[];
}

type RemoteScanFolderSource = ReturnType<typeof filesToScanFolderSource>;

export type LoadedRemoteImport =
  | { type: 'scan-folder'; label: string; source: RemoteScanFolderSource }
  | { type: 'nifti'; label: string; file: File };

function filenameFromUrl(url: string): string {
  try {
    const base =
      typeof window === 'undefined' ? 'http://localhost/' : window.location.href;
    const parsed = new URL(url, base);
    const pathname = decodeURIComponent(parsed.pathname);
    return pathname.split('/').filter(Boolean).pop() || 'download';
  } catch {
    return url.split('/').filter(Boolean).pop() || 'download';
  }
}

export function filenameFromContentDisposition(
  value: string | null,
): string | undefined {
  if (!value) return undefined;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (encoded) return decodeURIComponent(encoded.replace(/^"|"$/g, ''));
  const plain = /filename="?([^";]+)"?/i.exec(value)?.[1];
  return plain?.trim();
}

function isRemoteManifest(value: unknown): value is RemoteManifest {
  const entries = (value as RemoteManifest | null)?.files ??
    (value as RemoteManifest | null)?.resources;
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    Array.isArray(entries) &&
    entries.every(
      (entry) =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof (entry as RemoteManifestEntry).url === 'string',
    )
  );
}

function manifestEntries(manifest: RemoteManifest): RemoteManifestEntry[] {
  return manifest.files ?? manifest.resources ?? [];
}

async function fetchRemoteFile(
  entry: RemoteManifestEntry,
  index = 0,
): Promise<LoadedDataSourceFile> {
  const response = await fetch(entry.url);
  if (!response.ok) {
    throw new Error(`Remote import failed for ${entry.url}: ${response.status}`);
  }

  const name =
    entry.name ||
    filenameFromContentDisposition(response.headers.get('content-disposition')) ||
    filenameFromUrl(response.url || entry.url) ||
    `remote-${index}`;
  const type =
    entry.mime || response.headers.get('content-type') || inferMimeType(name);
  const blob = await response.blob();
  const file = makeFileWithInferredType([blob], name, { type });

  return {
    id: `remote-${index}`,
    name,
    path: normalizeArchivePath(name),
    file,
  };
}

export async function loadRemoteImport(url: string): Promise<LoadedRemoteImport> {
  const first = await fetchRemoteFile({ url }, 0);
  const ext = getExtension(first.name);
  const looksJson =
    ext === '.json' ||
    first.file.type.includes('json') ||
    first.file.type === 'application/octet-stream';

  if (looksJson) {
    try {
      const parsed = JSON.parse(await first.file.text()) as unknown;
      if (isRemoteManifest(parsed)) {
        const files = await Promise.all(
          manifestEntries(parsed).map((entry, index) =>
            fetchRemoteFile(entry, index),
          ),
        );
        const label =
          parsed.name || first.name.replace(/\.json$/i, '') || 'remote manifest';
        return {
          type: 'scan-folder',
          label,
          source: filesToScanFolderSource(label, files),
        };
      }
    } catch {
      // Fall through and treat the download as a regular file.
    }
  }

  if (
    ext === '.nii' ||
    ext === '.nii.gz' ||
    first.file.type === 'application/vnd.nifti'
  ) {
    return { type: 'nifti', label: first.name, file: first.file };
  }

  return {
    type: 'scan-folder',
    label: first.name,
    source: filesToScanFolderSource(first.name, [first]),
  };
}

export function uriDataSource(
  uri: string,
  name?: string,
  mime?: string,
): ImportDataSource {
  return {
    id: `uri:${uri}`,
    type: 'uri',
    uri,
    name,
    mime,
  };
}
