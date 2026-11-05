import { describe, expect, it } from "vitest";
import { EngineError } from "../engine/EngineAdapter";
import type { EditNote, RenderedPage, TextEdit, TextEditEngine, TextRun } from "../engine/textEdit";
import { TextEditHistory, UNDO_LIMIT } from "./textEditHistory";

// Spec 21.5 and chip 15 part 2. The fake engine "applies" an edit list by appending each edit's
// text to the base, so a test can read the replayed list straight out of the bytes.

const enc = new TextEncoder();
const dec = new TextDecoder();
const BASE = enc.encode("base");

class FakeTextEngine implements TextEditEngine {
  readonly calls: { bytes: string; edits: string[] }[] = [];

  async listRuns(): Promise<TextRun[]> {
    return [];
  }

  async renderPage(): Promise<RenderedPage> {
    return { rgba: new Uint8ClampedArray(4), width: 1, height: 1, transform: [1, 0, 0, 1, 0, 0] };
  }

  async applyEdits(bytes: Uint8Array, edits: TextEdit[]): Promise<{ bytes: Uint8Array; notes: EditNote[] }> {
    const texts = edits.map(textOf);
    this.calls.push({ bytes: dec.decode(bytes), edits: texts });
    bytes.fill(0);   // a careless engine: the history must have handed over a copy
    if (texts.includes("refuse")) throw new EngineError("failed", "The page changed under this edit.");
    if (texts.includes("crash")) throw new Error("Out of memory.");
    const notes: EditNote[] = [];
    texts.forEach((text, edit) => {
      if (text.startsWith("Ω")) notes.push({ kind: "font-substituted", font: "Arial", edit });
      if (text.endsWith("…")) notes.push({ kind: "runs-past-end", edit });
    });
    return { bytes: enc.encode(["base", ...texts].join("+")), notes };
  }
}

const textOf = (edit: TextEdit): string => (edit.kind === "delete" ? "delete" : edit.text);
const replace = (text: string): TextEdit => ({ kind: "replace", target: { pageIndex: 0, text: "x", bbox: [0, 0, 1, 1] }, text });

function fresh() {
  const engine = new FakeTextEngine();
  return { engine, history: new TextEditHistory(engine, BASE.slice()) };
}

const texts = (history: TextEditHistory) => history.editList.map(textOf);
const shown = (history: TextEditHistory) => dec.decode(history.current);

describe("TextEditHistory, table-driven", () => {
  type Op = string | "undo" | "redo";
  const table: { name: string; ops: Op[]; edits: string[]; canUndo: boolean; canRedo: boolean; bytes: string }[] = [
    { name: "a new history", ops: [], edits: [], canUndo: false, canRedo: false, bytes: "base" },
    { name: "one edit", ops: ["a"], edits: ["a"], canUndo: true, canRedo: false, bytes: "base+a" },
    { name: "two edits, undo one", ops: ["a", "b", "undo"], edits: ["a"], canUndo: true, canRedo: true, bytes: "base+a" },
    { name: "undo back to the base", ops: ["a", "undo"], edits: [], canUndo: false, canRedo: true, bytes: "base" },
    { name: "undo then redo", ops: ["a", "b", "undo", "redo"], edits: ["a", "b"], canUndo: true, canRedo: false, bytes: "base+a+b" },
    { name: "a new edit clears redo", ops: ["a", "b", "undo", "c"], edits: ["a", "c"], canUndo: true, canRedo: false, bytes: "base+a+c" },
    { name: "undo with nothing to undo does nothing", ops: ["undo"], edits: [], canUndo: false, canRedo: false, bytes: "base" },
    { name: "redo with nothing to redo does nothing", ops: ["a", "redo"], edits: ["a"], canUndo: true, canRedo: false, bytes: "base+a" },
    { name: "a refused edit is not added", ops: ["a", "refuse"], edits: ["a"], canUndo: true, canRedo: false, bytes: "base+a" },
    { name: "a refused edit keeps the redo list", ops: ["a", "b", "undo", "refuse"], edits: ["a"], canUndo: true, canRedo: true, bytes: "base+a" },
  ];
  for (const row of table) {
    it(row.name, async () => {
      const { history } = fresh();
      for (const op of row.ops) {
        if (op === "undo") await history.undo();
        else if (op === "redo") await history.redo();
        else await history.apply(replace(op));
      }
      expect(texts(history)).toEqual(row.edits);
      expect(history.canUndo).toBe(row.canUndo);
      expect(history.canRedo).toBe(row.canRedo);
      expect(shown(history)).toBe(row.bytes);
    });
  }
});

