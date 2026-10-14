import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChunkedManifest } from './manifest';
import {
  ChunkedSession,
  DECODER_CRASHED_MESSAGE,
  DECODER_STOPPED_MESSAGE,
} from './session';

interface Message {
  id: number;
  type: string;
  [key: string]: unknown;
}

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  posted: Message[] = [];
  terminated = false;
  postMessage(message: Message) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: Record<string, unknown>) {
    this.onmessage?.({ data } as MessageEvent);
  }
  crash() {
    this.onerror?.({ preventDefault() {} } as ErrorEvent);
  }
  last(type: string) {
    return [...this.posted].reverse().find((m) => m.type === type)!;
  }
}

const manifest = {
  name: 'scan',
  source: { formatLabel: 'Test' },
  volume: { dimensions: [2, 2, 2], spacing: [1, 1, 1] },
  preview: { dimensions: [1, 1, 1], spacing: [2, 2, 2] },
  scalarRange: [0, 100],
  display: { window: 100, level: 50 },
  orientation: { nativeAxis: 'axial' },
} as unknown as ChunkedManifest;
const stats = {
  bytesRead: 0,
  decodedChunks: 0,
  cacheBytes: 0,
  cacheLimitBytes: 0,
  cacheHits: 0,
};

function setup(options = {}) {
  const workers: FakeWorker[] = [];
  const session = new ChunkedSession(
    { url: 'https://example.com/a.cbct.zip' },
    () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    },
    { heartbeatMs: 1000, heartbeatTimeoutMs: 3000, ...options },
  );
  return { session, workers, current: () => workers[workers.length - 1] };
}

async function open() {
  const ctx = setup();
  const loading = ctx.session.initialize(1024);
  const init = ctx.current().last('init');
  ctx.current().reply({
    id: init.id,
    voxels: new Int16Array(1),
    manifest,
    stats,
  });
  await loading;
  return ctx;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ChunkedSession worker recovery', () => {
  it('restarts a crashed worker, replays init and retries the request', async () => {
    const { session, workers, current } = await open();
    const region = session.region([0, 0, 0], [1, 1, 1]);
    const sent = current().last('region');
    current().crash();
    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);
    const fresh = current();
    expect(fresh.posted.map((m) => m.type)).toEqual(['init', 'region']);
    expect(fresh.posted[0]).toMatchObject({
      source: { url: 'https://example.com/a.cbct.zip' },
      cacheBytes: 1024,
    });
    expect(fresh.posted[1]).toEqual(sent);
    fresh.reply({ id: fresh.posted[0].id, voxels: new Int16Array(1), stats });
    fresh.reply({ id: sent.id, voxels: new Int16Array([7]), stats });
    expect(Array.from(await region)).toEqual([7]);
    session.dispose();
  });

  it('retries a request only once', async () => {
    const { session, current } = await open();
    const region = session.region([0, 0, 0], [1, 1, 1]);
    current().crash();
    current().crash();
    await expect(region).rejects.toThrow(DECODER_CRASHED_MESSAGE);
    session.dispose();
  });

  it('retries the initial load after a crash', async () => {
    const { session, current } = setup();
    const loading = session.initialize(1024);
    current().onmessageerror?.({} as MessageEvent);
    const fresh = current();
    expect(fresh.posted.map((m) => m.type)).toEqual(['init']);
    fresh.reply({
      id: fresh.posted[0].id,
      voxels: new Int16Array(1),
      manifest,
      stats,
    });
    await expect(loading).resolves.toMatchObject({ meta: { scanId: 'scan' } });
    session.dispose();
  });

  it('gives up after repeated crashes within a minute', async () => {
    const { session, workers, current } = await open();
    const first = session.region([0, 0, 0], [1, 1, 1]);
    current().crash();
    const second = session.region([0, 0, 0], [1, 1, 1]);
    current().crash();
    current().crash();
    await expect(first).rejects.toThrow(DECODER_CRASHED_MESSAGE);
    await expect(second).rejects.toThrow(DECODER_STOPPED_MESSAGE);
    expect(workers).toHaveLength(3);
    await expect(session.region([0, 0, 0], [1, 1, 1])).rejects.toThrow(
      /closed/,
    );
  });

  it('closes the session when the restarted worker cannot reopen the scan', async () => {
    const { session, current } = await open();
    const region = session.region([0, 0, 0], [1, 1, 1]);
    current().crash();
    const fresh = current();
    fresh.reply({ id: fresh.posted[0].id, error: 'Network down' });
    await expect(region).rejects.toThrow(/could not restart: Network down/);
  });

  it('treats a worker that stops answering pings as crashed', async () => {
    vi.useFakeTimers();
    const { session, workers, current } = await open();
    const region = session.region([0, 0, 0], [1, 1, 1]);
    vi.advanceTimersByTime(1000);
    expect(current().last('ping')).toBeTruthy();
    current().reply({ id: 0, pong: true });
    vi.advanceTimersByTime(1000);
    expect(workers).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(workers).toHaveLength(2);
    const fresh = current();
    expect(fresh.posted.map((m) => m.type)).toEqual(['init', 'region']);
    fresh.reply({ id: fresh.posted[0].id, voxels: new Int16Array(1), stats });
    fresh.reply({ id: fresh.posted[1].id, voxels: new Int16Array([3]), stats });
    expect(Array.from(await region)).toEqual([3]);
    session.dispose();
  });

  it('does not ping an idle worker', async () => {
    vi.useFakeTimers();
    const { session, current } = await open();
    vi.advanceTimersByTime(10_000);
    expect(current().posted.some((m) => m.type === 'ping')).toBe(false);
    session.dispose();
  });
});
