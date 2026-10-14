import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearRecentCases,
  getRecentCasesSnapshot,
  loadRecentCases,
  MAX_RECENT_CASES,
  RECENT_CASES_STORAGE_KEY,
  recordRecentCase,
  removeRecentCase,
  subscribeRecentCases,
} from './recentCases';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('recent cases', () => {
  it('keeps newest first and dedupes by key', () => {
    const storage = memoryStorage();
    recordRecentCase(
      { kind: 'url', name: 'a.cbct.zip', url: 'https://x/a', openedAt: 1 },
      storage,
    );
    recordRecentCase(
      { kind: 'file', name: 'b.zip', openedAt: 2, teeth: 28 },
      storage,
    );
    recordRecentCase(
      { kind: 'url', name: 'a.cbct.zip', url: 'https://x/a', openedAt: 3 },
      storage,
    );
    const list = loadRecentCases(storage);
    expect(list.map((e) => [e.key, e.openedAt])).toEqual([
      ['url:https://x/a', 3],
      ['file:b.zip', 2],
    ]);
    expect(list[1].teeth).toBe(28);
  });

  it(`keeps at most ${MAX_RECENT_CASES} entries`, () => {
    const storage = memoryStorage();
    for (let i = 0; i < 12; i++)
      recordRecentCase({ kind: 'file', name: `f${i}`, openedAt: i }, storage);
    const list = loadRecentCases(storage);
    expect(list).toHaveLength(MAX_RECENT_CASES);
    expect(list[0].name).toBe('f11');
    expect(list.at(-1)!.name).toBe('f4');
  });

  it('removes and clears entries', () => {
    const storage = memoryStorage();
    recordRecentCase({ kind: 'sample', name: 'Sample' }, storage);
    recordRecentCase({ kind: 'file', name: 'x.zip' }, storage);
    expect(removeRecentCase('sample:default', storage)).toHaveLength(1);
    clearRecentCases(storage);
    expect(loadRecentCases(storage)).toEqual([]);
    expect(storage.data.has(RECENT_CASES_STORAGE_KEY)).toBe(false);
  });

  it('ignores corrupt data and failing storage', () => {
    const storage = memoryStorage();
    storage.setItem(RECENT_CASES_STORAGE_KEY, '{not json');
    expect(loadRecentCases(storage)).toEqual([]);
    storage.setItem(
      RECENT_CASES_STORAGE_KEY,
      JSON.stringify([
        { key: 1 },
        { key: 'k', name: 'n', kind: 'file', openedAt: 1 },
      ]),
    );
    expect(loadRecentCases(storage)).toHaveLength(1);
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    expect(loadRecentCases(broken)).toEqual([]);
    expect(() =>
      recordRecentCase({ kind: 'file', name: 'x' }, broken),
    ).not.toThrow();
    expect(loadRecentCases(null)).toEqual([]);
  });

  it('notifies subscribers and keeps a stable snapshot', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const listener = vi.fn();
    const unsubscribe = subscribeRecentCases(listener);
    const before = getRecentCasesSnapshot();
    expect(getRecentCasesSnapshot()).toBe(before);
    recordRecentCase({ kind: 'url', name: 'a', url: 'https://x/a' });
    expect(listener).toHaveBeenCalledOnce();
    const after = getRecentCasesSnapshot();
    expect(after).not.toBe(before);
    expect(getRecentCasesSnapshot()).toBe(after);
    expect(after[0].url).toBe('https://x/a');
    unsubscribe();
  });
});
