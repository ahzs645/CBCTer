import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpSource } from './byteSource';
import {
  isRetryableStatus,
  RANGE_RETRY_DELAYS_MS,
  TransientFetchError,
  withRetry,
} from './fetchRetry';
import { fetchRemoteRange } from './remoteRange';

afterEach(() => vi.unstubAllGlobals());

const SIZE = 1000;

function rangeResponse(range: string, trim = 0) {
  const [start, end] = range.slice(6).split('-').map(Number);
  return new Response(new Uint8Array(end - start + 1 - trim), {
    status: 206,
    headers: { 'Content-Range': `bytes ${start}-${end}/${SIZE}` },
  });
}

/** fetch stub: the probe succeeds, then each read follows `script`. */
function stubFetch(
  script: Array<'ok' | 'network' | 'abort' | 'short' | number>,
) {
  const calls: string[] = [];
  let reads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const range = (init.headers as Record<string, string>).Range;
      calls.push(range);
      if (range === 'bytes=0-0') return rangeResponse(range);
      const step = script[reads++] ?? 'ok';
      if (step === 'network') throw new TypeError('Failed to fetch');
      if (step === 'abort') throw new DOMException('Cancelled', 'AbortError');
      if (step === 'short') return rangeResponse(range, 3);
      if (typeof step === 'number')
        return new Response('nope', { status: step });
      return rangeResponse(range);
    }),
  );
  return calls;
}

async function source(sleeps: number[] = []) {
  return httpSource('/scan.cbct.zip', {
    retry: {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    },
  });
}

describe('range read retries', () => {
  it('retries network errors with exponential backoff', async () => {
    const calls = stubFetch(['network', 'network', 'ok']);
    const sleeps: number[] = [];
    const s = await source(sleeps);
    expect(await s.read(10, 20)).toHaveLength(10);
    expect(sleeps).toEqual([500, 1000]);
    expect(calls.filter((c) => c === 'bytes=10-19')).toHaveLength(3);
    expect(s.bytesRead).toBe(11);
  });

  it('retries 5xx, 429 and 408 responses', async () => {
    stubFetch([503, 429, 408, 'ok']);
    const sleeps: number[] = [];
    const s = await source(sleeps);
    expect(await s.read(0, 8)).toHaveLength(8);
    expect(sleeps).toEqual([...RANGE_RETRY_DELAYS_MS]);
  });

  it('retries truncated bodies', async () => {
    stubFetch(['short', 'ok']);
    const s = await source();
    expect(await s.read(0, 100)).toHaveLength(100);
  });

  it('gives up after three retries', async () => {
    const calls = stubFetch([502, 502, 502, 502, 'ok']);
    const s = await source();
    await expect(s.read(0, 8)).rejects.toThrow(/HTTP 502/);
    expect(calls.filter((c) => c === 'bytes=0-7')).toHaveLength(4);
  });

  it('reports a truncated range once retries run out', async () => {
    stubFetch(['short', 'short', 'short', 'short']);
    const s = await source();
    await expect(s.read(0, 8)).rejects.toThrow(/Truncated/);
  });

  it('does not retry other client errors', async () => {
    const calls = stubFetch([404, 'ok']);
    const s = await source();
    await expect(s.read(0, 8)).rejects.toThrow(/changed or returned/);
    expect(calls.filter((c) => c === 'bytes=0-7')).toHaveLength(1);
  });

  it('never retries an abort', async () => {
    const calls = stubFetch(['abort', 'ok']);
    const s = await source();
    await expect(s.read(0, 8)).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls.filter((c) => c === 'bytes=0-7')).toHaveLength(1);
  });

  it('retries fetchRemoteRange on server errors', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ++calls === 1
          ? new Response('', { status: 500 })
          : rangeResponse('bytes=0-3'),
      ),
    );
    const result = await fetchRemoteRange('/a.zip', 0, 3, {
      sleep: async () => undefined,
    });
    expect(result.bytes).toHaveLength(4);
    expect(calls).toBe(2);
  });
});

describe('withRetry', () => {
  it('rethrows non-transient errors immediately', async () => {
    const attempt = vi.fn(async () => {
      throw new Error('bad');
    });
    await expect(withRetry(attempt)).rejects.toThrow('bad');
    expect(attempt).toHaveBeenCalledOnce();
  });

  it('stops retrying once its signal aborts', async () => {
    const abort = new AbortController();
    const attempt = vi.fn(async () => {
      throw new TransientFetchError('flaky');
    });
    await expect(
      withRetry(attempt, {
        signal: abort.signal,
        sleep: async () => abort.abort(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempt).toHaveBeenCalledOnce();
  });

  it('classifies statuses', () => {
    expect([408, 429, 500, 503].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 403, 404, 416].some(isRetryableStatus)).toBe(false);
  });
});
