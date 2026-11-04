import { describe, expect, it } from "vitest";
import { groupRuns, matchesLocator, type TextObjectInfo } from "./runGrouping";

// The grouping rule of spec 21, with plain numbers. Each object is 6 points per character
// wide at size 12, drawn left to right unless a test turns it.

function obj(text: string, x: number, y: number, extra: Partial<TextObjectInfo> = {}): TextObjectInfo {
  const width = text.length * 6;
  return {
    text, fontKey: 1, size: 12, colour: [0, 0, 0], renderMode: 0,
    matrix: [1, 0, 0, 1, x, y],
    quad: [x, y, x + width, y, x + width, y + 9, x, y + 9],
    bounds: [x, y, x + width, y + 9],
    ...extra,
  };
}

const texts = (objects: TextObjectInfo[]) => groupRuns(objects).map((r) => r.text);

describe("groupRuns", () => {
  it("joins objects on one baseline with small gaps, adding a space where a gap reads as one", () => {
    // "Hello" ends at 80; "world" starts 4 points on: a word space. "s" touches it.
    expect(texts([obj("Hello", 50, 700), obj("world", 84, 700), obj("s", 114, 700)])).toEqual(["Hello worlds"]);
  });

  it("does not add a second space when one side already has it", () => {
    expect(texts([obj("Hello ", 50, 700), obj("world", 90, 700)])).toEqual(["Hello world"]);
  });

  it("splits at a gap wider than 1.5 times the font size", () => {
    expect(texts([obj("Left", 50, 700), obj("Right", 74 + 18.5, 700)])).toEqual(["Left", "Right"]);
    expect(texts([obj("Left", 50, 700), obj("Right", 74 + 17.5, 700)])).toEqual(["Left Right"]);
  });

  it("allows the baseline to wander by up to 0.3 times the font size", () => {
    expect(texts([obj("a", 50, 700), obj("b", 57, 703.5)])).toEqual(["ab"]);
    expect(texts([obj("a", 50, 700), obj("b", 57, 704)])).toEqual(["a", "b"]);
  });

  it("splits on a change of font, size or colour", () => {
    expect(texts([obj("Plain ", 50, 700), obj("bold", 86, 700, { fontKey: 2 })])).toEqual(["Plain ", "bold"]);
    expect(texts([obj("Big", 50, 700), obj("small", 68, 700, { size: 10 })])).toEqual(["Big", "small"]);
    expect(texts([obj("Black", 50, 700), obj("red", 80, 700, { colour: [255, 0, 0] })])).toEqual(["Black", "red"]);
  });

  it("splits a line whose middle the page draws in another font into three runs", () => {
    const line = [obj("Start ", 50, 700), obj("mid", 86, 700, { fontKey: 2 }), obj(" end", 104, 700)];
    expect(texts(line)).toEqual(["Start ", "mid", " end"]);
  });

  it("only joins consecutive objects, in the order the page draws them", () => {
    // The second line is drawn between the two halves of the first.
    expect(texts([obj("one", 50, 700), obj("other", 50, 650), obj("two", 72, 700)])).toEqual(["one", "other", "two"]);
  });

  it("follows a turned baseline", () => {
    // Turned 90 degrees: the text runs up the page from (300, 100).
    const up = (text: string, y: number): TextObjectInfo => {
      const h = text.length * 6;
      return obj(text, 300, y, {
        matrix: [0, 1, -1, 0, 300, y],
        quad: [300, y, 300, y + h, 291, y + h, 291, y],
        bounds: [291, y, 300, y + h],
      });
    };
    const runs = groupRuns([up("Turned", 100), up("text", 140)]);
    expect(runs.map((r) => r.text)).toEqual(["Turned text"]);
    expect(runs[0].bbox).toEqual([291, 100, 300, 164]);
    expect(runs[0].end).toBe(164);
  });

  it("never joins objects that run in different directions", () => {
    const turned = obj("up", 74, 700, { matrix: [0, 1, -1, 0, 74, 700] });
    expect(texts([obj("flat", 50, 700), turned])).toEqual(["flat", "up"]);
  });

  it("keeps a not-editable object out of an editable run", () => {
    expect(texts([obj("seen", 50, 700), obj("hidden", 74, 700, { notEditable: "invisible" })])).toEqual(["seen", "hidden"]);
  });

  it("drops empty objects and runs of only white space", () => {
    expect(texts([obj("", 50, 700), obj("  ", 50, 650), obj("x", 50, 600)])).toEqual(["x"]);
  });

  it("adds an empty object lying over an earlier run to that run, without text", () => {
    // PDFium reads a copy drawn over text it already holds as empty (the fake-bold trick).
    const runs = groupRuns([obj("Bold", 50, 700), obj("Other", 50, 650), obj("", 50.5, 700, { fontKey: 2, bounds: [50.5, 700, 74.5, 709] })]);
    expect(runs.map((r) => [r.text, r.members])).toEqual([["Bold", [0, 2]], ["Other", [1]]]);
    expect(runs[0].bbox).toEqual([50, 700, 74.5, 709]);
  });

  it("leaves an empty object alone when it lies over no run, or differs in size or direction", () => {
    const shadow = (extra: Partial<TextObjectInfo>) => obj("", 50, 700, { bounds: [50, 700, 74, 709], ...extra });
    expect(groupRuns([obj("Text", 50, 700), shadow({ bounds: [200, 700, 224, 709] })])[0].members).toEqual([0]);
    expect(groupRuns([obj("Text", 50, 700), shadow({ size: 14 })])[0].members).toEqual([0]);
    expect(groupRuns([obj("Text", 50, 700), shadow({ matrix: [0, 1, -1, 0, 50, 700] })])[0].members).toEqual([0]);
  });

  it("names its members by their place in the input", () => {
    const runs = groupRuns([obj("a", 50, 700), obj("", 0, 0), obj("b", 57, 700), obj("c", 50, 600)]);
    expect(runs.map((r) => r.members)).toEqual([[0, 2], [3]]);
  });
});

describe("matchesLocator", () => {
  const run = { text: "Total", bbox: [10, 20, 60, 30] as [number, number, number, number] };

  it("matches the same text with every edge within 1 point", () => {
    expect(matchesLocator(run, { text: "Total", bbox: [11, 19, 61, 29] })).toBe(true);
  });

  it("refuses other text, or any edge more than 1 point out", () => {
    expect(matchesLocator(run, { text: "total", bbox: [10, 20, 60, 30] })).toBe(false);
    expect(matchesLocator(run, { text: "Total", bbox: [10, 20, 61.5, 30] })).toBe(false);
  });
});
