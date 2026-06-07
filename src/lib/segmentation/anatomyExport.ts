import { zipSync } from 'fflate';
import type { Vec3 } from '../../types';
import type { SurfaceGenerationQuality } from '../surface';
import { generateSurfaceInWorker } from '../surface';
import { sanitizePathSegment } from '../import/fileTypes';
import type { DentalClassStat } from './dentalSegmentGroup';
import { meshToGlb, meshToObj, parseBinaryStl } from './meshExport';
import { writeNiftiUint16Labelmap } from './nifti';

export interface AnatomyExportProgress {
  label: string;
  phase: 'labelmap' | 'preprocess' | 'mesh' | 'metrics' | 'package';
  completed: number;
  total: number;
}

export interface AnatomySurfaceExportOptions {
  labelmap: Uint16Array;
  stats: DentalClassStat[];
  dims: [number, number, number];
  spacing: Vec3;
  quality: SurfaceGenerationQuality;
  onProgress?: (progress: AnatomyExportProgress) => void;
  signal?: AbortSignal;
}

const textEncoder = new TextEncoder();

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('Anatomy export canceled.', 'AbortError');
  }
}

export function labelmapToSegmentMask(
  labelmap: Uint16Array,
  value: number,
): Uint8Array {
  const mask = new Uint8Array(labelmap.length);
  for (let index = 0; index < labelmap.length; index += 1) {
    if (labelmap[index] === value) mask[index] = 1;
  }
  return mask;
}

function uint16ArrayToBytes(values: Uint16Array): Uint8Array {
  return new Uint8Array(
    values.buffer.slice(
      values.byteOffset,
      values.byteOffset + values.byteLength,
    ),
  );
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

export async function buildAnatomySurfaceArchive({
  labelmap,
  stats,
  dims,
  spacing,
  quality,
  onProgress,
  signal,
}: AnatomySurfaceExportOptions): Promise<Blob> {
  assertNotAborted(signal);
  const present = stats.filter((stat) => stat.voxelCount > 0);
  const files: Record<string, Uint8Array> = {
    'labelmaps/full-anatomy.uint16.raw': uint16ArrayToBytes(labelmap),
    'labelmaps/full-anatomy.nii': writeNiftiUint16Labelmap({
      labelmap,
      dims,
      spacing,
    }),
  };
  const manifest = {
    app: 'CBCTer',
    kind: 'DentalSegmentator anatomy export',
    exportedAt: new Date().toISOString(),
    dims,
    spacing,
    quality,
    labelmap: 'labelmaps/full-anatomy.uint16.raw',
    nifti: 'labelmaps/full-anatomy.nii',
    surfaces: [] as Array<{
      value: number;
      name: string;
      color: string;
      voxelCount: number;
      volumeMm3: number;
      stlPath: string;
      objPath: string;
      glbPath: string;
      areaMm2: number;
      meshVolumeMm3: number;
      triangleCount: number;
    }>,
  };

  for (let index = 0; index < present.length; index += 1) {
    const stat = present[index];
    const completed = index;
    const total = present.length;
    onProgress?.({
      label: stat.name,
      phase: 'labelmap',
      completed,
      total,
    });
    assertNotAborted(signal);
    const generated = await generateSurfaceInWorker({
      mask: labelmapToSegmentMask(labelmap, stat.value),
      dims,
      spacing,
      quality,
      signal,
      onProgress: (phase) =>
        onProgress?.({
          label: stat.name,
          phase,
          completed,
          total,
        }),
    });
    const stem = `surfaces/${String(stat.value).padStart(2, '0')}-${sanitizePathSegment(
      stat.name,
    )}`;
    const stlPath = `${stem}.stl`;
    const objPath = `${stem}.obj`;
    const glbPath = `${stem}.glb`;
    const stlBytes = await blobToBytes(generated.blob);
    const mesh = parseBinaryStl(stlBytes);
    files[stlPath] = stlBytes;
    files[objPath] = meshToObj(mesh, stat.name);
    files[glbPath] = meshToGlb(mesh, stat.name);
    manifest.surfaces.push({
      value: stat.value,
      name: stat.name,
      color: stat.color,
      voxelCount: stat.voxelCount,
      volumeMm3: stat.volumeMm3,
      stlPath,
      objPath,
      glbPath,
      areaMm2: generated.areaMm2,
      meshVolumeMm3: generated.volumeMm3,
      triangleCount: generated.triangleCount,
    });
  }

  onProgress?.({
    label: 'Package',
    phase: 'package',
    completed: present.length,
    total: present.length,
  });
  files['manifest.json'] = textEncoder.encode(JSON.stringify(manifest, null, 2));
  assertNotAborted(signal);
  return new Blob([zipSync(files)], { type: 'application/zip' });
}
