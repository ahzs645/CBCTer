import { afterEach, describe, expect, it, vi } from 'vitest';

// Run effects synchronously: no DOM renderer is available in these tests.
const cleanups: Array<() => void> = [];
vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  },
}));

const { createUnsavedHandler, useUnsavedWarning } =
  await import('./useUnsavedWarning');

function fakeWindow() {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    listeners,
    addEventListener: (type: string, fn: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: EventListener) =>
      listeners.get(type)?.delete(fn),
  };
}

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
});

describe('useUnsavedWarning', () => {
  it('blocks unload with preventDefault and returnValue', () => {
    const event = {
      preventDefault: vi.fn(),
      returnValue: undefined,
    } as unknown as BeforeUnloadEvent;
    createUnsavedHandler('Unsaved!')(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe('Unsaved!');
  });

  it('installs the handler only while dirty', () => {
    const win = fakeWindow();
    vi.stubGlobal('window', win);
    useUnsavedWarning(false);
    expect(win.listeners.get('beforeunload')?.size ?? 0).toBe(0);
    useUnsavedWarning(true);
    expect(win.listeners.get('beforeunload')?.size).toBe(1);
    cleanups.splice(0).forEach((cleanup) => cleanup());
    expect(win.listeners.get('beforeunload')?.size).toBe(0);
  });
});
