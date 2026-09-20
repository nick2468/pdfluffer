// Where an annotation's appearance stream goes on the page (spec 13.4, flatten step 2).
// Pure arithmetic over plain numbers, so it can be checked without building a PDF.
//
// A PDF viewer draws an annotation by fitting the appearance stream's own bounding box,
// after the stream's /Matrix, into the annotation's /Rect. Flattening has to reproduce that
// fit. The stream's /Matrix is left alone: a renderer applies a form XObject's own matrix.

export interface Placement {
  /** The transformation to concatenate before drawing the stream: sx 0 0 sy tx ty. */
  sx: number; sy: number; tx: number; ty: number;
}

/** Four finite numbers for a box, six for a matrix. Anything else is not usable. */
function usable(values: readonly number[], count: number): boolean {
  return values.length === count && values.every((value) => Number.isFinite(value));
}

/**
 * Fits bbox, transformed by matrix, into rect. Null when the transformed box has no width
 * or no height, or when any input has the wrong shape. The caller then leaves that
 * annotation where it is rather than drawing it wrongly.
 */
export function placementFor(
  bbox: readonly number[], matrix: readonly number[], rect: readonly number[],
): Placement | null {
  if (!usable(bbox, 4) || !usable(matrix, 6) || !usable(rect, 4)) return null;
  const [a, b, c, d, e, f] = matrix;
  const [bx0, by0, bx1, by1] = bbox;

  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]]) {
    xs.push(a * x + c * y + e);
    ys.push(b * x + d * y + f);
  }
  const tx0 = Math.min(...xs);
  const ty0 = Math.min(...ys);
  const width = Math.max(...xs) - tx0;
  const height = Math.max(...ys) - ty0;
  if (width === 0 || height === 0) return null;

  // /Rect may name any two opposite corners, so normalise it before measuring.
  const rx = Math.min(rect[0], rect[2]);
  const ry = Math.min(rect[1], rect[3]);
  const sx = Math.abs(rect[2] - rect[0]) / width;
  const sy = Math.abs(rect[3] - rect[1]) / height;
  return { sx, sy, tx: rx - tx0 * sx, ty: ry - ty0 * sy };
}
