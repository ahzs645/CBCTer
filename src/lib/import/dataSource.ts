import { ScanFolderSourceKind, type ScanFolderEntry, type ScanFolderSource } from '../../types';
import { expandArchiveEntries } from './archive';
import { inferMimeType, normalizeArchivePath } from './fileTypes';

export type ImportDataSource =
  | { id: string; type: 'file'; file: File; path?: string; parentId?: string }
  | { id: string; type: 'scan-folder'; source: ScanFolderSource; parentId?: string }
  | { id: string; type: 'uri'; uri: string; name?: string; mime?: string; parentId?: string }
  | { id: string; type: 'collection'; label: string; sources: ImportDataSource[]; parentId?: string };

export interface LoadedDataSourceFile {
  id: string;
  name: string;
  path: string;
  file: File;
}

export interface ImportPipelineResult {
  source: ScanFolderSource;
  provenance: Array<{
    id: string;
    type: ImportDataSource['type'] | 'archive';
    parentId?: string;
    label?: string;
  }>;
}

export function filesToScanFolderSource(
  label: string,
  files: LoadedDataSourceFile[],
): ScanFolderSource {
  const entries: ScanFolderEntry[] = files.map((item) => ({
    name: item.name,
    relativePath: normalizeArchivePath(item.path || item.name),
    file: item.file,
  }));
  return {
    kind: ScanFolderSourceKind.FileList,
    label,
    entries,
  };
}

export function makeFileWithInferredType(
  data: BlobPart[],
  name: string,
  options: FilePropertyBag = {},
): File {
  return new File(data, name, {
    ...options,
    type: options.type || inferMimeType(name),
  });
}

export function scanFolderDataSource(
  source: ScanFolderSource,
  parentId?: string,
): ImportDataSource {
  return {
    id: `scan-folder:${source.label}`,
    type: 'scan-folder',
    source,
    parentId,
  };
}

export function fileDataSource(
  file: File,
  path = file.name,
  parentId?: string,
): ImportDataSource {
  return {
    id: `file:${normalizeArchivePath(path)}`,
    type: 'file',
    file,
    path,
    parentId,
  };
}

export async function importDataSources(
  input: ImportDataSource | ImportDataSource[],
): Promise<ImportPipelineResult> {
  const queue = Array.isArray(input) ? [...input] : [input];
  const files: LoadedDataSourceFile[] = [];
  const provenance: ImportPipelineResult['provenance'] = [];
  let label = 'import';

  for (const source of queue) {
    provenance.push({
      id: source.id,
      type: source.type,
      parentId: source.parentId,
      label:
        source.type === 'collection'
          ? source.label
          : source.type === 'uri'
            ? source.uri
            : source.type === 'scan-folder'
              ? source.source.label
              : source.file.name,
    });

    if (source.type === 'collection') {
      label = source.label;
      queue.push(
        ...source.sources.map((child) => ({ ...child, parentId: source.id })),
      );
      continue;
    }

    if (source.type === 'uri') {
      const { loadRemoteImport } = await import('./remote');
      const loaded = await loadRemoteImport(source.uri);
      label = loaded.label;
      if (loaded.type === 'scan-folder') {
        queue.push(scanFolderDataSource(loaded.source, source.id));
      } else {
        queue.push(fileDataSource(loaded.file, loaded.file.name, source.id));
      }
      continue;
    }

    if (source.type === 'scan-folder') {
      label = source.source.label;
      const expanded = await expandArchiveEntries(source.source);
      provenance.push({
        id: `${source.id}:archive-expanded`,
        type: 'archive',
        parentId: source.id,
        label: expanded.label,
      });
      files.push(
        ...expanded.entries.map((entry, index) => ({
          id: `${source.id}:entry:${index}`,
          name: entry.name,
          path: entry.relativePath,
          file: entry.file,
        })),
      );
      continue;
    }

    files.push({
      id: source.id,
      name: source.file.name,
      path: normalizeArchivePath(source.path || source.file.name),
      file: source.file,
    });
  }

  return {
    source: filesToScanFolderSource(label, files),
    provenance,
  };
}
