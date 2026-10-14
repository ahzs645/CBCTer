import { describe, expect, it } from 'vitest';
import {
  cacheNamesFor,
  isLargeDataPath,
  isStorableResponse,
  MAX_RUNTIME_ENTRY_BYTES,
  pruneCacheNames,
  trimCache,
} from './swCache';

describe('service worker cache policy', () => {
  it('versions cache names', () => {
    expect(cacheNamesFor('abc')).toEqual({
      shell: 'cbcter-shell-abc',
      runtime: 'cbcter-runtime-abc',
    });
  });

  it('prunes old app caches but keeps the current ones and foreign caches', () => {
    const current = cacheNamesFor('new');
    expect(
      pruneCacheNames(
        [
          'cbcter-shell-old',
          'cbcter-runtime-old',
          current.shell,
          current.runtime,
          'voxel-viewer-shell-v1',
          'onnx-models',
        ],
        [current.shell, current.runtime],
      ),
    ).toEqual([
      'cbcter-shell-old',
      'cbcter-runtime-old',
      'voxel-viewer-shell-v1',
    ]);
  });

  it('never stores scan data or models', () => {
    expect(isLargeDataPath('/scans/a.cbct.zip')).toBe(true);
    expect(isLargeDataPath('/sample-cbct/manifest.json')).toBe(true);
    expect(isLargeDataPath('/models/dentalsegmentator.onnx')).toBe(true);
    expect(isLargeDataPath('/scan.nii.gz')).toBe(true);
    expect(isLargeDataPath('/assets/index-abc123.js')).toBe(false);
    expect(isLargeDataPath('/assets/ort-wasm-simd-threaded.jsep-x.wasm')).toBe(
      false,
    );
  });

  it('stores only full, same-origin, bounded responses', () => {
    const ok = (init: ResponseInit = {}) => new Response('x', init);
    expect(isStorableResponse(ok())).toBe(true);
    expect(isStorableResponse(ok({ status: 206 }))).toBe(false);
    expect(isStorableResponse(ok({ status: 404 }))).toBe(false);
    expect(
      isStorableResponse(ok({ headers: { 'Content-Range': 'bytes 0-0/10' } })),
    ).toBe(false);
    expect(
      isStorableResponse(
        ok({
          headers: { 'Content-Length': String(MAX_RUNTIME_ENTRY_BYTES + 1) },
        }),
      ),
    ).toBe(false);
  });

  it('evicts the oldest entries beyond the cap', async () => {
    const keys = ['a', 'b', 'c', 'd', 'e'].map(
      (k) => new Request(`https://x/${k}`),
    );
    const deleted: string[] = [];
    const cache = {
      keys: async () => keys,
      delete: async (request: RequestInfo | URL) => {
        deleted.push((request as Request).url);
        return true;
      },
    } as unknown as Cache;
    expect(await trimCache(cache, 3)).toBe(2);
    expect(deleted).toEqual(['https://x/a', 'https://x/b']);
    expect(await trimCache(cache, 10)).toBe(0);
  });
});
