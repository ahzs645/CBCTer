export interface RemoteRangeResult {
  url: string;
  bytes: Uint8Array;
  contentType: string;
  contentLength?: number;
  rangeSupported: boolean;
}

function parseTotalLength(contentRange: string | null): number | undefined {
  const match = /\/(\d+)$/.exec(contentRange ?? '');
  return match ? Number(match[1]) : undefined;
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function fetchRemoteRange(
  url: string,
  start = 0,
  end = 4095,
): Promise<RemoteRangeResult> {
  const response = await fetch(url, {
    headers: {
      Range: `bytes=${start}-${end}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Remote range request failed for ${url}: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    url: response.url || url,
    bytes,
    contentType: response.headers.get('content-type') ?? '',
    contentLength:
      parseTotalLength(response.headers.get('content-range')) ??
      parseContentLength(response.headers.get('content-length')),
    rangeSupported: response.status === 206,
  };
}
