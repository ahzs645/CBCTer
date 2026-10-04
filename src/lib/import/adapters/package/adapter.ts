import type { ScanFolderEntry, ScanFolderSource } from '../../../../types';
import { prepareVolumeFor3D } from '../../../volume';
import {
  chooseScanPackageLevel,
  isLightDevice,
  parseScanPackageManifest,
  SCAN_PACKAGE_MANIFEST,
  type ScanPackageManifest,
  scanPackageToLoadedVolume,
} from '../../scanPackage';
import type {
  ImportFormatAdapter,
  ImportParseOptions,
  ParsedImportResult,
} from '../../types';
import { readZipEntry, readZipIndex } from '../../zipIndex';
import { getEntryPath } from '../utils';

function findManifest(source: ScanFolderSource): ScanFolderEntry | undefined {
  return source.entries.find((entry) => entry.name === SCAN_PACKAGE_MANIFEST);
}

function findPackageZip(source: ScanFolderSource): ScanFolderEntry | undefined {
  return source.entries.find((entry) => entry.archiveKind === 'cbct-package');
}

function siblingPath(path: string, name: string): string {
  const parts = path.split('/');
  parts.pop();
  return [...parts, name].filter(Boolean).join('/');
}

/** Read the manifest and one level's bytes, from a zip or an unpacked folder. */
async function readPackage(
  source: ScanFolderSource,
  options?: ImportParseOptions,
): Promise<{
  manifest: ScanPackageManifest;
  headerFileName: string;
  level: ReturnType<typeof chooseScanPackageLevel>;
  bytes: ArrayBuffer;
}> {
  const preference = options?.packageLevel ?? 'auto';
  const zipEntry = findPackageZip(source);
  if (zipEntry) {
    const index = await readZipIndex(zipEntry.file);
    const byName = new Map(index.map((item) => [item.name, item]));
    const manifestItem = byName.get(SCAN_PACKAGE_MANIFEST);
    if (!manifestItem) throw new Error('No CBCTer scan package manifest found.');
    const manifest = parseScanPackageManifest(
      new TextDecoder().decode(await readZipEntry(zipEntry.file, manifestItem)),
    );
    const level = chooseScanPackageLevel(manifest, preference, isLightDevice());
    const volumeItem = byName.get(level.file);
    if (!volumeItem) throw new Error(`The scan package is missing ${level.file}.`);
    // Only this level's bytes are read from the zip.
    const data = await readZipEntry(zipEntry.file, volumeItem);
    return {
      manifest,
      level,
      headerFileName: getEntryPath(zipEntry),
      bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    };
  }

  const manifestEntry = findManifest(source);
  if (!manifestEntry) throw new Error('No CBCTer scan package manifest found.');
  const manifest = parseScanPackageManifest(await manifestEntry.file.text());
  const manifestPath = getEntryPath(manifestEntry);
  const level = chooseScanPackageLevel(manifest, preference, isLightDevice());
  const volumePath = siblingPath(manifestPath, level.file);
  const volumeEntry = source.entries.find((entry) => getEntryPath(entry) === volumePath);
  if (!volumeEntry) throw new Error(`The scan package is missing ${level.file}.`);
  return {
    manifest,
    level,
    headerFileName: manifestPath,
    bytes: await volumeEntry.file.arrayBuffer(),
  };
}

async function parseScanPackage(
  source: ScanFolderSource,
  options?: ImportParseOptions,
): Promise<ParsedImportResult> {
  const { manifest, level, headerFileName, bytes } = await readPackage(source, options);
  const volume = scanPackageToLoadedVolume(manifest, bytes, headerFileName, level);
  return {
    meta: volume.meta,
    loaded: { volume, meta: volume.meta, prepared3D: prepareVolumeFor3D(volume) },
  };
}

/** Slim `*.cbct.zip` packages (zipped or unpacked) written by CBCTer. */
export const scanPackageFormatAdapter: ImportFormatAdapter = {
  id: 'cbct-package',
  label: 'CBCTer scan package',
  matches(source) {
    return Boolean(findPackageZip(source) ?? findManifest(source));
  },
  parse: parseScanPackage,
  buildWorkerRequest() {
    // Packages are decoded on the main thread in parse(); no worker step.
    return Promise.reject(new Error('Scan packages do not use the volume worker.'));
  },
};