describe("TextEditHistory", () => {
  it("replays the whole list over the base in one applyEdits for every change", async () => {
    const { engine, history } = fresh();
    await history.apply(replace("a"));
    await history.apply(replace("b"));
    await history.undo();
    await history.redo();
    expect(engine.calls).toEqual([
      { bytes: "base", edits: ["a"] },
      { bytes: "base", edits: ["a", "b"] },
      { bytes: "base", edits: ["a"] },
      { bytes: "base", edits: ["a", "b"] },
    ]);
    // The engine zeroed the bytes it was given. The base is untouched.
    expect(dec.decode(history.base)).toBe("base");
  });

  it("returns the bytes and only the newest edit's notes from apply and redo", async () => {
    const { history } = fresh();
    const first = await history.apply(replace("Ω first"));
    expect(first).toEqual({ ok: true, bytes: history.current, notes: [{ kind: "font-substituted", font: "Arial", edit: 0 }] });
    const second = await history.apply(replace("second…"));
    expect(second.ok && second.notes).toEqual([{ kind: "runs-past-end", edit: 1 }]);
    const third = await history.apply(replace("plain"));
    expect(third.ok && third.notes).toEqual([]);
    expect((await history.undo())?.ok).toBe(true);
    const redone = await history.redo();
    expect(redone?.ok && redone.notes).toEqual([]);
  });

  it("shows no notes after an undo", async () => {
    const { history } = fresh();
    await history.apply(replace("Ω first"));
    await history.apply(replace("Ω second"));
    const undone = await history.undo();
    expect(undone?.ok && undone.notes).toEqual([]);
  });

  it("hands back a refused edit's message, and any other failure's too", async () => {
    const { history } = fresh();
    expect(await history.apply(replace("refuse"))).toEqual({ ok: false, message: "The page changed under this edit." });
    expect(await history.apply(replace("crash"))).toEqual({ ok: false, message: "Out of memory." });
    expect(texts(history)).toEqual([]);
    expect(history.current).toBe(history.base);
  });

  it(`undoes at most ${UNDO_LIMIT} steps back from the newest edit, and never shortens the list`, async () => {
    const { history } = fresh();
    for (let i = 1; i <= 25; i++) await history.apply(replace(`e${i}`));
    expect(texts(history)).toHaveLength(25);
    let undone = 0;
    while (history.canUndo) {
      await history.undo();
      undone++;
    }
    expect(undone).toBe(UNDO_LIMIT);
    expect(texts(history)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
    expect(await history.undo()).toBeNull();
    // Redo gives the steps back, one for one.
    await history.redo();
    await history.redo();
    expect(texts(history)).toHaveLength(7);
    await history.undo();
    await history.undo();
    expect(history.canUndo).toBe(false);
  });

  it("counts the limit from the newest edit, so new edits after an exhausted undo can be undone", async () => {
    const { history } = fresh();
    for (let i = 1; i <= 21; i++) await history.apply(replace(`e${i}`));
    while (history.canUndo) await history.undo();
    expect(texts(history)).toHaveLength(1);
    await history.apply(replace("new"));
    expect(history.canUndo).toBe(true);
    await history.undo();
    expect(texts(history)).toEqual(["e1"]);
    expect(history.canUndo).toBe(false);
  });

  it("forks a copy with the same state, opened afresh, that leaves the original alone", async () => {
    const { history } = fresh();
    await history.apply(replace("a"));
    await history.apply(replace("b"));
    await history.undo();
    expect(history.hasNewEdits).toBe(true);

    const copy = history.fork();
    expect(copy.base).toBe(history.base);
    expect(texts(copy)).toEqual(["a"]);
    expect(copy.canUndo).toBe(true);
    expect(copy.canRedo).toBe(true);
    expect(copy.current).toBe(history.current);
    expect(copy.hasNewEdits).toBe(false);

    await copy.undo();
    expect(copy.hasNewEdits).toBe(true);
    await copy.redo();
    expect(copy.hasNewEdits).toBe(false);   // back to the list it opened with
    await copy.apply(replace("c"));
    expect(texts(copy)).toEqual(["a", "c"]);
    expect(texts(history)).toEqual(["a"]);
    expect(history.canRedo).toBe(true);
  });
});
