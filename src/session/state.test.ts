import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFileAdapter } from "../files/fakeFileAdapter";
import {
  createDebouncedSaver, parseHistory, parseSession, parseSettings, recentItems, setHistoryView,
  touchHistory, viewFor, type HistoryItem, type HistoryStateV1, type SessionStateV1, type SettingsV1,
} from "./state";

const sameFile = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const validSession: SessionStateV1 = {
  version: 1,
  tabs: [
    { id: "t1", ref: "C:\\a.pdf", name: "a.pdf", saveConfirmed: false },
    { id: "t2", ref: "C:\\b.pdf", name: "b.pdf", saveConfirmed: true },
  ],
  activeTabId: "t2",
};

const validHistory: HistoryStateV1 = {
  version: 1,
  items: [
    { ref: "C:\\a.pdf", name: "a.pdf", lastOpened: "2026-09-19T01:00:00.000Z", view: { page: 3, scale: "page-width", rotation: 90 } },
    { ref: "C:\\b.pdf", name: "b.pdf", lastOpened: "2026-09-18T01:00:00.000Z", view: null },
  ],
};

const validSettings: SettingsV1 = { version: 1, restoreSession: false, keepBackup: true };

const parsers = [
  { name: "parseSession", parse: parseSession, valid: validSession, fallback: { version: 1, tabs: [], activeTabId: null } },
  { name: "parseHistory", parse: parseHistory, valid: validHistory, fallback: { version: 1, items: [] } },
  { name: "parseSettings", parse: parseSettings, valid: validSettings, fallback: { version: 1, restoreSession: true, keepBackup: false } },
] as const;

