import { httpSource } from '../../byteSource';
import { ChunkedSession } from '../../chunked/session';
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
): Promise<
  | {
      manifest: ScanPackageManifest;
      headerFileName: string;
      level: ReturnType<typeof chooseScanPackageLevel>;
      bytes: ArrayBuffer;
    }
  | { loadedVolume: import('../../../../types').LoadedVolume }
> {
  const preference = options?.packageLevel ?? 'auto';
  const zipEntry = findPackageZip(source);
  if (zipEntry) {
    const zipSource = zipEntry.remoteUrl
      ? await httpSource(zipEntry.remoteUrl)
      : zipEntry.file;
    const index = await readZipIndex(zipSource);
    const byName = new Map(index.map((item) => [item.name, item]));
    const manifestItem = byName.get(SCAN_PACKAGE_MANIFEST);
    if (!manifestItem || manifestItem.size > 2 * 1024 * 1024)
      throw new Error('No valid CBCTer scan package manifest found.');
    const manifestText = new TextDecoder().decode(
      await readZipEntry(zipSource, manifestItem),
    );
    if (JSON.parse(manifestText).version === 2) {
      const session = new ChunkedSession(
        zipEntry.remoteUrl
          ? { url: zipEntry.remoteUrl }
          : { blob: zipEntry.file },
      );
      const preview = await session.initialize(
        isLightDevice() ? 32 * 1024 * 1024 : 64 * 1024 * 1024,
      );
      if (preference === 'full') {
        try {
          const full = await session.fullVolume();
          return { loadedVolume: full };
        } finally {
          session.dispose();
        }
      }
      return { loadedVolume: preview };
    }
    const manifest = parseScanPackageManifest(manifestText);
    const level = chooseScanPackageLevel(manifest, preference, isLightDevice());
    const volumeItem = byName.get(level.file);
    if (!volumeItem)
      throw new Error(`The scan package is missing ${level.file}.`);
    // Only this level's bytes are read from the zip.
    const data = await readZipEntry(zipSource, volumeItem);
    return {
      manifest,
      level,
      headerFileName: getEntryPath(zipEntry),
      bytes: data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ) as ArrayBuffer,
    };
  }

  const manifestEntry = findManifest(source);
  if (!manifestEntry) throw new Error('No CBCTer scan package manifest found.');
  const manifestText = await manifestEntry.file.text();
  if (JSON.parse(manifestText).version === 2) {
    const root = getEntryPath(manifestEntry).split('/').slice(0, -1).join('/');
    const files = Object.fromEntries(
      source.entries.map((e) => [
        getEntryPath(e).slice(root ? root.length + 1 : 0),
        e.file,
      ]),
    );
    const session = new ChunkedSession({ files });
    const preview = await session.initialize(
      isLightDevice() ? 32 * 1024 * 1024 : 64 * 1024 * 1024,
    );
    if (preference === 'full') {
      try {
        return { loadedVolume: await session.fullVolume() };
      } finally {
        session.dispose();
      }
    }
    return { loadedVolume: preview };
  }
  const manifest = parseScanPackageManifest(manifestText);
  const manifestPath = getEntryPath(manifestEntry);
  const level = chooseScanPackageLevel(manifest, preference, isLightDevice());
  const volumePath = siblingPath(manifestPath, level.file);
  const volumeEntry = source.entries.find(
    (entry) => getEntryPath(entry) === volumePath,
  );
  if (!volumeEntry)
    throw new Error(`The scan package is missing ${level.file}.`);
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
  const packageData = await readPackage(source, options);
  const volume =
    'loadedVolume' in packageData
      ? packageData.loadedVolume
      : scanPackageToLoadedVolume(
          packageData.manifest,
          packageData.bytes,
          packageData.headerFileName,
          packageData.level,
        );
  return {
    meta: volume.meta,
    loaded: {
      volume,
      meta: volume.meta,
      prepared3D: prepareVolumeFor3D(volume),
    },
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
    // The adapter manages legacy decoding or its own chunk worker;
    // packages do not go through the vendor volume assembly worker.
    return Promise.reject(
      new Error('Scan packages do not use the volume worker.'),
    );
  },
};
