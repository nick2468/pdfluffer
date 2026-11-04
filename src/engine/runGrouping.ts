// How text objects become runs (spec 21): one baseline, one font, size and colour, gaps no
// wider than 1.5 times the font size, in the order the page draws them. Pure, so the rule is
// tested with plain numbers, and the adapter only has to read the objects.

import type { NotEditableReason } from "./textEdit";

/** One page-level text object, as the adapter read it. */
export interface TextObjectInfo {
  text: string;
  /** Identifies the font object. Two objects share a font when their keys are equal. */
  fontKey: number;
  /** The size in points on the page: the font size times the matrix's scale across the line. */
  size: number;
  colour: [number, number, number];
  renderMode: number;
  /** The object's matrix, [a b c d e f]. (a, b) is the text direction, (e, f) the origin. */
  matrix: number[];
  /** The four corners of the object's box, turned with the text: x0 y0 x1 y1 x2 y2 x3 y3. */
  quad: number[];
  /** Axis-aligned box in page space: left, bottom, right, top. */
  bounds: [number, number, number, number];
  /** Set by the adapter for what E9 says to leave alone. */
  notEditable?: NotEditableReason;
}

export interface GroupedRun {
  /** Indexes into the input, in drawing order. */
  members: number[];
  text: string;
  bbox: [number, number, number, number];
  /** Where the run ends along its text direction, measured as `extentAlong` does. */
  end: number;
}

/** Same baseline: the origin within this many font sizes across the line (spec 21). */
export const BASELINE_TOLERANCE = 0.3;
/** The widest gap inside a run, in font sizes (spec 21). */
export const MAX_GAP = 1.5;
/** A gap this wide or wider, in font sizes, reads as a word space when neither side has one. */
export const SPACE_GAP = 0.2;
/** A run may overlap its last object by this much, in font sizes: kerning, italic overhang. */
const MAX_OVERLAP = 0.5;

/** The unit vector along the text, from a matrix's first column. */
export function directionOf(matrix: number[]): [number, number] {
  const length = Math.hypot(matrix[0], matrix[1]) || 1;
  return [matrix[0] / length, matrix[1] / length];
}

/** The smallest and largest projection of a quad's corners onto a direction. */
export function extentAlong(quad: number[], dir: [number, number]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 8; i += 2) {
    const p = quad[i] * dir[0] + quad[i + 1] * dir[1];
    lo = Math.min(lo, p);
    hi = Math.max(hi, p);
  }
  return [lo, hi];
}

function sameColour(a: [number, number, number], b: [number, number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** True when `next` continues the run whose first object is `first` and which ends at `end`. */
function continues(first: TextObjectInfo, end: number, next: TextObjectInfo): boolean {
  if (next.fontKey !== first.fontKey || next.renderMode !== first.renderMode) return false;
  if (!sameColour(next.colour, first.colour)) return false;
  if (Math.abs(next.size - first.size) > first.size * 0.01) return false;
  if (next.notEditable !== first.notEditable) return false;

  const dir = directionOf(first.matrix);
  const nextDir = directionOf(next.matrix);
  if (dir[0] * nextDir[0] + dir[1] * nextDir[1] < 0.999) return false;

  // Across the line: the distance of next's origin from first's baseline.
  const across = -(next.matrix[4] - first.matrix[4]) * dir[1] + (next.matrix[5] - first.matrix[5]) * dir[0];
  if (Math.abs(across) > BASELINE_TOLERANCE * first.size) return false;

  const gap = extentAlong(next.quad, dir)[0] - end;
  return gap <= MAX_GAP * first.size && gap >= -MAX_OVERLAP * first.size;
}

/**
 * Groups a page's text objects into runs. Only consecutive objects join, so text the page
 * draws between two parts of a line (a bold word, say) always splits it. A run holding only
 * white space is dropped: there is nothing in it to see or edit.
 *
 * PDFium's text reader drops text drawn again over text it already holds (the fake-bold
 * trick: draw a word twice, slightly apart), so the copy reads as an empty object. An empty
 * object lying over an earlier run, in the same direction and size, joins that run silently,
 * so deleting or replacing the run takes the copy too (BUILD-NOTES decision 24). Any other
 * empty object is left alone.
 */
export function groupRuns(objects: TextObjectInfo[]): GroupedRun[] {
  const all: { run: GroupedRun; first: TextObjectInfo }[] = [];
  let current: { run: GroupedRun; first: TextObjectInfo } | null = null;

  for (let index = 0; index < objects.length; index++) {
    const object = objects[index];
    if (object.text === "") {
      const under = [...all].reverse().find(({ run, first }) => liesOver(object, first, run.bbox));
      if (under) {
        under.run.members.push(index);
        under.run.bbox = union(under.run.bbox, object.bounds);
      }
      continue;
    }
    if (current && continues(current.first, current.run.end, object)) {
      const { run, first } = current;
      const dir = directionOf(first.matrix);
      const [start, end] = extentAlong(object.quad, dir);
      const gap = start - run.end;
      const spaced = /\s$/.test(run.text) || /^\s/.test(object.text);
      run.text += gap >= SPACE_GAP * first.size && !spaced ? " " + object.text : object.text;
      run.members.push(index);
      run.bbox = union(run.bbox, object.bounds);
      run.end = Math.max(run.end, end);
      continue;
    }
    current = {
      first: object,
      run: {
        members: [index],
        text: object.text,
        bbox: [...object.bounds],
        end: extentAlong(object.quad, directionOf(object.matrix))[1],
      },
    };
    all.push(current);
  }
  return all.map(({ run }) => run).filter((run) => run.text.trim() !== "");
}

/** True when an empty object's centre lies inside a run's box, drawn the same way and size. */
function liesOver(object: TextObjectInfo, first: TextObjectInfo, bbox: [number, number, number, number]): boolean {
  if (first.notEditable !== object.notEditable) return false;
  if (Math.abs(object.size - first.size) > first.size * 0.01) return false;
  const dir = directionOf(first.matrix);
  const objectDir = directionOf(object.matrix);
  if (dir[0] * objectDir[0] + dir[1] * objectDir[1] < 0.999) return false;
  const x = (object.bounds[0] + object.bounds[2]) / 2;
  const y = (object.bounds[1] + object.bounds[3]) / 2;
  return x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3];
}

function union(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/** The locator rule (spec 21.2): same text, and every edge of the box within 1 point. */
export function matchesLocator(
  run: { text: string; bbox: [number, number, number, number] },
  target: { text: string; bbox: [number, number, number, number] },
): boolean {
  return run.text === target.text && run.bbox.every((v, i) => Math.abs(v - target.bbox[i]) <= 1);
}