describe.each(parsers)("$name", ({ parse, valid, fallback }) => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); });

  it("round-trips a valid value through the fake adapter", async () => {
    const files = new FakeFileAdapter();
    await files.saveState("key", valid);
    expect(parse(await files.loadState("key"))).toEqual(valid);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([null, undefined])("gives the default without a warning for %s", (value) => {
    expect(parse(value)).toEqual(fallback);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["a string", "garbage"],
    ["a number", 42],
    ["an array", [1, 2]],
    ["version 2", { ...valid, version: 2 }],
    ["no version", { ...valid, version: undefined }],
  ])("gives the default and warns once for %s", (_label, value) => {
    expect(parse(value)).toEqual(fallback);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("drops fields that are not in the schema", () => {
    expect(parse({ ...valid, extra: "x" })).toEqual(valid);
  });
});

describe("wrongly shaped fields give the default and one warning", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); });

  it.each([
    ["tabs not an array", { ...validSession, tabs: "x" }],
    ["a tab without saveConfirmed", { ...validSession, tabs: [{ id: "t1", ref: "r", name: "n" }] }],
    ["activeTabId a number", { ...validSession, activeTabId: 3 }],
  ])("session: %s", (_label, value) => {
    expect(parseSession(value)).toEqual({ version: 1, tabs: [], activeTabId: null });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["items missing", { version: 1 }],
    ["an item without lastOpened", { version: 1, items: [{ ref: "r", name: "n", view: null }] }],
    ["a view with a numeric scale", { version: 1, items: [{ ...validHistory.items[0], view: { page: 1, scale: 1.5, rotation: 0 } }] }],
  ])("history: %s", (_label, value) => {
    expect(parseHistory(value)).toEqual({ version: 1, items: [] });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["keepBackup a string", { ...validSettings, keepBackup: "yes" }],
    ["restoreSession missing", { version: 1, keepBackup: true }],
  ])("settings: %s", (_label, value) => {
    expect(parseSettings(value)).toEqual({ version: 1, restoreSession: true, keepBackup: false });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

function item(n: number, view: HistoryItem["view"] = null): HistoryItem {
  return { ref: `C:\\f${n}.pdf`, name: `f${n}.pdf`, lastOpened: `2026-01-01T00:00:${String(n % 60).padStart(2, "0")}.000Z`, view };
}

describe("history helpers", () => {
  const view = { page: 4, scale: "1.25", rotation: 180 };

  it("inserts a new file at the front", () => {
    const items = [item(1), item(2)];
    const next = touchHistory(items, "C:\\new.pdf", "new.pdf", "NOW", sameFile);
    expect(next.map((i) => i.name)).toEqual(["new.pdf", "f1.pdf", "f2.pdf"]);
    expect(next[0]).toEqual({ ref: "C:\\new.pdf", name: "new.pdf", lastOpened: "NOW", view: null });
    expect(items).toHaveLength(2);
  });

  it("moves an existing file to the front, keeps its view and sets lastOpened", () => {
    const items = [item(1), item(2), item(3, view)];
    const next = touchHistory(items, "c:\\F3.PDF", "f3.pdf", "NOW", sameFile);
    expect(next.map((i) => i.name)).toEqual(["f3.pdf", "f1.pdf", "f2.pdf"]);
    expect(next[0].view).toEqual(view);
    expect(next[0].lastOpened).toBe("NOW");
    expect(items[2].lastOpened).not.toBe("NOW");
  });

  it("caps the history at 100 items, dropping the oldest", () => {
    const items = Array.from({ length: 100 }, (_, i) => item(i));
    const next = touchHistory(items, "C:\\new.pdf", "new.pdf", "NOW", sameFile);
    expect(next).toHaveLength(100);
    expect(next[0].name).toBe("new.pdf");
    expect(next[99].name).toBe("f98.pdf");
  });

  it("sets and reads a view by file, ignoring case", () => {
    const items = [item(1), item(2)];
    const next = setHistoryView(items, "C:\\F2.pdf", view, sameFile);
    expect(viewFor(next, "c:\\f2.PDF", sameFile)).toEqual(view);
    expect(viewFor(next, "C:\\f1.pdf", sameFile)).toBeNull();
    expect(viewFor(next, "C:\\missing.pdf", sameFile)).toBeNull();
    expect(items[1].view).toBeNull();
  });

  it("leaves the history unchanged when setting the view of an unknown file", () => {
    const items = [item(1)];
    const next = setHistoryView(items, "C:\\missing.pdf", view, sameFile);
    expect(next).toEqual(items);
    expect(next).not.toBe(items);
  });

  it("shows the first 15 items as recent", () => {
    const items = Array.from({ length: 20 }, (_, i) => item(i));
    expect(recentItems(items).map((i) => i.name)).toEqual(items.slice(0, 15).map((i) => i.name));
    expect(recentItems([item(1)])).toHaveLength(1);
  });
});

describe("createDebouncedSaver", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function spyFiles() {
    const files = new FakeFileAdapter();
    const save = vi.spyOn(files, "saveState");
    return { files, save };
  }

  it("writes once, with the latest value, 500 ms after the last set", async () => {
    const { files, save } = spyFiles();
    const saver = createDebouncedSaver<number>(files, "history");
    saver.set(1);
    await vi.advanceTimersByTimeAsync(300);
    saver.set(2);
    await vi.advanceTimersByTimeAsync(300);
    saver.set(3);
    await vi.advanceTimersByTimeAsync(499);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(await files.loadState("history")).toBe(3);
  });

  it("flush writes at once and cancels the timer", async () => {
    const { files, save } = spyFiles();
    const saver = createDebouncedSaver<string>(files, "session");
    saver.set("a");
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(await files.loadState("session")).toBe("a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush with nothing pending writes nothing", async () => {
    const { files, save } = spyFiles();
    const saver = createDebouncedSaver<string>(files, "session");
    await saver.flush();
    saver.set("a");
    await vi.advanceTimersByTimeAsync(500);
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("uses a custom delay", async () => {
    const { files, save } = spyFiles();
    const saver = createDebouncedSaver<string>(files, "session", 50);
    saver.set("a");
    await vi.advanceTimersByTimeAsync(50);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
