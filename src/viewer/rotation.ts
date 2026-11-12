// Spec 22.1. PDF.js's own rotate commands turn the pages, not the view. These are the pure
// parts of that rule, so they can be tested without PDF.js. PdfJsViewer applies them.

import type { RotateDelta, ViewState } from "./Viewer";

/** PDF.js 6.3.289's Rotate Clockwise and Counterclockwise buttons (viewer.html 641, 644). */
export const ROTATE_BUTTONS: Readonly<Record<string, RotateDelta>> = {
  pageRotateCw: 90,
  pageRotateCcw: -90,
};

/** The CSS selector that finds either rotate button from a click target. */
export const ROTATE_BUTTON_SELECTOR = Object.keys(ROTATE_BUTTONS).map((id) => `#${id}`).join(", ");

/** The quarter turn a rotate button stands for, or null for any other element id. */
export function rotateButtonDelta(id: string | null | undefined): RotateDelta | null {
  if (!id || !Object.prototype.hasOwnProperty.call(ROTATE_BUTTONS, id)) return null;
  return ROTATE_BUTTONS[id];
}

/**
 * The fallback of spec 22.1: a view PDF.js turned by a path PDFluffer did not catch first.
 * One quarter turn either way becomes that page change. Anything else (180, or a value that
 * is not a multiple of 90) cannot come from one command, so it is only turned back.
 */
export function deltaFromTurnedView(rotation: number): RotateDelta | null {
  const r = ((rotation % 360) + 360) % 360;
  if (r === 90) return 90;
  if (r === 270) return -90;
  return null;
}

/** A stored view with its rotation dropped. A file always opens with its view unturned. */
export function unturned(view: ViewState): ViewState {
  return { ...view, rotation: 0 };
}
