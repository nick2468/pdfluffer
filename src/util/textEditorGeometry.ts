// Where the text editor draws things (spec 21.5). Plain TypeScript, so it is unit tested
// without a browser. A page is drawn by PDFium as a picture; `transform` maps PDF points to that
// picture's pixels, and the dialog shows the picture scaled by `scale` CSS pixels per pixel.

import type { RunLocator, TextRun } from "../engine/textEdit";

/** [a, b, c, d, e, f], as PDF.js writes a transform: x' = a x + c y + e, y' = b x + d y + f. */
export type Transform = readonly number[];

export interface ScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function applyTransform(m: Transform, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invertTransform(m: Transform): number[] {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (det === 0) throw new Error("A transform that flattens the page cannot be inverted.");
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** A run's box in CSS pixels over the shown picture. Turned pages give the box around it. */
export function boxOnScreen(bbox: readonly number[], transform: Transform, scale: number): ScreenBox {
  const [l, b, r, t] = bbox;
  const corners = [applyTransform(transform, l, b), applyTransform(transform, r, b),
    applyTransform(transform, r, t), applyTransform(transform, l, t)];
  const xs = corners.map((p) => p[0] * scale);
  const ys = corners.map((p) => p[1] * scale);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/** A point in CSS pixels over the shown picture, as PDF points in page space. */
export function pagePoint(x: number, y: number, transform: Transform, scale: number): [number, number] {
  return applyTransform(invertTransform(transform), x / scale, y / scale);
}

/** The picture's CSS size when fitted whole into an area, and the scale that gives it. */
export function fitInside(width: number, height: number, areaWidth: number, areaHeight: number):
  { width: number; height: number; scale: number } {
  const scale = Math.max(0, Math.min(areaWidth / width, areaHeight / height));
  return { width: width * scale, height: height * scale, scale };
}

/** A font size in points as CSS pixels on screen, for the input box. */
export function screenFontSize(points: number, transform: Transform, scale: number): number {
  return points * Math.hypot(transform[0], transform[1]) * scale;
}

/**
 * E10: the editable run nearest a point in page space, measured to the edge of its box (0
 * inside it). Null when the page has no editable run, and then the insert uses Arial 11 point.
 */
export function nearestEditableRun(runs: readonly TextRun[], x: number, y: number): TextRun | null {
  let best: TextRun | null = null;
  let bestDistance = Infinity;
  for (const run of runs) {
    if (!run.editable) continue;
    const [l, b, r, t] = run.bbox;
    const dx = Math.max(l - x, 0, x - r);
    const dy = Math.max(b - y, 0, y - t);
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      best = run;
      bestDistance = distance;
    }
  }
  return best;
}

/** How an edit names a run (spec 21.2). */
export function locatorOf(run: TextRun): RunLocator {
  return { pageIndex: run.pageIndex, text: run.text, bbox: run.bbox };
}

/** The same run by the replay's own rule: same page and text, box within 1 point. */
export function sameRun(a: RunLocator, b: RunLocator): boolean {
  return a.pageIndex === b.pageIndex && a.text === b.text && a.bbox.every((v, i) => Math.abs(v - b.bbox[i]) <= 1);
}
