import type { CaseMetadata, CaseWorkspace } from '../../case/types';
import type { LoadedVolume, ParsedVolumeMeta, Vec3 } from '../../../types';
import { buildScalarHistogram } from '../../../workers/volume/scalars';
import { displayVoxels } from '../../volume/native';
import type { ChunkedManifest } from './manifest';
import type { ChunkReadStats, PackageSourceDescriptor } from './reader';
interface Reply {
  id: number;
  error?: string;
  pong?: boolean;
  voxels: Int16Array | Uint16Array;
  manifest?: ChunkedManifest;
  stats: ChunkReadStats;
  caseMetadata?: CaseMetadata;
  caseWorkspace?: CaseWorkspace;
}
interface PendingRequest {
  /** The exact message posted, so it can be re-sent to a restarted worker. */
  message: Record<string, unknown>;
  /** Already re-sent once after a crash. */
  retried: boolean;
  /** Session-internal re-initialisation of a restarted worker. */
  internal?: boolean;
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}
export type ChunkedWorkerFactory = () => Worker;
export interface ChunkedSessionOptions {
  /** How often a busy session pings its worker (ms). */
  heartbeatMs?: number;
  /** A ping unanswered this long means the worker died silently (ms). */
  heartbeatTimeoutMs?: number;
  now?: () => number;
}
export const DECODER_STOPPED_MESSAGE =
  'The scan decoder stopped working. Reload the page to continue.';
export const DECODER_CRASHED_MESSAGE =
  'The scan decoder crashed twice while reading this part of the scan.';
/** Crashes within CRASH_WINDOW_MS that make the session give up. */
const MAX_CRASHES = 3;
const CRASH_WINDOW_MS = 60_000;
const createChunkedWorker: ChunkedWorkerFactory = () =>
  new Worker(
    new URL('../../../workers/chunkedVolume.worker.ts', import.meta.url),
    { type: 'module' },
  );
