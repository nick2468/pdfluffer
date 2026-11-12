// Spec 22.2. Where a dragged tab lands, and how far the other tabs move aside while it moves.
// Pure functions over the tabs' edges as they were laid out when the drag began, so the
// tab bar's pointer code stays small and this part is tested without a browser.

/** One tab's left and right edges, in the tab strip's own coordinates (scroll included). */
export interface TabEdges { left: number; right: number; }

/**
 * The index the dragged tab lands at, in the final order. `x` is where the dragged tab's
 * centre is now. Each other tab whose centre lies left of `x` goes before it, so the answer
 * is the dragged tab's own index while it sits over its own place, 0 past the left end, and
 * the last index past the right end.
 */
export function dropIndex(x: number, edges: readonly TabEdges[], from: number): number {
  let index = 0;
  edges.forEach((tab, i) => {
    if (i !== from && (tab.left + tab.right) / 2 < x) index++;
  });
  return index;
}

/**
 * How far tab `i` moves aside while the tab at `from` would land at `to`. `step` is the
 * dragged tab's width plus the gap between tabs. The dragged tab itself follows the pointer,
 * so it gets 0 here.
 */
export function shiftFor(i: number, from: number, to: number, step: number): number {
  if (i === from) return 0;
  if (from < to && i > from && i <= to) return -step;
  if (to < from && i >= to && i < from) return step;
  return 0;
}

/** A drag starts only once the pointer has moved this far with the button held. */
export const DRAG_THRESHOLD_PX = 5;

/** True once a press has moved far enough to be a drag rather than a click. */
export function isDrag(startX: number, startY: number, x: number, y: number): boolean {
  return Math.hypot(x - startX, y - startY) >= DRAG_THRESHOLD_PX;
}
