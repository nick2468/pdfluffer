import { describe, expect, it } from "vitest";
import type { TextRun } from "../engine/textEdit";
import {
  applyTransform, boxOnScreen, fitInside, invertTransform, locatorOf, nearestEditableRun, pagePoint,
  sameRun, screenFontSize,
} from "./textEditorGeometry";

// A US Letter page, 612 x 792 points, drawn 1224 x 1584 pixels: 2 pixels a point, y flipped.
const UPRIGHT = [2, 0, 0, -2, 0, 1584];
// The same page turned a quarter clockwise by /Rotate 90: 1584 x 1224 pixels.
const TURNED = [0, 2, 2, 0, 0, 0];

const textRun = (text: string, bbox: [number, number, number, number], editable = true): TextRun => ({
  id: text, pageIndex: 0, text, bbox, fontName: "Helvetica", fontSize: 12, colour: [0, 0, 0], editable,
});

describe("textEditorGeometry", () => {
  it("maps a run's box to CSS pixels over the picture", () => {
    expect(boxOnScreen([72, 700, 172, 712], UPRIGHT, 0.5)).toEqual({ left: 72, top: 80, width: 100, height: 12 });
  });

  it("gives the box around a run on a turned page", () => {
    const box = boxOnScreen([72, 700, 172, 712], TURNED, 1);
    expect(box).toEqual({ left: 1400, top: 144, width: 24, height: 200 });
  });

  it("maps a click back to the page point it came from, upright and turned", () => {
    for (const m of [UPRIGHT, TURNED]) {
      for (const scale of [0.25, 1, 1.5]) {
        const [px, py] = applyTransform(m, 100, 650);
        const [x, y] = pagePoint(px * scale, py * scale, m, scale);
        expect(x).toBeCloseTo(100, 9);
        expect(y).toBeCloseTo(650, 9);
      }
    }
  });

  it("inverts a transform", () => {
    const inverse = invertTransform([1.5, 0.5, -0.25, 2, 30, -40]);
    const [x, y] = applyTransform(inverse, ...applyTransform([1.5, 0.5, -0.25, 2, 30, -40], 7, 11));
    expect(x).toBeCloseTo(7, 9);
    expect(y).toBeCloseTo(11, 9);
    expect(() => invertTransform([1, 2, 2, 4, 0, 0])).toThrow();
  });

  it("fits the whole picture into the area, by its tighter side", () => {
    expect(fitInside(1224, 1584, 800, 600)).toEqual({ width: 1224 * (600 / 1584), height: 600, scale: 600 / 1584 });
    expect(fitInside(1000, 500, 500, 600)).toEqual({ width: 500, height: 250, scale: 0.5 });
  });

  it("gives a font size on screen from points, the drawing scale and the CSS scale", () => {
    expect(screenFontSize(12, UPRIGHT, 0.5)).toBeCloseTo(12, 9);
    expect(screenFontSize(12, TURNED, 1)).toBeCloseTo(24, 9);
  });

  it("finds the nearest editable run, measured to its box, and skips runs that cannot be edited", () => {
    const runs = [
      textRun("top", [50, 700, 200, 712]),
      textRun("hidden", [50, 640, 200, 652], false),
      textRun("bottom", [50, 600, 200, 612]),
    ];
    expect(nearestEditableRun(runs, 100, 705)?.text).toBe("top");      // inside
    expect(nearestEditableRun(runs, 300, 690)?.text).toBe("top");
    expect(nearestEditableRun(runs, 100, 645)?.text).toBe("bottom");   // the hidden run is closer
    expect(nearestEditableRun([runs[1]], 0, 0)).toBeNull();
    expect(nearestEditableRun([], 0, 0)).toBeNull();
  });

  it("names a run by locator, and matches it within 1 point as the replay does", () => {
    const a = locatorOf(textRun("Page 1", [10, 20, 30, 40]));
    expect(a).toEqual({ pageIndex: 0, text: "Page 1", bbox: [10, 20, 30, 40] });
    expect(sameRun(a, { ...a, bbox: [10.9, 19.1, 30, 40] })).toBe(true);
    expect(sameRun(a, { ...a, bbox: [11.5, 20, 30, 40] })).toBe(false);
    expect(sameRun(a, { ...a, text: "Page 2" })).toBe(false);
    expect(sameRun(a, { ...a, pageIndex: 1 })).toBe(false);
  });
});
