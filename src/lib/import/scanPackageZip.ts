import { zip, type AsyncZippable } from 'fflate';
import type { LoadedVolume } from '../../types';
import {
  buildScanPackageFiles,
  SCAN_PACKAGE_PREVIEW,
  type ScanPackageManifest,
  type ScanPackageOptions,
} from './scanPackage';

/**
 * Zip a scan package off the main thread (fflate's async zip runs in Web
 * Workers). The voxel buffer is copied to the worker, never transferred, so
 * the volume open in the viewer stays intact.
 */
export function packScanPackage(
  volume: Pick<LoadedVolume, 'voxels' | 'meta' | 'native'>,
  options: ScanPackageOptions,
): Promise<{
  blob: Blob;
  manifest: ScanPackageManifest | import('./chunked/manifest').ChunkedManifest;
}> {
  if (options.storage === 'streamable') {
    const worker = new Worker(
      new URL('../../workers/packageExport.worker.ts', import.meta.url),
      { type: 'module' },
    );
    return new Promise((resolve, reject) => {
      worker.onmessage = (event) => {
        worker.terminate();
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data);
      };
      worker.onerror = (event) => {
        worker.terminate();
        reject(new Error(event.message || 'Package export worker failed.'));
      };
      worker.postMessage({
        volume: {
          // The native writer derives its preview from raw words; avoid cloning
          // the additional dense display volume into the export worker.
          voxels: volume.native ? new Int16Array() : volume.voxels,
          meta: volume.meta,
          native: volume.native,
        },
        options,
      });
    });
  }
  const { files, manifest } = buildScanPackageFiles(volume, options);
  const zippable: AsyncZippable = {};
  for (const [name, data] of Object.entries(files)) {
    // PNG is already compressed; store it instead of deflating twice.
    zippable[name] = [data, { level: name === SCAN_PACKAGE_PREVIEW ? 0 : 6 }];
  }
  return new Promise((resolve, reject) => {
    zip(zippable, { level: 6 }, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({
        blob: new Blob([data as Uint8Array<ArrayBuffer>], {
          type: 'application/zip',
        }),
        manifest,
      });
    });
  });
}
