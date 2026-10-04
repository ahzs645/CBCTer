import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpSource } from './byteSource';
afterEach(() => vi.unstubAllGlobals());
describe('HTTP byte sources', () => {
  it('requests only exact ranges and tracks transferred bytes', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const range = init.headers.Range as string;
        requests.push(range);
        const [start, end] = range.slice(6).split('-').map(Number);
        return new Response(new Uint8Array(end - start + 1), {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/1000000`,
            ETag: '"v1"',
          },
        });
      }),
    );
    const source = await httpSource('/scan.cbct.zip');
    expect(source.size).toBe(1000000);
    await source.read(50, 100);
    expect(requests).toEqual(['bytes=0-0', 'bytes=50-99']);
    expect(source.bytesRead).toBe(51);
  });
  it('cancels a server that ignores Range before reading a full body', async () => {
    const cancel = vi.fn();
    const arrayBuffer = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        headers: new Headers({ 'Content-Length': '1000000' }),
        body: { cancel },
        arrayBuffer,
      })),
    );
    await expect(httpSource('/scan.cbct.zip')).rejects.toThrow(
      /Download the package/,
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
  it('rejects an archive that changes between requests', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ++calls === 1
          ? new Response(new Uint8Array(1), {
              status: 206,
              headers: { 'Content-Range': 'bytes 0-0/1000', ETag: '"v1"' },
            })
          : new Response(new Uint8Array(4), {
              status: 206,
              headers: { 'Content-Range': 'bytes 10-13/1000', ETag: '"v2"' },
            }),
      ),
    );
    const source = await httpSource('/scan.cbct.zip');
    await expect(source.read(10, 14)).rejects.toThrow(/changed/);
  });
});
