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
const RANGE_UNSUPPORTED =
  'This server does not expose byte ranges. Download the package and open the ZIP file instead.';
/**
 * Total length of a ZIP served without a readable Content-Range header (hosts
 * such as raw.githubusercontent.com send 206 responses but do not expose
 * that header to other sites). The end-of-central-directory record at the tail gives the
 * central directory's offset and size, and with them the file length.
 */
async function zipLengthFromTail(url: string): Promise<number> {
  const response = await fetch(url, { headers: { Range: 'bytes=-65558' } });
  if (response.status !== 206) {
    await response.body?.cancel();
    throw new Error(RANGE_UNSUPPORTED);
  }
  const tail = new Uint8Array(await response.arrayBuffer());
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let i = tail.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) !== 0x06054b50) continue;
    const comment = view.getUint16(i + 20, true);
    if (i + 22 + comment !== tail.length) continue;
    const size =
      view.getUint32(i + 12, true) +
      view.getUint32(i + 16, true) +
      22 +
      comment;
    if (size >= tail.length - i && Number.isSafeInteger(size)) return size;
  }
  throw new Error('This link does not point to a ZIP scan package.');
}
export async function httpSource(url: string): Promise<ByteSource> {
  // A 200 response is cancelled before its body is read: no hidden full download.
  let probe: Response;
  try {
    probe = await fetch(url, { headers: { Range: 'bytes=0-0' } });
  } catch {
    throw new Error(
      'The host blocked this site from reading the file (no CORS access). Download it and open the ZIP file instead, or host it somewhere that allows other sites to read it.',
    );
  }
  const contentRange = probe.headers.get('content-range');
  const match = /^bytes 0-0\/(\d+)$/.exec(contentRange ?? '');
  if (probe.status !== 206 || (contentRange && !match)) {
    await probe.body?.cancel();
    throw new Error(RANGE_UNSUPPORTED);
  }
  // The header is hidden from scripts: verify each range by its length instead.
  const hiddenRange = !contentRange;
  if ((await probe.arrayBuffer()).byteLength !== 1)
    throw new Error('Invalid HTTP range response.');
  const size = match ? Number(match[1]) : await zipLengthFromTail(url);
  if (!Number.isSafeInteger(size) || size < 22)
    throw new Error('Invalid remote package length.');
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
        (!hiddenRange && response.headers.get('content-range') !== expected) ||
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
