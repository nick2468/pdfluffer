import { describe, expect, it } from "vitest";
import { placementFor } from "./placement";

const IDENTITY = [1, 0, 0, 1, 0, 0];

/** Where the drawing puts a point of the appearance stream, given a placement. */
function draw(place: { sx: number; sy: number; tx: number; ty: number }, x: number, y: number) {
  return [place.sx * x + place.tx, place.sy * y + place.ty];
}

describe("placementFor", () => {
  it("moves and scales a box with the identity matrix into the rectangle", () => {
    const place = placementFor([0, 0, 10, 20], IDENTITY, [100, 200, 120, 240]);
    expect(place).toEqual({ sx: 2, sy: 2, tx: 100, ty: 200 });
  });

  it("takes a box that does not start at the origin", () => {
    const place = placementFor([5, 5, 15, 15], IDENTITY, [0, 0, 10, 10]);
    expect(place).toEqual({ sx: 1, sy: 1, tx: -5, ty: -5 });
    expect(draw(place!, 5, 5)).toEqual([0, 0]);
    expect(draw(place!, 15, 15)).toEqual([10, 10]);
  });

  it("normalises a rectangle whose corners are swapped", () => {
    const straight = placementFor([0, 0, 10, 20], IDENTITY, [100, 200, 120, 240]);
    for (const rect of [[120, 240, 100, 200], [120, 200, 100, 240], [100, 240, 120, 200]]) {
      expect(placementFor([0, 0, 10, 20], IDENTITY, rect)).toEqual(straight);
    }
  });

  it("measures the box after a 90 degree matrix, which swaps its sides", () => {
    // The matrix turns the 10 by 20 box into a 20 by 10 one, so the scales swap too.
    const place = placementFor([0, 0, 10, 20], [0, 1, -1, 0, 0, 0], [0, 0, 40, 40]);
    expect(place).toEqual({ sx: 2, sy: 4, tx: 40, ty: 0 });
    // The four transformed corners land exactly on the rectangle's corners.
    expect(draw(place!, -20, 0)).toEqual([0, 0]);
    expect(draw(place!, 0, 10)).toEqual([40, 40]);
  });

  it("takes the offset in a matrix into account", () => {
    const place = placementFor([0, 0, 10, 10], [1, 0, 0, 1, 7, -3], [0, 0, 10, 10]);
    expect(place).toEqual({ sx: 1, sy: 1, tx: -7, ty: 3 });
  });

  it("gives null for a box with no width or no height", () => {
    expect(placementFor([5, 0, 5, 20], IDENTITY, [0, 0, 10, 10])).toBeNull();
    expect(placementFor([0, 5, 10, 5], IDENTITY, [0, 0, 10, 10])).toBeNull();
    expect(placementFor([0, 0, 0, 0], IDENTITY, [0, 0, 10, 10])).toBeNull();
  });

  it("gives null for a matrix that flattens the box onto a line", () => {
    expect(placementFor([0, 0, 10, 20], [0, 0, 0, 1, 0, 0], IDENTITY.slice(0, 4))).toBeNull();
  });

  it("gives null for the wrong number of values, or a value that is not a number", () => {
    expect(placementFor([0, 0, 10], IDENTITY, [0, 0, 10, 10])).toBeNull();
    expect(placementFor([0, 0, 10, 20], [1, 0, 0, 1, 0], [0, 0, 10, 10])).toBeNull();
    expect(placementFor([0, 0, 10, 20], IDENTITY, [0, 0, 10])).toBeNull();
    expect(placementFor([0, 0, 10, Number.NaN], IDENTITY, [0, 0, 10, 10])).toBeNull();
    expect(placementFor([0, 0, 10, 20], IDENTITY, [0, 0, 10, Number.POSITIVE_INFINITY])).toBeNull();
  });

  it("allows a zero-sized rectangle, which simply draws nothing", () => {
    expect(placementFor([0, 0, 10, 20], IDENTITY, [50, 60, 50, 60])).toEqual({
      sx: 0, sy: 0, tx: 50, ty: 60,
    });
  });
});
