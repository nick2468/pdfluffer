import { describe, expect, it } from "vitest";
import { dropIndex, isDrag, shiftFor, type TabEdges } from "./tabDrop";

// Four tabs 100 wide with a 2 gap: centres at 50, 152, 254, 356.
const edges: TabEdges[] = [
  { left: 0, right: 100 }, { left: 102, right: 202 }, { left: 204, right: 304 }, { left: 306, right: 406 },
];

describe("dropIndex (spec 22.2)", () => {
  it.each([
    // [what, dragged centre x, from, expected]
    ["first place", 40, 2, 0],
    ["last place", 380, 0, 3],
    ["its own place, untouched", 152, 1, 1],
    ["its own place, nudged left", 120, 1, 1],
    ["its own place, nudged right", 180, 1, 1],
    ["past the left end", -500, 3, 0],
    ["past the right end", 5000, 0, 3],
    ["just past a neighbour's centre to the right", 153, 0, 1],
    ["just short of a neighbour's centre to the right", 151, 0, 0],
    ["just past a neighbour's centre to the left", 253, 3, 2],
    ["one place left", 140, 2, 1],
    ["the first tab past the third", 300, 0, 2],
  ])("%s", (_what, x, from, expected) => {
    expect(dropIndex(x, edges, from)).toBe(expected);
  });

  it("gives 0 for a single tab, wherever it goes", () => {
    expect(dropIndex(-50, [edges[0]], 0)).toBe(0);
    expect(dropIndex(900, [edges[0]], 0)).toBe(0);
  });
});

describe("shiftFor", () => {
  const step = 102;

  it("moves the tabs between left as the dragged tab goes right", () => {
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 0, 2, step))).toEqual([0, -step, -step, 0]);
  });

  it("moves the tabs between right as the dragged tab goes left", () => {
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 3, 1, step))).toEqual([0, step, step, 0]);
  });

  it("moves nothing while the dragged tab is over its own place", () => {
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 2, 2, step))).toEqual([0, 0, 0, 0]);
  });
});

describe("isDrag", () => {
  it("is a click below 5 pixels and a drag from 5", () => {
    expect(isDrag(10, 10, 14, 10)).toBe(false);
    expect(isDrag(10, 10, 13, 13)).toBe(false);   // 4.24 pixels
    expect(isDrag(10, 10, 15, 10)).toBe(true);
    expect(isDrag(10, 10, 10, 5)).toBe(true);
  });
});