let sessionCount = 0;
export class ChunkedSession {
  readonly id = ++sessionCount;
  private worker: Worker;
  private requests = new Map<number, PendingRequest>();
  private nextId = 0;
  private disposed = false;
  /** Init message of a successfully opened session, replayed after a crash. */
  private initMessage?: Record<string, unknown>;
  private crashes: number[] = [];
  private heartbeat?: ReturnType<typeof setInterval>;
  private awaitingPong = false;
  private pingSentAt = 0;
  private readonly createWorker: ChunkedWorkerFactory;
  private readonly heartbeatMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly now: () => number;
  manifest!: ChunkedManifest;
  stats!: ChunkReadStats;
  caseMetadata?: CaseMetadata;
  preferredInstanceId?: string;
  constructor(
    readonly source: PackageSourceDescriptor,
    createWorker: ChunkedWorkerFactory = createChunkedWorker,
    options: ChunkedSessionOptions = {},
  ) {
    this.createWorker = createWorker;
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.worker = this.spawn();
  }
  private spawn(): Worker {
    const worker = this.createWorker();
    worker.onmessage = (event: MessageEvent<Reply>) =>
      this.receive(worker, event.data);
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault?.();
      this.crashed(worker);
    };
    worker.onmessageerror = () => this.crashed(worker);
    return worker;
  }
  private receive(worker: Worker, r: Reply) {
    if (worker !== this.worker) return;
    this.awaitingPong = false;
    if (r.pong) return;
    const pending = this.requests.get(r.id);
    if (!pending) return;
    this.requests.delete(r.id);
    pending.cleanup();
    if (r.error) pending.reject(new Error(r.error));
    else {
      this.stats = r.stats;
      pending.resolve(r);
    }
  }
  /**
   * The worker died (error event, unreadable message, or no heartbeat): start
   * a fresh one, replay the init it needs, and re-send each in-flight request
   * once. Repeated crashes close the session for good.
   */
  private crashed(worker: Worker) {
    if (this.disposed || worker !== this.worker) return;
    worker.terminate();
    const now = this.now();
    this.crashes = this.crashes.filter((t) => now - t < CRASH_WINDOW_MS);
    this.crashes.push(now);
    if (this.crashes.length >= MAX_CRASHES) {
      this.dispose(new Error(DECODER_STOPPED_MESSAGE));
      return;
    }
    this.awaitingPong = false;
    this.worker = this.spawn();
    const pending = [...this.requests.entries()];
    if (this.initMessage) {
      const id = ++this.nextId;
      const message = { ...this.initMessage, id };
      this.requests.set(id, {
        message,
        retried: true,
        internal: true,
        resolve: () => undefined,
        reject: (error) =>
          this.dispose(
            new Error(`The scan decoder could not restart: ${error.message}`),
          ),
        cleanup: () => undefined,
      });
      this.worker.postMessage(message);
    }
    for (const [id, r] of pending) {
      if (r.internal) {
        this.requests.delete(id);
      } else if (r.retried) {
        this.requests.delete(id);
        r.cleanup();
        r.reject(new Error(DECODER_CRASHED_MESSAGE));
      } else {
        r.retried = true;
        this.worker.postMessage(r.message);
      }
    }
  }
  /** Ping a busy worker; one that stops answering is treated as crashed. */
  private ensureHeartbeat() {
    if (this.heartbeat !== undefined) return;
    this.heartbeat = setInterval(() => {
      if (this.disposed || !this.requests.size) {
        this.stopHeartbeat();
        return;
      }
      const now = this.now();
      if (this.awaitingPong) {
        if (now - this.pingSentAt >= this.heartbeatTimeoutMs)
          this.crashed(this.worker);
        return;
      }
      this.awaitingPong = true;
      this.pingSentAt = now;
      this.worker.postMessage({ id: 0, type: 'ping' });
    }, this.heartbeatMs);
  }
  private stopHeartbeat() {
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.awaitingPong = false;
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
    const message = { id, type, ...args };
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.requests.delete(id);
        this.worker.postMessage({ id, type: 'cancel' });
        signal?.removeEventListener('abort', abort);
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      this.requests.set(id, {
        message,
        retried: false,
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener('abort', abort),
      });
      signal?.addEventListener('abort', abort, { once: true });
      this.worker.postMessage(message);
      this.ensureHeartbeat();
    });
  }
  async initialize(cacheBytes = 64 * 1024 * 1024): Promise<LoadedVolume> {
    try {
      const init = { source: this.source, cacheBytes };
      const reply = await this.request('init', init);
      this.initMessage = { type: 'init', ...init };
      this.manifest = reply.manifest!;
      this.caseMetadata = reply.caseMetadata;
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
  setPreferredInstance(id: string) {
    this.preferredInstanceId = id;
  }
  analysisRegion(
    layerId: string,
    start: Vec3,
    shape: Vec3,
    signal?: AbortSignal,
  ) {
    return this.request('region', { layerId, start, shape }, signal).then(
      (r) => r.voxels as Uint16Array,
    );
  }
  async fullVolume(): Promise<LoadedVolume> {
    const reply = await this.request('materialize');
    if (reply.caseWorkspace && this.preferredInstanceId)
      reply.caseWorkspace.state.selectedInstanceId = this.preferredInstanceId;
    const native = { voxels: reply.voxels, metadata: this.manifest.volume };
    return {
      ...this.loaded(displayVoxels(reply.voxels, this.manifest.volume), false),
      native,
      caseWorkspace: reply.caseWorkspace,
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
      packageLevels: (preview ? [
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
      ] : [{id:'full' as const,dimensions:m.volume.dimensions,spacing:m.volume.spacing}]),
    };
    return {
      meta,
      voxels,
      histogram: buildScalarHistogram(voxels, m.scalarRange),
      caseMetadata: this.caseMetadata,
      ...(preview ? { chunked: this } : {}),
    };
  }
  dispose(error: Error = new Error('Volume session is closed.')) {
    if (this.disposed) return;
    this.disposed = true;
    this.stopHeartbeat();
    this.worker.terminate();
    for (const r of this.requests.values()) {
      r.cleanup();
      r.reject(error);
    }
    this.requests.clear();
  }
}
