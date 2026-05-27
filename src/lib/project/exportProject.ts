import type { StudyState } from '../../domain/types';
import { normalizeStudyState } from '../../domain/studyState';
import {
  normalizeArchivePath,
  sanitizePathSegment,
} from '../import/fileTypes';

export interface ProjectMaskExport {
  id: string;
  data: Uint8Array;
}

export interface ProjectLabelmapExport {
  id: string;
  data: Uint8Array;
}

export interface ProjectSurfaceExport {
  id: string;
  data: Uint8Array;
}

export interface ProjectExportInput {
  state: StudyState;
  masks: ProjectMaskExport[];
  labelmaps?: ProjectLabelmapExport[];
  surfaces: ProjectSurfaceExport[];
}

export interface ProjectArchiveManifestEntry {
  id: string;
  path: string;
  bytes: number;
}

export interface ProjectArchiveManifest {
  version: typeof PROJECT_ARCHIVE_VERSION;
  app: 'CBCTer';
  exportedAt: string;
  dataSources: ProjectArchiveDataSource[];
  state: StudyState;
  masks: ProjectArchiveManifestEntry[];
  labelmaps: ProjectArchiveManifestEntry[];
  surfaces: ProjectArchiveManifestEntry[];
}

interface ProjectArchiveManifestV1 {
  version: 1;
  exportedAt: string;
  state: StudyState;
  masks: ProjectArchiveManifestEntry[];
  surfaces: ProjectArchiveManifestEntry[];
}

export interface ProjectArchiveDataSource {
  id: string;
  kind: 'embedded';
  role: 'mask' | 'labelmap' | 'surface';
  path: string;
  bytes: number;
}

export interface ProjectArchive {
  manifest: ProjectArchiveManifest;
  masks: ProjectMaskExport[];
  labelmaps: ProjectLabelmapExport[];
  surfaces: ProjectSurfaceExport[];
}

export const PROJECT_ARCHIVE_MANIFEST = 'study.json';
export const PROJECT_ARCHIVE_VERSION = 2;

const textEncoder = new TextEncoder();

function allocateArchivePath(
  directory: string,
  id: string,
  extension: string,
  usedPaths: Set<string>,
): string {
  const stem = sanitizePathSegment(id);
  let index = 1;
  let path = normalizeArchivePath(`${directory}/${stem}.${extension}`);
  while (usedPaths.has(path.toLowerCase())) {
    index += 1;
    path = normalizeArchivePath(`${directory}/${stem}_${index}.${extension}`);
  }
  usedPaths.add(path.toLowerCase());
  return path;
}

function isManifestEntry(value: unknown): value is ProjectArchiveManifestEntry {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as ProjectArchiveManifestEntry).id === 'string' &&
    typeof (value as ProjectArchiveManifestEntry).path === 'string' &&
    Number.isInteger((value as ProjectArchiveManifestEntry).bytes) &&
    (value as ProjectArchiveManifestEntry).bytes >= 0
  );
}

function assertSafeArchivePath(path: string): string {
  const normalized = normalizeArchivePath(path);
  if (!normalized || normalized !== path.replace(/\\/g, '/')) {
    throw new Error(`Project package has an unsafe path: ${path}`);
  }
  return normalized;
}

function migrateProjectManifestV1(
  manifest: ProjectArchiveManifestV1,
): ProjectArchiveManifest {
  return {
    version: PROJECT_ARCHIVE_VERSION,
    app: 'CBCTer',
    exportedAt: manifest.exportedAt,
    dataSources: [
      ...manifest.masks.map((entry) => ({
        ...entry,
        kind: 'embedded' as const,
        role: 'mask' as const,
      })),
      ...manifest.surfaces.map((entry) => ({
        ...entry,
        kind: 'embedded' as const,
        role: 'surface' as const,
      })),
    ],
    state: manifest.state,
    masks: manifest.masks,
    labelmaps: [],
    surfaces: manifest.surfaces,
  };
}

export function parseProjectManifest(input: string): ProjectArchiveManifest {
  const raw = JSON.parse(input) as
    | Partial<ProjectArchiveManifest>
    | Partial<ProjectArchiveManifestV1>;
  const parsed =
    raw.version === 1
      ? migrateProjectManifestV1(raw as ProjectArchiveManifestV1)
      : raw;

  if (parsed.version !== PROJECT_ARCHIVE_VERSION || parsed.app !== 'CBCTer') {
    throw new Error('Unsupported project package version.');
  }
  if (!parsed.state || typeof parsed.state !== 'object') {
    throw new Error('Project package is missing study state.');
  }
  if (!Array.isArray(parsed.masks) || !parsed.masks.every(isManifestEntry)) {
    throw new Error('Project package has invalid mask entries.');
  }
  if (parsed.labelmaps === undefined) {
    parsed.labelmaps = [];
  }
  if (
    !Array.isArray(parsed.labelmaps) ||
    !parsed.labelmaps.every(isManifestEntry)
  ) {
    throw new Error('Project package has invalid labelmap entries.');
  }
  if (
    !Array.isArray(parsed.surfaces) ||
    !parsed.surfaces.every(isManifestEntry)
  ) {
    throw new Error('Project package has invalid surface entries.');
  }
  if (!Array.isArray(parsed.dataSources)) {
    throw new Error('Project package has invalid data sources.');
  }

  parsed.masks.forEach((entry) => assertSafeArchivePath(entry.path));
  parsed.labelmaps.forEach((entry) => assertSafeArchivePath(entry.path));
  parsed.surfaces.forEach((entry) => assertSafeArchivePath(entry.path));
  parsed.state = normalizeStudyState(parsed.state as Partial<StudyState>);

  return parsed as ProjectArchiveManifest;
}

