import { describe, expect, it, vi } from 'vitest';
import { filenameFromContentDisposition, loadRemoteImport } from './remote';

describe('remote import helpers', () => {
  it('downloads a large binary once without reading it as manifest text', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array(4 * 1024 * 1024 + 1), {
        headers: { 'content-type': 'application/octet-stream' },
      }),
    );
    const text = vi.spyOn(File.prototype, 'text');
    try {
      const loaded = await loadRemoteImport('https://example.test/volume.bin');
      expect(loaded.type).toBe('scan-folder');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(text).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
      text.mockRestore();
    }
  });

  it('hands a native package URL to the range reader without downloading it', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      const loaded = await loadRemoteImport(
        'https://example.test/case.cbct.zip',
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(loaded.type).toBe('scan-folder');
      if (loaded.type === 'scan-folder') {
        expect(loaded.source.entries[0].remoteUrl).toBe(
          'https://example.test/case.cbct.zip',
        );
      }
    } finally {
      fetch.mockRestore();
    }
  });

  it('extracts RFC 5987 filenames from Content-Disposition', () => {
    expect(
      filenameFromContentDisposition(
        "attachment; filename*=UTF-8''scan%20one.zip",
      ),
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
      const loaded = await loadRemoteImport(
        'https://example.test/manifest.json',
      );
      expect(loaded.type).toBe('scan-folder');
      if (loaded.type !== 'scan-folder') return;
      expect(loaded.label).toBe('remote resources');
      expect(loaded.source.entries[0].relativePath).toBe('slice.dcm');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
