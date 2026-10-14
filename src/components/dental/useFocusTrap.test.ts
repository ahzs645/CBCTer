import { describe, expect, it } from 'vitest';
import { nextTrapIndex, tabStopRadios } from './useFocusTrap';

describe('nextTrapIndex', () => {
  it('wraps Tab from the last control to the first', () => {
    expect(nextTrapIndex(3, 2, false)).toBe(0);
  });

  it('wraps Shift+Tab from the first control to the last', () => {
    expect(nextTrapIndex(3, 0, true)).toBe(2);
  });

  it('lets the browser move focus between inner controls', () => {
    expect(nextTrapIndex(3, 0, false)).toBeNull();
    expect(nextTrapIndex(3, 2, true)).toBeNull();
  });

  it('enters at the first or last control from the container or outside', () => {
    expect(nextTrapIndex(3, -1, false)).toBe(0);
    expect(nextTrapIndex(3, -1, true)).toBe(2);
  });

  it('keeps a single control focused', () => {
    expect(nextTrapIndex(1, 0, false)).toBe(0);
    expect(nextTrapIndex(1, 0, true)).toBe(0);
  });

  it('does nothing without controls', () => {
    expect(nextTrapIndex(0, -1, false)).toBeNull();
  });
});

describe('tabStopRadios', () => {
  it('keeps only the checked radio of each group', () => {
    const items = [
      { id: 'close', type: 'button' },
      { id: 'a', type: 'radio', name: 'size', checked: false },
      { id: 'b', type: 'radio', name: 'size', checked: true },
      { id: 'c', type: 'radio', name: 'size', checked: false },
      { id: 'export', type: 'button' },
    ];
    expect(tabStopRadios(items).map((item) => item.id)).toEqual([
      'close',
      'b',
      'export',
    ]);
  });

  it('keeps the first radio when none is checked', () => {
    const items = [
      { id: 'a', type: 'radio', name: 'kind', checked: false },
      { id: 'b', type: 'radio', name: 'kind', checked: false },
      { id: 'solo', type: 'radio', checked: false },
    ];
    expect(tabStopRadios(items).map((item) => item.id)).toEqual(['a', 'solo']);
  });
});
