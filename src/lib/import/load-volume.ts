import { i18n } from '../../i18n';
import type { ImportProgress, ScanFolderSource } from '../../types';
import { ImportStage } from '../../types';
import { importFormatAdapters } from './adapters';
import { exposeExtensionlessDicomEntries } from './adapters/dicom';
import { importDataSources, scanFolderDataSource } from './dataSource';
import type {
  ImportFailure,
  ImportParseOptions,
  LoadedImport,
  VolumeWorkerEvent,
} from './types';

export async function loadVolumeFromFolder(
  source: ScanFolderSource,
  onProgress?: (progress: ImportProgress) => void,
  options?: ImportParseOptions,
): Promise<LoadedImport> {
  const { source: importedSource } = await importDataSources(
    scanFolderDataSource(source),
  );
  onProgress?.({
    stage: ImportStage.Scanning,
    detailKey: 'importStatus.progress.scanningSelectedFolder',
    completed: 0,
    total: 1,
  });
  let expandedSource = importedSource;
  let adapter = importFormatAdapters.find((candidate) =>
    candidate.matches(expandedSource),
  );
  if (!adapter) {
    // Fall back to content sniffing for DICOM slices without a file
    // extension (DICOMDIR-style disc exports such as Sidexis).
    const sniffed = await exposeExtensionlessDicomEntries(importedSource);
    if (sniffed !== importedSource) {
      expandedSource = sniffed;
      adapter = importFormatAdapters.find((candidate) =>
        candidate.matches(expandedSource),
      );
    }
  }
  if (!adapter) {
    throw makeError('E_FORMAT', i18n.t('errors.unsupportedFolderLayout'));
  }

  const parsed = await adapter.parse(expandedSource, options);
  if (parsed.loaded) {
    onProgress?.({
      stage: ImportStage.Ready,
      detailKey: 'importStatus.progress.loadedScan',
      detailValues: {
        scanId: parsed.loaded.meta.scanId,
      },
      completed: 1,
      total: 1,
    });
    return parsed.loaded;
  }
  onProgress?.({
    stage: ImportStage.ParsingMeta,
    detailKey: 'importStatus.progress.parsedMetadata',
    detailValues: {
      formatLabel: adapter.label,
    },
    completed: 1,
    total: 3,
  });

  const worker = new Worker(
    new URL('../../workers/volume.worker.ts', import.meta.url),
    { type: 'module' },
  );
  const payload = await adapter.buildWorkerRequest(expandedSource, parsed);

  return await new Promise<LoadedImport>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<VolumeWorkerEvent>) => {
      const data = event.data;
      if (data.type === 'progress') {
        onProgress?.(data.progress);
        return;
      }
      if (data.type === 'result') {
        worker.terminate();
        resolve({
          volume: data.volume,
          meta: data.meta,
          prepared3D: data.prepared3D,
        });
        return;
      }
      worker.terminate();
      reject(makeError(data.error.code, data.error.message));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(makeError('E_WORKER', event.message || 'worker failed'));
    };
    worker.postMessage(
      payload,
      payload.files.map((file) => file.buffer),
    );
  });
}

function makeError(code: string, message: string): ImportFailure {
  const error = new Error(message) as ImportFailure;
  error.name = code;
  error.code = code;
  return error;
}
