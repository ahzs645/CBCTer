/**
 * Recently opened scans, kept in localStorage on this device only. Links and
 * the bundled sample can be reopened; a local file only shows its name, since
 * browsers do not let a page reopen a file without the user picking it again.
 */
export type RecentCaseKind = 'url' | 'file' | 'sample';

export interface RecentCase {
  key: string;
  name: string;
  kind: RecentCaseKind;
  /** Remote package URL (`url`) or sample path (`sample`). */
  url?: string;
  openedAt: number;
  teeth?: number;
}

export type RecentCaseInput = Omit<RecentCase, 'key' | 'openedAt'> & {
  key?: string;
  openedAt?: number;
};

type RecentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const RECENT_CASES_STORAGE_KEY = 'cbcter.recentCases';
export const MAX_RECENT_CASES = 8;

const KINDS = new Set<RecentCaseKind>(['url', 'file', 'sample']);
const EMPTY: RecentCase[] = [];

function defaultStorage(): RecentStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function recentCaseKey({
  kind,
  name,
  url,
}: Pick<RecentCase, 'kind' | 'name' | 'url'>): string {
  if (kind === 'url') return `url:${url ?? name}`;
  if (kind === 'sample') return `sample:${url ?? 'default'}`;
  return `file:${name}`;
}

function isRecentCase(value: unknown): value is RecentCase {
  const v = value as RecentCase | null;
  return (
    !!v &&
    typeof v === 'object' &&
    typeof v.key === 'string' &&
    typeof v.name === 'string' &&
    KINDS.has(v.kind) &&
    typeof v.openedAt === 'number' &&
    (v.url === undefined || typeof v.url === 'string') &&
    (v.teeth === undefined || typeof v.teeth === 'number')
  );
}

export function parseRecentCases(raw: string | null): RecentCase[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentCase).slice(0, MAX_RECENT_CASES);
  } catch {
    return [];
  }
}

/** Puts `entry` first, dropping an older entry with the same key. */
export function addRecentCase(
  list: readonly RecentCase[],
  entry: RecentCase,
): RecentCase[] {
  return [entry, ...list.filter((e) => e.key !== entry.key)].slice(
    0,
    MAX_RECENT_CASES,
  );
}

const listeners = new Set<() => void>();
let snapshotRaw: string | null | undefined;
let snapshot: RecentCase[] = EMPTY;

function readRaw(storage: RecentStorage | null): string | null {
  try {
    return storage?.getItem(RECENT_CASES_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function loadRecentCases(
  storage: RecentStorage | null = defaultStorage(),
): RecentCase[] {
  return parseRecentCases(readRaw(storage));
}

function save(storage: RecentStorage | null, list: RecentCase[]) {
  try {
    if (list.length)
      storage?.setItem(RECENT_CASES_STORAGE_KEY, JSON.stringify(list));
    else storage?.removeItem(RECENT_CASES_STORAGE_KEY);
  } catch {
    // Private mode or a full quota: the list just is not remembered.
  }
  listeners.forEach((listener) => listener());
}

export function recordRecentCase(
  input: RecentCaseInput,
  storage: RecentStorage | null = defaultStorage(),
): RecentCase[] {
  const entry: RecentCase = {
    key: input.key ?? recentCaseKey(input),
    name: input.name,
    kind: input.kind,
    openedAt: input.openedAt ?? Date.now(),
    ...(input.url !== undefined ? { url: input.url } : {}),
    ...(input.teeth !== undefined ? { teeth: input.teeth } : {}),
  };
  const list = addRecentCase(loadRecentCases(storage), entry);
  save(storage, list);
  return list;
}

export function removeRecentCase(
  key: string,
  storage: RecentStorage | null = defaultStorage(),
): RecentCase[] {
  const list = loadRecentCases(storage).filter((e) => e.key !== key);
  save(storage, list);
  return list;
}

export function clearRecentCases(
  storage: RecentStorage | null = defaultStorage(),
) {
  save(storage, []);
}

/** For `useSyncExternalStore`: changes here and in other tabs. */
export function subscribeRecentCases(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === RECENT_CASES_STORAGE_KEY)
      listener();
  };
  const win = typeof window === 'undefined' ? undefined : window;
  win?.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    win?.removeEventListener('storage', onStorage);
  };
}

/** Stable snapshot for `useSyncExternalStore` (same array until it changes). */
export function getRecentCasesSnapshot(): RecentCase[] {
  const raw = readRaw(defaultStorage());
  if (raw !== snapshotRaw) {
    snapshotRaw = raw;
    snapshot = raw ? parseRecentCases(raw) : EMPTY;
  }
  return snapshot;
}

export function getRecentCasesServerSnapshot(): RecentCase[] {
  return EMPTY;
}
