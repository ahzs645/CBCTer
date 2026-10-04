/** Half-open byte ranges, shared by local Blobs and HTTP packages. */
export interface ByteSource {
  size: number;
  read(start: number, end: number): Promise<Uint8Array>;
  bytesRead: number;
}
export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    bytesRead: 0,
    async read(start, end) {
      if (start < 0 || end < start || end > blob.size)
        throw new Error('Invalid byte range.');
      this.bytesRead += end - start;
      return new Uint8Array(await blob.slice(start, end).arrayBuffer());
    },
  };
}
export async function httpSource(url: string): Promise<ByteSource> {
  // A 200 response is cancelled before its body is read: no hidden full download.
  const probe = await fetch(url, { headers: { Range: 'bytes=0-0' } });
  const match = /^bytes 0-0\/(\d+)$/.exec(
    probe.headers.get('content-range') ?? '',
  );
  if (probe.status !== 206 || !match) {
    await probe.body?.cancel();
    throw new Error(
      'This server does not expose byte ranges. Download the package and open the ZIP file instead.',
    );
  }
  const size = Number(match[1]);
  if (!Number.isSafeInteger(size) || size < 22) {
    await probe.body?.cancel();
    throw new Error('Invalid remote package length.');
  }
  if ((await probe.arrayBuffer()).byteLength !== 1)
    throw new Error('Invalid HTTP range response.');
  const etag = probe.headers.get('etag');
  const source: ByteSource = {
    size,
    bytesRead: 1,
    async read(start, end) {
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end <= start ||
        end > size
      )
        throw new Error('Invalid byte range.');
      const response = await fetch(url, {
        headers: {
          Range: `bytes=${start}-${end - 1}`,
          ...(etag && !etag.startsWith('W/') ? { 'If-Range': etag } : {}),
        },
      });
      const expected = `bytes ${start}-${end - 1}/${size}`;
      if (
        response.status !== 206 ||
        response.headers.get('content-range') !== expected ||
        (etag && response.headers.get('etag') !== etag)
      ) {
        await response.body?.cancel();
        throw new Error(
          'The remote package changed or returned an invalid range. Reopen the scan.',
        );
      }
      const data = new Uint8Array(await response.arrayBuffer());
      if (data.length !== end - start)
        throw new Error('Truncated HTTP byte range.');
      this.bytesRead += data.length;
      return data;
    },
  };
  return source;
}
export type ZipSource = Blob | ByteSource;
export function asByteSource(source: ZipSource): ByteSource {
  return 'read' in source ? source : blobSource(source);
}
