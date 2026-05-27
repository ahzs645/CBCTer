import { ScanFolderSourceKind, type ScanFolderEntry, type ScanFolderSource } from '../../types';
import { inferMimeType, normalizeArchivePath } from './fileTypes';

export type ImportDataSource =
  | { id: string; type: 'file'; file: File; path?: string }
  | { id: string; type: 'uri'; uri: string; name?: string; mime?: string }
  | { id: string; type: 'collection'; label: string; sources: ImportDataSource[] };

export interface LoadedDataSourceFile {
  id: string;
  name: string;
  path: string;
  file: File;
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
