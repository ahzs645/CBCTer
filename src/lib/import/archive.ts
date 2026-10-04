import {
  type ScanFolderEntry,
  type ScanFolderSource,
  ScanFolderSourceKind,
} from '../../types';
import { inferMimeType, isZipFile, normalizeArchivePath } from './fileTypes';
import { readZipIndex } from './zipIndex';

const SCAN_PACKAGE_MANIFEST_NAME = 'cbct-scan.json';

/**
 * A CBCTer scan package zip (manifest at its root). Only the zip's central
 * directory is read to decide.
 */
async function isScanPackageZip(entry: ScanFolderEntry): Promise<boolean> {
  try {
    const index = await readZipIndex(entry.file);
    return index.some((item) => item.name === SCAN_PACKAGE_MANIFEST_NAME);
  } catch {
    return false;
  }
}

function basename(path: string): string {
  return normalizeArchivePath(path).split('/').pop() || path || 'file';
}

function withFileType(file: File, path: string): File {
  const type = file.type || inferMimeType(path);
  if (!type || file.type === type) return file;
  return new File([file], file.name, {
    type,
    lastModified: file.lastModified,
  });
}

async function expandZipEntry(entry: ScanFolderEntry): Promise<ScanFolderEntry[]> {
  const { unzipSync } = await import('fflate');
  const zipPath = normalizeArchivePath(entry.relativePath || entry.name);
  const zipRoot = zipPath.replace(/(?:\.cbcter)?\.zip$/i, '');
  const files = unzipSync(new Uint8Array(await entry.file.arrayBuffer()));

  return Object.entries(files)
    .map(([archivePath, data]) => {
      const normalizedPath = normalizeArchivePath(archivePath);
      if (!normalizedPath) return null;

      const relativePath = normalizeArchivePath(`${zipRoot}/${normalizedPath}`);
      const name = basename(normalizedPath);
      const file = new File([data], name, {
        type: inferMimeType(name),
        lastModified: entry.file.lastModified,
      });
      return { name, relativePath, file };
    })
    .filter((item): item is ScanFolderEntry => Boolean(item));
}

export async function expandArchiveEntries(
  source: ScanFolderSource,
): Promise<ScanFolderSource> {
  const expanded: ScanFolderEntry[] = [];
  let changed = false;

  for (const entry of source.entries) {
    if (await isZipFile(entry)) {
      if (await isScanPackageZip(entry)) {
        // Left zipped: the package importer reads only the level it opens,
        // so a phone never inflates the full-resolution volume.
        expanded.push({
          ...entry,
          relativePath: normalizeArchivePath(entry.relativePath || entry.name),
          archiveKind: 'cbct-package',
        });
        continue;
      }
      expanded.push(...(await expandZipEntry(entry)));
      changed = true;
    } else {
      const path = normalizeArchivePath(entry.relativePath || entry.name);
      expanded.push({
        name: entry.name,
        relativePath: path,
        file: withFileType(entry.file, path),
      });
    }
  }

  if (!changed) {
    return {
      ...source,
      entries: expanded,
    };
  }

  return {
    kind: ScanFolderSourceKind.FileList,
    label: source.label,
    entries: expanded,
  };
}
