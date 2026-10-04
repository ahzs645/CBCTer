import {
  readCaseMetadata,
  readCaseWorkspace,
  layerReader,
} from '../lib/case/archive';
import type { CaseMetadata, CaseWorkspace } from '../lib/case/types';
import {
  openChunkedReader,
  type ChunkedReader,
  type PackageSourceDescriptor,
} from '../lib/import/chunked/reader';
import type { Vec3 } from '../types';
let reader: ChunkedReader;
let caseMetadata: CaseMetadata | undefined;
const cancelled = new Set<number>();
let queue = Promise.resolve();
interface Request {
  id: number;
  type: 'init' | 'region' | 'materialize' | 'cancel';
  source?: PackageSourceDescriptor;
  cacheBytes?: number;
  start?: Vec3;
  shape?: Vec3;
  layerId?: string;
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
      let caseWorkspace: CaseWorkspace | undefined;
      let voxels: Int16Array | Uint16Array;
      if (request.type === 'init') {
        reader = await openChunkedReader(request.source!, request.cacheBytes);
        voxels = await reader.preview();
        caseMetadata = await readCaseMetadata(reader);
      } else if (request.type === 'region') {
        const layer = caseMetadata?.manifest.layers.find(
          (l) => l.id === request.layerId,
        );
        if (request.layerId && !layer)
          throw new Error('Unknown analysis layer.');
        voxels = await (layer ? layerReader(reader, layer) : reader).region(
          request.start!,
          request.shape!,
          () => cancelled.has(request.id),
        );
      } else {
        const count = reader.manifest.volume.dimensions.reduce(
            (a, b) => a * b,
            1,
          ),
          analysisBytes = (caseMetadata?.manifest.layers ?? []).reduce(
            (sum, l) => sum + count * (l.role === 'mask' ? 1 : 2),
            0,
          ),
          meshBytes = (caseMetadata?.manifest.surfaces ?? []).reduce(
            (sum, s) => sum + s.bytes,
            0,
          );
        const budget =
          reader.cacheLimitBytes <= 32 * 1024 * 1024
            ? 512 * 1024 * 1024
            : 2 * 1024 * 1024 * 1024;
        if (
          count * 5.25 + analysisBytes + meshBytes + reader.cacheLimitBytes >
          budget
        )
          throw new Error(
            'This full case exceeds the editing memory budget on this device. Review the streamed slices here and use a desktop with more memory for full case editing.',
          );
        voxels = await reader.materialize(() => cancelled.has(request.id));
        if (caseMetadata)
          caseWorkspace = await readCaseWorkspace(reader, caseMetadata);
      }
      if (!cancelled.has(request.id))
        postMessage(
          {
            id: request.id,
            voxels,
            manifest: request.type === 'init' ? reader.manifest : undefined,
            stats: reader.stats(),
            caseMetadata: request.type === 'init' ? caseMetadata : undefined,
            caseWorkspace,
          },
          [
            ...new Set([
              voxels.buffer,
              ...(caseWorkspace
                ? [
                    ...caseWorkspace.masks,
                    ...(caseWorkspace.labelmaps ?? []),
                    ...(caseWorkspace.predictions ?? []),
                    ...caseWorkspace.surfaces,
                  ].map((layer) => layer.data.buffer)
                : []),
            ]),
          ],
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
