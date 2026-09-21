import { describe, expect, it } from "vitest";
import type { OcrPageResult, OcrWord } from "./OcrService";
import { apply, invert, placeOcrPage, unskew, type PlacedWord } from "./placement";

// Every transform below is what PDF.js 6.3.289 really gives, not a guess. Taken on
// 2026-09-21 from the vendored build in a headless Edge against the harness:
// getPage(1).getViewport({ scale, rotation }).transform on a 600 by 800 point page, and on
// one whose crop box is [50 100 650 900].
const R0 = [1, 0, 0, -1, 0, 800];            // 600 by 800 pixels
const R90 = [0, 1, 1, 0, 0, 0];               // 800 by 600
const R180 = [-1, 0, 0, 1, 600, 0];           // 600 by 800
const R270 = [0, -1, -1, 0, 800, 600];        // 800 by 600
const CROPPED = [1, 0, 0, -1, -50, 900];      // 600 by 800, crop box starting at 50,100
const SCALE2 = [2, 0, 0, -2, 0, 1600];        // 1200 by 1600

/** A stand-in for Helvetica: every character half the font size wide. */
const measure = (text: string, size: number) => text.length * size * 0.5;
const any = () => true;

function page(words: OcrWord[], width: number, height: number, textAngle: number | null = 0): OcrPageResult {
  return { language: "en-GB", width, height, textAngle, lines: [{ words }] };
}

const word = (text: string, x: number, y: number, w: number, h: number): OcrWord => ({ text, x, y, w, h });

/** Close enough for floating point, where the hand numbers have two decimals. */
function expectClose(actual: number[], expected: number[], digits = 6): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], digits));
}

describe("unskew (decision 16)", () => {
  // Rows from BUILD-NOTES decision 16: where the engine said a word was, and where it
  // really is. Each must land within 6 pixels. This pins the sign of the rule for good.
  const centre = { x: 800, y: 600 };
  const rows: [string, number, [number, number], [number, number]][] = [
    ["skew-cw2 The", 2.0, [144.0, 135.0], [160.7, 112.9]],
    ["skew-cw2 morning", 2.0, [1050.0, 138.0], [1066.1, 144.5]],
    ["skew-cw2 Read", 2.0, [153.5, 1071.0], [137.4, 1048.7]],
    ["skew-cw2 here", 2.0, [1152.0, 1071.5], [1135.4, 1083.5]],
    ["skew-ccw2 The", -2.1, [145.0, 134.0], [128.3, 158.7]],
    ["skew-ccw2 PAGE", -2.1, [1369.5, 448.0], [1363.2, 427.7]],
    ["skew-ccw2 Read", -2.1, [153.0, 1070.0], [170.3, 1093.8]],
    ["skew-ccw2 here", -2.1, [1151.0, 1071.5], [1168.3, 1058.9]],
  ];
  it.each(rows)("%s lands within 6 pixels of where it really is", (_name, angle, reported, truth) => {
    const moved = unskew({ x: reported[0], y: reported[1] }, angle, centre);
    expect(Math.hypot(moved.x - truth[0], moved.y - truth[1])).toBeLessThan(6);
  });

  it("leaves the centre where it is, and does nothing at 0 degrees", () => {
    expect(unskew(centre, 2, centre)).toEqual(centre);
    expect(unskew({ x: 10, y: 20 }, 0, centre)).toEqual({ x: 10, y: 20 });
  });
});

describe("invert", () => {
  it("undoes a transform", () => {
    for (const t of [R0, R90, R180, R270, CROPPED, SCALE2, [1.5, 0.2, -0.3, -1.1, 7, 900]]) {
      const back = apply(invert(t), apply(t, { x: 123, y: 456 }));
      expect(back.x).toBeCloseTo(123, 9);
      expect(back.y).toBeCloseTo(456, 9);
    }
  });

  it("gives the hand-worked inverse of the scale 2 viewport", () => {
    expectClose(invert(SCALE2), [0.5, 0, 0, -0.5, 0, 800]);
  });

  it("refuses a transform that flattens the page to a line", () => {
    expect(() => invert([1, 2, 2, 4, 0, 0])).toThrow();
  });
});

