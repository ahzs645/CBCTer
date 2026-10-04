import type { LoadedVolume, ParsedVolumeMeta, Vec3 } from '../../../types';
import { buildScalarHistogram } from '../../../workers/volume/scalars';
import { displayVoxels } from '../../volume/native';
import type { ChunkedManifest } from './manifest';
import type { ChunkReadStats, PackageSourceDescriptor } from './reader';
interface Reply {
  id: number;
  error?: string;
  voxels: Int16Array | Uint16Array;
  manifest?: ChunkedManifest;
  stats: ChunkReadStats;
}
let sessionCount = 0;
export class ChunkedSession {
  readonly id = ++sessionCount;
  private worker = new Worker(
    new URL('../../../workers/chunkedVolume.worker.ts', import.meta.url),
    { type: 'module' },
  );
  private requests = new Map<
    number,
    {
      resolve: (reply: Reply) => void;
      reject: (error: Error) => void;
      cleanup: () => void;
    }
  >();
  private nextId = 0;
  private disposed = false;
  manifest!: ChunkedManifest;
  stats!: ChunkReadStats;
  constructor(readonly source: PackageSourceDescriptor) {
    this.worker.onmessage = (event: MessageEvent<Reply>) => {
      const r = event.data;
      const pending = this.requests.get(r.id);
      if (!pending) return;
      this.requests.delete(r.id);
      pending.cleanup();
      if (r.error) pending.reject(new Error(r.error));
      else {
        this.stats = r.stats;
        pending.resolve(r);
      }
    };
    this.worker.onerror = () =>
      this.dispose(new Error('Volume decoding worker failed.'));
  }
  private request(
    type: string,
    args: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<Reply> {
    if (this.disposed)
      return Promise.reject(new Error('Volume session is closed.'));
    if (signal?.aborted)
      return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.requests.delete(id);
        this.worker.postMessage({ id, type: 'cancel' });
        signal?.removeEventListener('abort', abort);
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      this.requests.set(id, {
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener('abort', abort),
      });
      signal?.addEventListener('abort', abort, { once: true });
      this.worker.postMessage({ id, type, ...args });
    });
  }
  async initialize(cacheBytes = 64 * 1024 * 1024): Promise<LoadedVolume> {
    try {
      const reply = await this.request('init', {
        source: this.source,
        cacheBytes,
      });
      this.manifest = reply.manifest!;
      return this.loaded(reply.voxels as Int16Array, true);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  region(start: Vec3, shape: Vec3, signal?: AbortSignal) {
    return this.request('region', { start, shape }, signal).then(
      (r) => r.voxels,
    );
  }
  async fullVolume(): Promise<LoadedVolume> {
    const reply = await this.request('materialize');
    const native = { voxels: reply.voxels, metadata: this.manifest.volume };
    return {
      ...this.loaded(displayVoxels(reply.voxels, this.manifest.volume), false),
      native,
    };
  }
  private loaded(voxels: Int16Array, preview: boolean): LoadedVolume {
    const m = this.manifest;
    const grid = preview ? m.preview : m.volume;
    const meta: ParsedVolumeMeta = {
      format: 'cbct-package',
      formatLabel: `CBCTer package · ${m.source.formatLabel}`,
      scanId: m.name,
      dimensions: grid.dimensions,
      spacing: grid.spacing,
      scalarRange: m.scalarRange,
      initialWindowLevel: m.display,
      sliceCount: grid.dimensions[2],
      bytesPerVoxel: 2,
      headerFileName: 'cbct-scan.json',
      slicePrefix: '',
      sliceFiles: [],
      nativeAxis: m.orientation.nativeAxis,
      patientAxes: m.orientation.patientAxes,
      packageLevel: preview ? 'half' : 'full',
      packageLevels: [
        {
          id: 'full',
          dimensions: m.volume.dimensions,
          spacing: m.volume.spacing,
        },
        {
          id: 'half',
          dimensions: m.preview.dimensions,
          spacing: m.preview.spacing,
        },
      ],
    };
    return {
      meta,
      voxels,
      histogram: buildScalarHistogram(voxels, m.scalarRange),
      ...(preview ? { chunked: this } : {}),
    };
  }
  dispose(error: Error = new Error('Volume session is closed.')) {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    for (const r of this.requests.values()) {
      r.cleanup();
      r.reject(error);
    }
    this.requests.clear();
  }
}
