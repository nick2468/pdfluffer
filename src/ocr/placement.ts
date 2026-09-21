// Spec 20.4: where invisible text goes so that it sits exactly over a word in a scan.
// Pure. It knows the OCR result, PDF.js's viewport transform and how wide the font is, and
// nothing else, so every rule here is a unit test.
//
// The design, settled in chip 12: let PDF.js do the page geometry. Its viewport transform
// maps PDF points to picture pixels and already holds the page's /Rotate, its crop box
// offset and the flip of the y axis. So this file never reasons about rotation case by
// case. It inverts that one matrix.

import type { OcrPageResult } from "./OcrService";

export interface Point { x: number; y: number; }

/** One word, ready for pdf-lib: its text, text matrix, font size and horizontal scale. */
export interface PlacedWord {
  text: string;
  /** The text matrix, a b c d e f: a unit direction, its perpendicular, and the origin. */
  matrix: number[];
  fontSize: number;
  /** Tz, as a percentage, so the word is exactly as wide as the word in the picture. */
  scalePercent: number;
}

/**
 * The text height, as a share of the line's median word height. The engine's box hugs the
 * ink, and a font's size is a little taller than its letters.
 */
export const SIZE_FACTOR = 1.1;
/** How far the baseline sits above the bottom of the box, as a share of the text size. */
export const DESCENT_FACTOR = 0.12;

/** a b c d e f: x' = a x + c y + e, y' = b x + d y + f. */
export function apply(m: number[], p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** The inverse of an affine transform. Throws for one that flattens the page to a line. */
export function invert(m: number[]): number[] {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    throw new Error("This page's viewport cannot be inverted.");
  }
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/**
 * Decision 16, proven against measured pictures in chip 11. The engine measures words on a
 * picture it has straightened by turning it anticlockwise by `textAngle`. This turns a
 * point back, **clockwise** by the same angle about the picture's centre, with y down.
 */
export function unskew(point: Point, angleDeg: number, centre: Point): Point {
  if (angleDeg === 0) return { ...point };
  const a = (angleDeg * Math.PI) / 180;
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  return {
    x: centre.x + dx * Math.cos(a) - dy * Math.sin(a),
    y: centre.y + dx * Math.sin(a) + dy * Math.cos(a),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const positive = (n: number) => Number.isFinite(n) && n > 0;

/** -0 reads as 0, so a matrix prints and compares the way it looks. */
const tidy = (n: number) => n + 0;

/**
 * Every word of one page, placed. `measure` and `encodable` come from the font that will
 * show the text: its width at a size, and whether it can hold a character at all. A
 * character it cannot hold is dropped, and a word left empty, flat or unmeasurable is
 * skipped rather than drawn wrong.
 */
export function placeOcrPage(
  result: OcrPageResult,
  transform: number[],
  measure: (text: string, size: number) => number,
  encodable: (ch: string) => boolean,
): PlacedWord[] {
  const toPoints = invert(transform);
  const angle = result.textAngle ?? 0;
  const centre = { x: result.width / 2, y: result.height / 2 };
  const toPage = (p: Point) => apply(toPoints, unskew(p, angle, centre));
  const placed: PlacedWord[] = [];

  for (const line of result.lines) {
    // One size and one baseline for the whole line, from its words' medians, so a
    // selection across the line looks even instead of stepping with each word's letters.
    const sized = line.words.filter((w) => positive(w.h) && Number.isFinite(w.y));
    if (sized.length === 0) continue;
    const size = SIZE_FACTOR * median(sized.map((w) => w.h));
    const base = median(sized.map((w) => w.y + w.h)) - DESCENT_FACTOR * size;

    for (const word of line.words) {
      const text = Array.from(word.text).filter(encodable).join("");
      if (!text || !positive(word.w) || !Number.isFinite(word.x)) continue;

      // In picture pixels, on the engine's straightened frame: the baseline's two ends, and
      // the point one text height above its start.
      const q0 = toPage({ x: word.x, y: base });
      const q1 = toPage({ x: word.x + word.w, y: base });
      const q2 = toPage({ x: word.x, y: base - size });

      const fontSize = Math.hypot(q2.x - q0.x, q2.y - q0.y);
      const length = Math.hypot(q1.x - q0.x, q1.y - q0.y);
      if (!positive(fontSize) || !positive(length)) continue;
      const natural = measure(text, fontSize);
      if (!positive(natural)) continue;

      const ux = (q1.x - q0.x) / length;
      const uy = (q1.y - q0.y) / length;
      placed.push({
        text,
        matrix: [ux, uy, -uy, ux, q0.x, q0.y].map(tidy),
        fontSize,
        scalePercent: (100 * length) / natural,
      });
    }
  }
  return placed;
}
