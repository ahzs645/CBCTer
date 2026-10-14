/**
 * Shared control classes, for the few controls that cannot be a `Button`
 * (chart cells, colour chips, link-style buttons, the phone dock).
 */

/** Visible keyboard focus ring; no ring for mouse or touch focus. */
export const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-0';

/**
 * Compact on desktop, at least 36px tall on touch screens. Use this instead
 * of a `touch` prop.
 */
export const COARSE_TARGET = '[@media(pointer:coarse)]:min-h-9';
