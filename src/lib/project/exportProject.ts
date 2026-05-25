import type { StudyState } from '../../domain/types';

export interface ProjectMaskExport {
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
  surfaces: ProjectSurfaceExport[];
}

export interface ProjectArchiveManifestEntry {
  id: string;
  path: string;
  bytes: number;
}

export interface ProjectArchiveManifest {
  version: 1;
  exportedAt: string;
  state: StudyState;
  masks: ProjectArchiveManifestEntry[];
  surfaces: ProjectArchiveManifestEntry[];
}

export interface ProjectArchive {
  manifest: ProjectArchiveManifest;
  masks: ProjectMaskExport[];
  surfaces: ProjectSurfaceExport[];
}

const textEncoder = new TextEncoder();

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '_') || 'unnamed';
}

export async function buildProjectArchive({
  state,
  masks,
  surfaces,
}: ProjectExportInput): Promise<Blob> {
  const { zipSync } = await import('fflate');
  const manifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    state,
    masks: masks.map((mask) => ({
      id: mask.id,
      path: `masks/${sanitizePathSegment(mask.id)}.bin`,
      bytes: mask.data.byteLength,
    })),
    surfaces: surfaces.map((surface) => ({
      id: surface.id,
      path: `surfaces/${sanitizePathSegment(surface.id)}.stl`,
      bytes: surface.data.byteLength,
    })),
  };

  const files: Record<string, Uint8Array> = {
    'study.json': textEncoder.encode(JSON.stringify(manifest, null, 2)),
  };

  for (const mask of masks) {
    files[`masks/${sanitizePathSegment(mask.id)}.bin`] = mask.data;
  }
  for (const surface of surfaces) {
    files[`surfaces/${sanitizePathSegment(surface.id)}.stl`] = surface.data;
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
  const manifestBytes = files['study.json'];
  if (!manifestBytes) {
    throw new Error('Project package is missing study.json.');
  }

  const manifest = JSON.parse(
    new TextDecoder().decode(manifestBytes),
  ) as ProjectArchiveManifest;
  if (manifest.version !== 1 || !manifest.state) {
    throw new Error('Unsupported project package version.');
  }

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
