import { buildChunkedPackage } from '../lib/import/chunked/package';
import type { LoadedVolume } from '../types';
import type { ScanPackageOptions } from '../lib/import/scanPackage';
self.onmessage = (
  event: MessageEvent<{
    volume: Pick<LoadedVolume, 'voxels' | 'meta' | 'native'>;
    options: ScanPackageOptions;
  }>,
) => {
  void buildChunkedPackage(event.data.volume, event.data.options).then(
    (result) => postMessage(result),
    (error) =>
      postMessage({
        error: error instanceof Error ? error.message : String(error),
      }),
  );
};