describe("placeOcrPage", () => {
  // One word, "Hello", in a 100 by 40 pixel box at 200,300. Worked by hand:
  // size = 1.1 * 40 = 44. base = 340 - 0.12 * 44 = 334.72.
  const hello = word("Hello", 200, 300, 100, 40);

  it("puts a word on an upright page at the right point, size and scale", () => {
    const [placed] = placeOcrPage(page([hello], 1200, 1600), SCALE2, measure, any);
    // Through the inverse [0.5 0 0 -0.5 0 800]: P0 = (200, 334.72) -> (100, 632.64).
    expect(placed.text).toBe("Hello");
    expectClose(placed.matrix, [1, 0, 0, 1, 100, 632.64]);
    expect(placed.fontSize).toBeCloseTo(22, 9);                 // 44 pixels at 2 pixels a point
    expect(placed.scalePercent).toBeCloseTo((100 * 50) / 55, 9); // 50 points over 5 * 22 * 0.5
  });

  // The page geometry is PDF.js's, so each rotation is checked two ways: one hand-worked
  // origin, and a round trip back through the viewport, which must give back the word's
  // own baseline running left to right across the picture.
  const rotations: [string, number[], number, number, number[]][] = [
    ["0", R0, 600, 800, [1, 0, 0, 1, 100, 582.64]],
    ["90", R90, 800, 600, [0, 1, -1, 0, 217.36, 100]],
    ["180", R180, 600, 800, [-1, 0, 0, -1, 500, 217.36]],
    ["270", R270, 800, 600, [0, -1, 1, 0, 382.64, 700]],
  ];
  it.each(rotations)("places a word on a page turned %s degrees", (_r, transform, width, height, expected) => {
    // A 50 by 20 pixel word at 100,200: size 22, base 220 - 2.64 = 217.36.
    const [placed] = placeOcrPage(page([word("Page", 100, 200, 50, 20)], width, height), transform, measure, any);
    expectClose(placed.matrix, expected);
    expect(placed.fontSize).toBeCloseTo(22, 9);
    expectRoundTrip(placed, transform, { x: 100, y: 217.36 }, 50, 22);
  });

  it("allows for a crop box that does not start at 0,0", () => {
    const [placed] = placeOcrPage(page([word("Page", 100, 200, 50, 20)], 600, 800), CROPPED, measure, any);
    // Inverse [1 0 0 -1 50 900]: (100, 217.36) -> (150, 682.64). The 50 is the crop box's.
    expectClose(placed.matrix, [1, 0, 0, 1, 150, 682.64]);
    expectRoundTrip(placed, CROPPED, { x: 100, y: 217.36 }, 50, 22);
  });

  it("keeps a line's words on one baseline, whatever their own heights", () => {
    // Heights 30 and 40, bottoms 330 and 340. size = 1.1 * 35 = 38.5.
    // base = 335 - 0.12 * 38.5 = 330.38, so both sit at 800 - 330.38 = 469.62.
    const words = [word("short", 100, 300, 60, 30), word("Tall", 200, 300, 60, 40)];
    const placed = placeOcrPage(page(words, 600, 800), R0, measure, any);
    expect(placed).toHaveLength(2);
    expect(placed[0].matrix[5]).toBeCloseTo(469.62, 9);
    expect(placed[1].matrix[5]).toBeCloseTo(469.62, 9);
    expect(placed[0].fontSize).toBeCloseTo(38.5, 9);
    expect(placed[1].fontSize).toBeCloseTo(38.5, 9);
  });

  it("turns a word on a skewed page the way the page is turned", () => {
    // The engine reports +2: the page's text runs 2 degrees clockwise, downhill to the right.
    const [placed] = placeOcrPage(page([hello], 1200, 1600, 2), SCALE2, measure, any);
    const radians = (2 * Math.PI) / 180;
    // Downhill in the picture is downhill on the page, which in PDF's y-up space is -y.
    expect(placed.matrix[0]).toBeCloseTo(Math.cos(radians), 9);
    expect(placed.matrix[1]).toBeCloseTo(-Math.sin(radians), 9);
    expect(placed.fontSize).toBeCloseTo(22, 9);
  });

  it("treats a null angle as no angle", () => {
    const upright = placeOcrPage(page([hello], 1200, 1600, 0), SCALE2, measure, any);
    expect(placeOcrPage(page([hello], 1200, 1600, null), SCALE2, measure, any)).toEqual(upright);
  });

  it("drops a character the font cannot hold, and skips a word left empty", () => {
    const words = [word("Héllo", 100, 300, 60, 30), word("日本", 200, 300, 60, 30), word("ok", 300, 300, 30, 30)];
    const latin = (ch: string) => ch.charCodeAt(0) < 0x80;
    const placed = placeOcrPage(page(words, 600, 800), R0, measure, latin);
    expect(placed.map((p) => p.text)).toEqual(["Hllo", "ok"]);
  });

  it("skips a word with no width, or no height to size the text from", () => {
    const words = [
      word("flat", 100, 300, 0, 30),
      word("nan", 200, 300, Number.NaN, 30),
      word("fine", 300, 300, 40, 30),
    ];
    expect(placeOcrPage(page(words, 600, 800), R0, measure, any).map((p) => p.text)).toEqual(["fine"]);
    expect(placeOcrPage(page([word("thin", 100, 300, 40, 0)], 600, 800), R0, measure, any)).toEqual([]);
  });

  it("skips a word the font measures as nothing, rather than divide by zero", () => {
    const zero = () => 0;
    expect(placeOcrPage(page([hello], 1200, 1600), SCALE2, zero, any)).toEqual([]);
  });

  it("gives nothing for a page with no lines", () => {
    expect(placeOcrPage({ language: "en-GB", width: 10, height: 10, textAngle: 0, lines: [] }, R0, measure, any)).toEqual([]);
  });
});

/**
 * Sends the placed word's text origin, its baseline end and its top-left back through the
 * viewport. They must come back as the word's baseline in the picture, running left to right,
 * with the top one text height above it.
 */
function expectRoundTrip(placed: PlacedWord, transform: number[], p0: { x: number; y: number }, width: number, size: number): void {
  const [a, b, c, d, e, f] = placed.matrix;
  const origin = apply(transform, { x: e, y: f });
  const end = apply(transform, { x: e + a * width, y: f + b * width });
  const top = apply(transform, { x: e + c * size, y: f + d * size });
  expect(origin.x).toBeCloseTo(p0.x, 9);
  expect(origin.y).toBeCloseTo(p0.y, 9);
  expect(end.x).toBeCloseTo(p0.x + width, 9);
  expect(end.y).toBeCloseTo(p0.y, 9);
  expect(top.x).toBeCloseTo(p0.x, 9);
  expect(top.y).toBeCloseTo(p0.y - size, 9);
}
