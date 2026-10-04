import {
  openChunkedReader,
  type ChunkedReader,
  type PackageSourceDescriptor,
} from '../lib/import/chunked/reader';
import type { Vec3 } from '../types';
let reader: ChunkedReader;
const cancelled = new Set<number>();
let queue = Promise.resolve();
interface Request {
  id: number;
  type: 'init' | 'region' | 'materialize' | 'cancel';
  source?: PackageSourceDescriptor;
  cacheBytes?: number;
  start?: Vec3;
  shape?: Vec3;
}
self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    cancelled.add(request.id);
    return;
  }
  queue = queue.then(async () => {
    try {
      if (cancelled.has(request.id)) return;
      let voxels: Int16Array | Uint16Array;
      if (request.type === 'init') {
        reader = await openChunkedReader(request.source!, request.cacheBytes);
        voxels = await reader.preview();
      } else if (request.type === 'region')
        voxels = await reader.region(request.start!, request.shape!, () =>
          cancelled.has(request.id),
        );
      else voxels = await reader.materialize(() => cancelled.has(request.id));
      if (!cancelled.has(request.id))
        postMessage(
          {
            id: request.id,
            voxels,
            manifest: request.type === 'init' ? reader.manifest : undefined,
            stats: reader.stats(),
          },
          [voxels.buffer],
        );
    } catch (error) {
      postMessage({
        id: request.id,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      cancelled.delete(request.id);
    }
  });
};
