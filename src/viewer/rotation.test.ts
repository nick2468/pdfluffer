import { describe, expect, it } from "vitest";
import { deltaFromTurnedView, ROTATE_BUTTON_SELECTOR, rotateButtonDelta, unturned } from "./rotation";

describe("PDF.js's rotate buttons (spec 22.1)", () => {
  it("maps each button to its quarter turn", () => {
    expect(rotateButtonDelta("pageRotateCw")).toBe(90);
    expect(rotateButtonDelta("pageRotateCcw")).toBe(-90);
  });

  it("ignores every other id", () => {
    for (const id of ["", null, undefined, "pageRotate", "toString", "hasOwnProperty", "secondaryToolbar"]) {
      expect(rotateButtonDelta(id)).toBeNull();
    }
  });

  it("finds both buttons by id", () => {
    expect(ROTATE_BUTTON_SELECTOR).toBe("#pageRotateCw, #pageRotateCcw");
  });
});

describe("the fallback for a view PDF.js turned", () => {
  it.each([
    [90, 90], [270, -90], [-90, -90], [450, 90], [-270, 90],
  ])("turns a view at %i into a page turn of %i", (rotation, delta) => {
    expect(deltaFromTurnedView(rotation)).toBe(delta);
  });

  it.each([0, 180, -180, 360, 45])("turns a view at %i into no page change", (rotation) => {
    expect(deltaFromTurnedView(rotation)).toBeNull();
  });
});

describe("a stored view rotation is not applied", () => {
  it("opens a view stored at 90 unturned, keeping its page and scale", () => {
    expect(unturned({ page: 3, scale: "page-width", rotation: 90 }))
      .toEqual({ page: 3, scale: "page-width", rotation: 0 });
  });

  it("does not change the stored value it was given", () => {
    const stored = { page: 1, scale: "auto", rotation: 270 };
    unturned(stored);
    expect(stored.rotation).toBe(270);
  });
});
