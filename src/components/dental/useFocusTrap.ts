import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Where Tab should go from the element at `index` among `count` tabbable
 * elements (`index` is -1 when focus is on the container itself or outside
 * it). Returns the index to focus, or null to let the browser move focus
 * normally inside the container.
 */
export function nextTrapIndex(
  count: number,
  index: number,
  backwards: boolean,
): number | null {
  if (count === 0) return null;
  if (backwards) return index <= 0 ? count - 1 : null;
  return index === -1 || index >= count - 1 ? 0 : null;
}

/**
 * Of a set of radio buttons only one is a Tab stop: the checked one, or the
 * first of the group when none is checked. Drops the others.
 */
export function tabStopRadios<
  T extends { type?: string; name?: string; checked?: boolean },
>(elements: T[]): T[] {
  const stop = new Map<string, T>();
  for (const element of elements) {
    if (element.type !== 'radio' || !element.name) continue;
    const current = stop.get(element.name);
    if (!current || (!current.checked && element.checked))
      stop.set(element.name, element);
  }
  return elements.filter(
    (element) =>
      element.type !== 'radio' ||
      !element.name ||
      stop.get(element.name) === element,
  );
}

function tabbable(container: HTMLElement): HTMLElement[] {
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.closest('[inert]') &&
      element.getClientRects().length > 0,
  );
  return tabStopRadios(candidates as Array<HTMLElement & HTMLInputElement>);
}

/**
 * Modal focus handling for a dialog or sheet:
 * - on mount, moves focus into the container (the container itself, which
 *   should have `tabIndex={-1}`, unless something inside already has focus);
 * - Tab and Shift+Tab cycle through the controls inside it;
 * - on unmount, returns focus to whatever had it before (the button that
 *   opened the dialog) if focus was inside the dialog or lost.
 *
 * Attach the returned ref to the dialog element.
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  active = true,
) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const container = ref.current;
    if (!active || !container) return;
    const previous =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null;
    if (!container.contains(document.activeElement)) {
      container.focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      const items = tabbable(container);
      if (items.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const current = document.activeElement as HTMLElement | null;
      const index = current ? items.indexOf(current) : -1;
      // Focus somewhere inside that is not a Tab stop (e.g. the container
      // itself is handled as -1 below); let the browser move on from there.
      if (index === -1 && current && current !== container && container.contains(current))
        return;
      const next = nextTrapIndex(items.length, index, event.shiftKey);
      if (next == null) return;
      event.preventDefault();
      items[next].focus();
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const focused = document.activeElement;
      const lost =
        !focused || focused === document.body || container.contains(focused);
      if (lost && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active]);

  return ref;
}
