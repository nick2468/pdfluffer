import { describe, expect, it } from "vitest";
import { isReloadKey, shortcutFor, type KeyChord } from "./shortcutFor";

function chord(key: string, mods: Partial<Omit<KeyChord, "key">> = {}): KeyChord {
  return { key, ctrlKey: false, shiftKey: false, altKey: false, ...mods };
}

const ctrl = { ctrlKey: true };
const ctrlShift = { ctrlKey: true, shiftKey: true };

describe("shortcutFor (spec 11.6)", () => {
  it("maps each shortcut in the table", () => {
    expect(shortcutFor(chord("o", ctrl))).toBe("open");
    expect(shortcutFor(chord("s", ctrl))).toBe("save");
    expect(shortcutFor(chord("S", ctrlShift))).toBe("saveAs");
    expect(shortcutFor(chord("w", ctrl))).toBe("closeTab");
    expect(shortcutFor(chord("Tab", ctrl))).toBe("nextTab");
    expect(shortcutFor(chord("Tab", ctrlShift))).toBe("prevTab");
  });

  it("matches key case-insensitively", () => {
    expect(shortcutFor(chord("O", ctrl))).toBe("open");
    expect(shortcutFor(chord("W", ctrl))).toBe("closeTab");
    expect(shortcutFor(chord("s", ctrlShift))).toBe("saveAs");
    expect(shortcutFor(chord("TAB", ctrl))).toBe("nextTab");
  });

  it("gives no shortcut while Alt is held", () => {
    for (const key of ["o", "s", "w", "Tab"]) {
      expect(shortcutFor(chord(key, { ctrlKey: true, altKey: true }))).toBeNull();
      expect(shortcutFor(chord(key, { ctrlKey: true, shiftKey: true, altKey: true }))).toBeNull();
    }
  });

  it("gives no shortcut without Ctrl", () => {
    for (const key of ["o", "s", "w", "Tab"]) {
      expect(shortcutFor(chord(key))).toBeNull();
      expect(shortcutFor(chord(key, { shiftKey: true }))).toBeNull();
    }
  });

  it("leaves Ctrl+Shift+O and Ctrl+Shift+W alone", () => {
    expect(shortcutFor(chord("O", ctrlShift))).toBeNull();
    expect(shortcutFor(chord("W", ctrlShift))).toBeNull();
  });

  it("leaves the keys PDF.js owns alone", () => {
    for (const key of ["p", "f", "z", "c", "v", "a", "g", "+", "-", "0", "r"]) {
      expect(shortcutFor(chord(key, ctrl))).toBeNull();
    }
    expect(shortcutFor(chord("F5"))).toBeNull();
    expect(shortcutFor(chord("Escape"))).toBeNull();
  });
});

describe("isReloadKey", () => {
  it("is true for F5, Ctrl+R and Ctrl+Shift+R", () => {
    expect(isReloadKey(chord("F5"))).toBe(true);
    expect(isReloadKey(chord("r", ctrl))).toBe(true);
    expect(isReloadKey(chord("R", ctrlShift))).toBe(true);
    expect(isReloadKey(chord("F5", ctrl))).toBe(true);
    expect(isReloadKey(chord("F5", { shiftKey: true }))).toBe(true);
  });

  it("is false for other keys and for Alt", () => {
    expect(isReloadKey(chord("r"))).toBe(false);
    expect(isReloadKey(chord("R", { shiftKey: true }))).toBe(false);
    expect(isReloadKey(chord("r", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isReloadKey(chord("F5", { altKey: true }))).toBe(false);
    expect(isReloadKey(chord("s", ctrl))).toBe(false);
  });
});
