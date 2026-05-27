import { describe, expect, it } from 'vitest';
import { filenameFromContentDisposition, loadRemoteImport } from './remote';

describe('remote import helpers', () => {
  it('extracts RFC 5987 filenames from Content-Disposition', () => {
    expect(
      filenameFromContentDisposition("attachment; filename*=UTF-8''scan%20one.zip"),
    ).toBe('scan one.zip');
  });

  it('extracts quoted filenames from Content-Disposition', () => {
    expect(
      filenameFromContentDisposition('attachment; filename="study.cbcter.zip"'),
    ).toBe('study.cbcter.zip');
  });

  it('loads VolView-style resources manifests', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.endsWith('manifest.json')) {
        return new Response(
          JSON.stringify({
            name: 'remote resources',
            resources: [{ url: 'https://example.test/slice.dcm' }],
          }),
          {
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      return new Response(new Uint8Array([0, 1, 2]), {
        headers: {
          'content-disposition': 'attachment; filename="slice.dcm"',
          'content-type': 'application/dicom',
        },
      });
    }) as typeof fetch;

    try {
      const loaded = await loadRemoteImport('https://example.test/manifest.json');
      expect(loaded.type).toBe('scan-folder');
      if (loaded.type !== 'scan-folder') return;
      expect(loaded.label).toBe('remote resources');
      expect(loaded.source.entries[0].relativePath).toBe('slice.dcm');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
