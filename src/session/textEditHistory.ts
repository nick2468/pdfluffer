// The text editor's undo history (spec 21.1 E5 and E7, 21.5). Plain TypeScript, no React.
//
// Edits are an ordered list replayed over the base bytes: every change replays the whole list
// in one `applyEdits`, so the bytes on screen are always exactly what Done will produce. Undo
// moves the newest edit onto the redo list and replays; redo moves it back.
//
// Undo reaches at most 20 steps back from the newest edit. The list itself is never cut short
// to stay under 20: replaying a shortened list over a re-saved base would embed a substitute
// font a second time (spec 21.5, refined 2026-11-05). So the history counts how many steps
// undo may still take instead.

import { EngineError } from "../engine/EngineAdapter";
import type { EditNote, TextEdit, TextEditEngine } from "../engine/textEdit";

/** Spec 21.1 E5. */
export const UNDO_LIMIT = 20;

/** What one change gives the editor: the new bytes and the notes of the newest edit. */
export type HistoryStep =
  | { ok: true; bytes: Uint8Array; notes: EditNote[] }
  | { ok: false; message: string };

interface State {
  edits: TextEdit[];
  redo: TextEdit[];
  undoLeft: number;
  bytes: Uint8Array;
}

export class TextEditHistory {
  private edits: TextEdit[] = [];
  private redoList: TextEdit[] = [];
  private undoLeft = 0;
  private bytes: Uint8Array;
  /** The edit list when this copy was opened, so the editor can tell whether anything changed. */
  private opened: TextEdit[] = [];

  /** `base` is the tab's bytes when the history began. It is never changed. */
  constructor(readonly engine: TextEditEngine, readonly base: Uint8Array) {
    this.bytes = base;
  }

  /** The bytes the edit list gives: the base when there are no edits. */
  get current(): Uint8Array {
    return this.bytes;
  }

  /** The edit list, oldest first. A copy. */
  get editList(): TextEdit[] {
    return [...this.edits];
  }

  get canUndo(): boolean {
    return this.undoLeft > 0 && this.edits.length > 0;
  }

  get canRedo(): boolean {
    return this.redoList.length > 0;
  }

  /** True when the edit list differs from the one this copy was opened with. */
  get hasNewEdits(): boolean {
    return this.edits.length !== this.opened.length || this.edits.some((edit, i) => edit !== this.opened[i]);
  }

  /** Appends one edit and replays. A refused edit is not appended, and its message comes back. */
  async apply(edit: TextEdit): Promise<HistoryStep> {
    const edits = [...this.edits, edit];
    const step = await this.replay(edits);
    if (!step.ok) return step;
    this.edits = edits;
    this.redoList = [];
    this.undoLeft = Math.min(UNDO_LIMIT, this.undoLeft + 1);
    return this.newestNotes(step);
  }

  /** Moves the newest edit onto the redo list and replays. Null when undo cannot act. */
  async undo(): Promise<HistoryStep | null> {
    if (!this.canUndo) return null;
    const edits = this.edits.slice(0, -1);
    const step = await this.replay(edits);
    if (!step.ok) return step;
    this.redoList = [...this.redoList, this.edits[this.edits.length - 1]];
    this.edits = edits;
    this.undoLeft--;
    // Undo shows no notes: the newest edit left is not the one the user just acted on.
    return { ...step, notes: [] };
  }

  /** Puts the last undone edit back and replays. Null when redo cannot act. */
  async redo(): Promise<HistoryStep | null> {
    if (!this.canRedo) return null;
    const edit = this.redoList[this.redoList.length - 1];
    const edits = [...this.edits, edit];
    const step = await this.replay(edits);
    if (!step.ok) return step;
    this.redoList = this.redoList.slice(0, -1);
    this.edits = edits;
    this.undoLeft = Math.min(UNDO_LIMIT, this.undoLeft + 1);
    return this.newestNotes(step);
  }

  /**
   * A copy with the same base, edits, redo list and undo count, opened afresh. The editor works
   * on a copy, so Cancel leaves the tab's kept history exactly as Done left it.
   */
  fork(): TextEditHistory {
    const copy = new TextEditHistory(this.engine, this.base);
    copy.restore({ edits: [...this.edits], redo: [...this.redoList], undoLeft: this.undoLeft, bytes: this.bytes });
    copy.opened = [...this.edits];
    return copy;
  }

  private restore(state: State): void {
    this.edits = state.edits;
    this.redoList = state.redo;
    this.undoLeft = state.undoLeft;
    this.bytes = state.bytes;
  }

  /** One `applyEdits` over the base. The engine gets a copy, so it cannot change the base. */
  private async replay(edits: TextEdit[]): Promise<HistoryStep> {
    if (edits.length === 0) {
      this.bytes = this.base;
      return { ok: true, bytes: this.base, notes: [] };
    }
    try {
      const result = await this.engine.applyEdits(this.base.slice(), edits);
      this.bytes = result.bytes;
      return { ok: true, bytes: result.bytes, notes: result.notes };
    } catch (err) {
      return { ok: false, message: messageOf(err) };
    }
  }

  private newestNotes(step: HistoryStep & { ok: true }): HistoryStep {
    const newest = this.edits.length - 1;
    return { ...step, notes: step.notes.filter((note) => note.edit === newest) };
  }
}

function messageOf(err: unknown): string {
  if (err instanceof EngineError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
