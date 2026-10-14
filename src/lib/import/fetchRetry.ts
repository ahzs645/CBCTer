/** Waits before each retry of a failed range read: three retries, doubling. */
export const RANGE_RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000];

export interface RetryOptions {
  /** Delay before each retry; its length is the number of retries. */
  delays?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

/** A failure worth trying again: network drop, overloaded host, short body. */
export class TransientFetchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TransientFetchError';
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) &&
    error.name === 'AbortError'
  );
}

/** 408, 429 and 5xx may succeed later; other 4xx never will. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `fetch` that turns network failures (a rejected fetch is a TypeError) into
 * {@link TransientFetchError}s and leaves aborts as they are.
 */
export async function fetchTransient(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (isAbortError(error) || init?.signal?.aborted) throw error;
    throw new TransientFetchError('Network error while reading the scan.', {
      cause: error,
    });
  }
}

/** Reads a whole body, treating a connection lost mid-body as transient. */
export async function readBodyTransient(
  response: Response,
): Promise<Uint8Array> {
  try {
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new TransientFetchError('The connection dropped mid-download.', {
      cause: error,
    });
  }
}

/** Throws a {@link TransientFetchError} for a status worth retrying. */
export async function rejectRetryableStatus(response: Response) {
  if (!isRetryableStatus(response.status)) return;
  await response.body?.cancel().catch(() => undefined);
  throw new TransientFetchError(
    `The scan host did not respond (HTTP ${response.status}). Check your connection and try again.`,
  );
}

/**
 * Runs `attempt`, retrying with backoff while it throws a
 * {@link TransientFetchError}. Aborts and other errors are thrown at once.
 */
export async function withRetry<T>(
  attempt: () => Promise<T>,
  {
    delays = RANGE_RETRY_DELAYS_MS,
    sleep = defaultSleep,
    signal,
  }: RetryOptions = {},
): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await attempt();
    } catch (error) {
      if (
        !(error instanceof TransientFetchError) ||
        signal?.aborted ||
        retry >= delays.length
      )
        throw error;
      await sleep(delays[retry]);
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    }
  }
}
