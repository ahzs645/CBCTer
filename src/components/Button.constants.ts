/**
 * Shared control classes, for the few controls that cannot be a `Button`
 * (chart cells, colour chips, link-style buttons, the phone dock).
 */

/** Visible keyboard focus ring; no ring for mouse or touch focus. */
export const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-0';

/**
 * Looks the same everywhere; on touch screens the tap area grows to 44 px
 * (see `.touch-target` in styles.css). Use this instead of a `touch` prop.
 */
export const COARSE_TARGET = 'touch-target';
