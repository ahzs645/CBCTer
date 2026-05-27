import type { ScanFolderEntry } from '../../types';

const DICOM_PREAMBLE_OFFSET = 128;
const DICOM_MAGIC = 'DICM';
const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;
const ZIP_MAGIC_0 = 0x50;
const ZIP_MAGIC_1 = 0x4b;

const EXTENSION_MIME_TYPES: Record<string, string> = {
  '.cbcter.zip': 'application/vnd.cbcter.project+zip',
  '.dcm': 'application/dicom',
  '.dicom': 'application/dicom',
  '.gz': 'application/gzip',
  '.mha': 'application/vnd.metaimage',
  '.mhd': 'application/vnd.metaimage',
  '.nhdr': 'application/vnd.nrrd',
  '.nii': 'application/vnd.nifti',
  '.nii.gz': 'application/vnd.nifti',
  '.nrrd': 'application/vnd.nrrd',
  '.stl': 'model/stl',
  '.vti': 'model/vnd.vtk.image',
  '.zip': 'application/zip',
};

export function normalizeArchivePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

export function getExtension(path: string): string {
  const normalized = normalizeArchivePath(path).toLowerCase();
  if (normalized.endsWith('.nii.gz')) return '.nii.gz';
  if (normalized.endsWith('.cbcter.zip')) return '.cbcter.zip';
  const index = normalized.lastIndexOf('.');
  return index === -1 ? '' : normalized.slice(index);
}

export function inferMimeType(path: string, fallback = ''): string {
  return EXTENSION_MIME_TYPES[getExtension(path)] ?? fallback;
}

export function sanitizeFileStem(
  value: string,
  fallback = 'unnamed',
): string {
  const stem = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .split('')
    .filter((char) => char.charCodeAt(0) >= 32)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return stem || fallback;
}

export function sanitizePathSegment(value: string, fallback = 'unnamed'): string {
  return sanitizeFileStem(value, fallback).replace(/[^a-z0-9_-]+/gi, '_');
}

export async function hasDicomMagic(entry: ScanFolderEntry): Promise<boolean> {
  const bytes = new Uint8Array(
    await entry.file
      .slice(0, DICOM_PREAMBLE_OFFSET + DICOM_MAGIC.length)
      .arrayBuffer(),
  );
  if (bytes.byteLength < DICOM_PREAMBLE_OFFSET + DICOM_MAGIC.length) {
    return false;
  }
  return (
    String.fromCharCode(
      ...bytes.slice(DICOM_PREAMBLE_OFFSET, DICOM_PREAMBLE_OFFSET + 4),
    ) === DICOM_MAGIC
  );
}

export async function isZipFile(entry: ScanFolderEntry): Promise<boolean> {
  if (getExtension(entry.relativePath || entry.name) === '.zip') return true;
  if (getExtension(entry.relativePath || entry.name) === '.cbcter.zip') {
    return true;
  }
  const bytes = new Uint8Array(await entry.file.slice(0, 2).arrayBuffer());
  return bytes[0] === ZIP_MAGIC_0 && bytes[1] === ZIP_MAGIC_1;
}

export async function isGzipFile(entry: ScanFolderEntry): Promise<boolean> {
  if (getExtension(entry.relativePath || entry.name) === '.gz') return true;
  const bytes = new Uint8Array(await entry.file.slice(0, 2).arrayBuffer());
  return bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1;
}