export async function buildProjectArchive({
  state,
  masks,
  labelmaps = [],
  surfaces,
}: ProjectExportInput): Promise<Blob> {
  const { zipSync } = await import('fflate');
  const usedPaths = new Set<string>([PROJECT_ARCHIVE_MANIFEST]);
  const maskEntries = masks.map((mask) => ({
    id: mask.id,
    path: allocateArchivePath('masks', mask.id, 'bin', usedPaths),
    bytes: mask.data.byteLength,
  }));
  const surfaceEntries = surfaces.map((surface) => ({
    id: surface.id,
    path: allocateArchivePath('surfaces', surface.id, 'stl', usedPaths),
    bytes: surface.data.byteLength,
  }));
  const labelmapEntries = labelmaps.map((labelmap) => ({
    id: labelmap.id,
    path: allocateArchivePath('labelmaps', labelmap.id, 'uint16.raw', usedPaths),
    bytes: labelmap.data.byteLength,
  }));
  const manifest = {
    version: PROJECT_ARCHIVE_VERSION,
    app: 'CBCTer',
    exportedAt: new Date().toISOString(),
    dataSources: [
      ...maskEntries.map((entry) => ({
        ...entry,
        kind: 'embedded' as const,
        role: 'mask' as const,
      })),
      ...labelmapEntries.map((entry) => ({
        ...entry,
        kind: 'embedded' as const,
        role: 'labelmap' as const,
      })),
      ...surfaceEntries.map((entry) => ({
        ...entry,
        kind: 'embedded' as const,
        role: 'surface' as const,
      })),
    ],
    state,
    masks: maskEntries,
    labelmaps: labelmapEntries,
    surfaces: surfaceEntries,
  } satisfies ProjectArchiveManifest;

  const files: Record<string, Uint8Array> = {
    [PROJECT_ARCHIVE_MANIFEST]: textEncoder.encode(
      JSON.stringify(manifest, null, 2),
    ),
  };

  for (let index = 0; index < masks.length; index += 1) {
    files[maskEntries[index].path] = masks[index].data;
  }
  for (let index = 0; index < labelmaps.length; index += 1) {
    files[labelmapEntries[index].path] = labelmaps[index].data;
  }
  for (let index = 0; index < surfaces.length; index += 1) {
    files[surfaceEntries[index].path] = surfaces[index].data;
  }

  return new Blob([zipSync(files)], { type: 'application/zip' });
}

export function projectArchiveName(state: StudyState): string {
  const name = state.study?.name ?? 'cbcter-study';
  return `${sanitizePathSegment(name)}.cbcter.zip`;
}

export async function readProjectArchive(file: File): Promise<ProjectArchive> {
  const { unzipSync } = await import('fflate');
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const manifestBytes = files[PROJECT_ARCHIVE_MANIFEST];
  if (!manifestBytes) {
    throw new Error(`Project package is missing ${PROJECT_ARCHIVE_MANIFEST}.`);
  }

  const manifest = parseProjectManifest(new TextDecoder().decode(manifestBytes));

  return {
    manifest,
    masks: manifest.masks.map((entry) => {
      const data = files[entry.path];
      if (!data) throw new Error(`Project package is missing ${entry.path}.`);
      if (data.byteLength !== entry.bytes) {
        throw new Error(`Project package has an invalid ${entry.path}.`);
      }
      return { id: entry.id, data };
    }),
    labelmaps: manifest.labelmaps.map((entry) => {
      const data = files[entry.path];
      if (!data) throw new Error(`Project package is missing ${entry.path}.`);
      if (data.byteLength !== entry.bytes) {
        throw new Error(`Project package has an invalid ${entry.path}.`);
      }
      return { id: entry.id, data };
    }),
    surfaces: manifest.surfaces.map((entry) => {
      const data = files[entry.path];
      if (!data) throw new Error(`Project package is missing ${entry.path}.`);
      if (data.byteLength !== entry.bytes) {
        throw new Error(`Project package has an invalid ${entry.path}.`);
      }
      return { id: entry.id, data };
    }),
  };
}
