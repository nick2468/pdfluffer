// Spec 21.5, the text editor: "Edit text...". A modal dialog that fills the window. PDFium draws
// the page (E6) and a box sits over each editable run. Every edit replays the history's list and
// redraws, so the page shown is always what Done will produce.
//
// The dialog reaches PDFium only through the TextEditEngine interface the history holds, so it
// never imports the engine. The session manager runs the guards, owns the tab and applies Done.
//
// Every action runs through one queue, in order. A box that loses focus applies its edit as
// Enter does, and the click that took the focus (Done, Cancel, another run) runs after that
// edit, so typed text is never dropped and Done waits for it.

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type MouseEvent } from "react";
import type { EditNote, RenderedPage, RunLocator, TextEdit, TextRun } from "../engine/textEdit";
import { BUTTON, TEXT_EDITOR, TEXT_EDITS_DISCARD_DIALOG } from "../session/dialogTexts";
import type { HistoryStep, TextEditHistory } from "../session/textEditHistory";
import {
  applyTransform, boxOnScreen, fitInside, locatorOf, nearestEditableRun, pagePoint, sameRun, screenFontSize,
} from "../util/textEditorGeometry";
import { useServices } from "./services";

/** The page area's padding in CSS pixels, as app.css sets it. */
const AREA_PADDING = 16;
/** E10: an insert with no run to copy uses 11 point. */
const DEFAULT_SIZE = 11;
/** The smallest input-box font, so a tiny run can still be read while typing. */
const MIN_INPUT_PX = 11;

interface PageView {
  picture: RenderedPage;
  runs: TextRun[];
  /** The picture's size on screen, in CSS pixels, and CSS pixels per picture pixel. */
  width: number;
  height: number;
  scale: number;
}

type InputBox =
  | { id: number; kind: 'replace'; run: TextRun; text: string }
  | { id: number; kind: 'insert'; pageIndex: number; x: number; y: number; styleFrom: TextRun | null; text: string };

/** useState with a ref that always holds the latest value, for the queued actions. */
function useStateRef<T>(initial: T): [T, (value: T) => void, { readonly current: T }] {
  const [value, setValue] = useState(initial);
  const ref = useRef(value);
  const set = useCallback((next: T) => {
    ref.current = next;
    setValue(next);
  }, []);
  return [value, set, ref];
}

/** True when the box holds text that would make an edit. */
function changed(box: InputBox | null): boolean {
  if (!box) return false;
  return box.kind === 'replace' ? box.text !== box.run.text : box.text.trim() !== "";
}

/** The edit a box makes, or null when it makes none. */
function editFor(box: InputBox): TextEdit | null {
  if (!changed(box)) return null;
  if (box.kind === 'replace') return { kind: 'replace', target: locatorOf(box.run), text: box.text };
  return {
    kind: 'insert', pageIndex: box.pageIndex, x: box.x, y: box.y, text: box.text,
    styleFrom: box.styleFrom ? locatorOf(box.styleFrom) : null,
  };
}

function noteText(note: EditNote): string {
  return note.kind === 'font-substituted' ? TEXT_EDITOR.fontSubstituted(note.font) : TEXT_EDITOR.runsPastEnd;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function TextEditorDialog({ tabId, onClose }: { tabId: string; onClose: () => void }) {
  const { manager, dialogs } = useServices();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const historyRef = useRef<TextEditHistory | null>(null);
  const pageCount = Math.max(1, manager.pageCount(tabId) ?? 1);
  const [page, setPage, pageRef] = useStateRef(
    Math.min(pageCount - 1, Math.max(0, (manager.currentPage(tabId) ?? 1) - 1)));
  const [view, setView, viewRef] = useStateRef<PageView | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [selected, setSelected, selectedRef] = useStateRef<RunLocator | null>(null);
  const [input, setInput, inputRef] = useStateRef<InputBox | null>(null);
  const [inserting, setInserting, insertingRef] = useStateRef(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const closedRef = useRef(false);
  const startedRef = useRef(false);
  const boxIds = useRef(0);

  /** Runs actions one at a time, in the order asked. Nothing runs after the dialog closed. */
  const enqueue = useCallback((action: () => Promise<void> | void): Promise<void> => {
    const next = queue.current.then(async () => {
      if (!closedRef.current) await action();
    }).catch((err: unknown) => console.error("The text editor failed:", err));
    queue.current = next;
    return next;
  }, []);

  /** Draws the history's current bytes on the current page, fitted whole into the page area. */
  const draw = useCallback(async (): Promise<void> => {
    const history = historyRef.current;
    const area = areaRef.current;
    if (!history || !area) return;
    const areaWidth = Math.max(1, area.clientWidth - 2 * AREA_PADDING);
    const areaHeight = Math.max(1, area.clientHeight - 2 * AREA_PADDING);
    const maxDimension = Math.max(1, Math.round(Math.max(areaWidth, areaHeight) * (window.devicePixelRatio || 1)));
    try {
      const bytes = history.current;
      const index = pageRef.current;
      const picture = await history.engine.renderPage(bytes, index, maxDimension);
      const runs = await history.engine.listRuns(bytes, index);
      setDrawError(null);
      setView({ picture, runs, ...fitInside(picture.width, picture.height, areaWidth, areaHeight) });
    } catch (err) {
      setDrawError(TEXT_EDITOR.drawFailed(messageOf(err)));
    }
  }, [pageRef, setView]);

  const close = useCallback(() => {
    closedRef.current = true;
    if (dialogRef.current?.open) dialogRef.current.close();
    onClose();
  }, [onClose]);

  // Open: the manager's guards first. Only then does the dialog show. Refs survive React's
  // development double-run of effects, so the editor opens once.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const history = await manager.beginTextEdit(tabId);
      if (!history) {
        closedRef.current = true;
        onClose();
        return;
      }
      historyRef.current = history;
      dialogRef.current?.showModal();
      refresh();
      await enqueue(draw);
    })();
  }, [manager, tabId, onClose, enqueue, draw]);

  // Closing the window asks first while this editor holds new edits, typed text included.
  useEffect(() => manager.watchTextEditor(
    () => !closedRef.current && ((historyRef.current?.hasNewEdits ?? false) || changed(inputRef.current)),
  ), [manager, inputRef]);

  // A new window size draws the page again, to fit.
  useEffect(() => {
    const onResize = () => {
      if (historyRef.current) void enqueue(draw);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [enqueue, draw]);

  // Paints PDFium's picture into the canvas, at its own pixel size.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view) return;
    const { rgba, width, height } = view.picture;
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  }, [view]);

  const show = (step: HistoryStep): void => {
    setNotes(step.ok ? step.notes.map(noteText) : [TEXT_EDITOR.refused(step.message)]);
  };

  /** One edit: appended, replayed, redrawn. A refused edit changes nothing and says why. */
  const applyEdit = async (edit: TextEdit): Promise<void> => {
    const history = historyRef.current;
    if (!history) return;
    const step = await history.apply(edit);
    show(step);
    refresh();
    if (!step.ok) return;
    setSelected(null);
    await draw();
  };

  /** Closes the input box. With `apply`, its edit, if it makes one, joins the queue. */
  const closeInput = (apply: boolean): void => {
    const box = inputRef.current;
    if (!box) return;
    setInput(null);
    if (box.kind === 'insert') setInserting(false);   // insert mode ends after one insert or Escape
    const edit = apply ? editFor(box) : null;
    if (edit) void enqueue(() => applyEdit(edit));
  };

  const stepHistory = (which: 'undo' | 'redo'): void => {
    void enqueue(async () => {
      const history = historyRef.current;
      if (!history) return;
      const step = which === 'undo' ? await history.undo() : await history.redo();
      if (!step) return;
      show(step);
      setSelected(null);
      refresh();
      if (step.ok) await draw();
    });
  };

  const deleteSelected = (): void => {
    void enqueue(async () => {
      const target = selectedRef.current;
      if (target) await applyEdit({ kind: 'delete', target });
    });
  };

  const goToPage = (index: number): void => {
    void enqueue(async () => {
      if (index < 0 || index >= pageCount || index === pageRef.current) return;
      setPage(index);
      setSelected(null);
      setNotes([]);
      await draw();
    });
  };

  const done = (): void => {
    closeInput(true);
    void enqueue(async () => {
      const history = historyRef.current;
      if (!history) return;
      if (!history.hasNewEdits) {
        manager.cancelTextEdit(tabId);
        close();
        return;
      }
      // On a failure the manager has said why, and the editor stays open with every edit.
      if (await manager.finishTextEdit(tabId, history)) close();
    });
  };

  const cancel = (): void => {
    closeInput(true);
    void enqueue(async () => {
      const history = historyRef.current;
      if (history?.hasNewEdits) {
        const t = TEXT_EDITS_DISCARD_DIALOG;
        if (await dialogs.ask(t.title, t.body, t.buttons) !== BUTTON.discard.id) return;
      }
      manager.cancelTextEdit(tabId);
      close();
    });
  };

  const onRunClick = (run: TextRun, e: MouseEvent): void => {
    if (insertingRef.current) return;   // the page area takes it as the insert point
    e.stopPropagation();
    const target = locatorOf(run);
    void enqueue(() => {
      // An edit the click's own focus change applied may have redrawn the page first.
      const current = viewRef.current?.runs.find((r) => r.editable && sameRun(locatorOf(r), target));
      if (!current) return;
      setSelected(locatorOf(current));
      setInput({ id: ++boxIds.current, kind: 'replace', run: current, text: current.text });
    });
  };

  const onPageClick = (e: MouseEvent<HTMLDivElement>): void => {
    const shown = viewRef.current;
    if (!shown) return;
    if (!insertingRef.current) {
      if (e.target === e.currentTarget) setSelected(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const [x, y] = pagePoint(e.clientX - rect.left, e.clientY - rect.top, shown.picture.transform, shown.scale);
    const pageIndex = pageRef.current;
    void enqueue(() => {
      if (!insertingRef.current || pageRef.current !== pageIndex) return;
      const styleFrom = nearestEditableRun(viewRef.current?.runs ?? [], x, y);
      setSelected(null);
      setInput({ id: ++boxIds.current, kind: 'insert', pageIndex, x, y, styleFrom, text: "" });
    });
  };

  /**
   * The editor's keys. Listened for on the window, not the dialog: when an input box closes, the
   * focused element goes with it and the keys land on the page body, outside the dialog.
   */
  const onKeyDown = (e: KeyboardEvent): void => {
    if (closedRef.current || !dialogRef.current?.open) return;
    // In an input box, the keys are the box's own, and Ctrl+Z is the browser's text undo.
    if (e.target instanceof HTMLInputElement) return;
    // A question on top of the editor owns the keyboard.
    if (document.querySelector("dialog.choice-dialog[open]")) return;
    const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey;
    const key = e.key.toLowerCase();
    if (e.key === "Escape") {
      e.preventDefault();
      if (insertingRef.current) setInserting(false);
      else cancel();
    } else if (e.key === "Delete" && selectedRef.current) {
      e.preventDefault();
      deleteSelected();
    } else if (ctrl && key === "z") {
      e.preventDefault();
      stepHistory(e.shiftKey ? 'redo' : 'undo');
    } else if (ctrl && key === "y") {
      e.preventDefault();
      stepHistory('redo');
    } else if (e.key === "PageDown") {
      e.preventDefault();
      goToPage(pageRef.current + 1);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      goToPage(pageRef.current - 1);
    }
  };

  const keyHandler = useRef(onKeyDown);
  keyHandler.current = onKeyDown;
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const history = historyRef.current;
  const transform = view?.picture.transform ?? [1, 0, 0, 1, 0, 0];
  const scale = view?.scale ?? 1;

  return (
    <dialog ref={dialogRef} className="text-editor" aria-labelledby="text-editor-title" tabIndex={-1}
      onCancel={(e) => e.preventDefault()}
    >
      <div className="text-editor-toolbar" role="toolbar" aria-label={TEXT_EDITOR.title}>
        <h2 id="text-editor-title" className="text-editor-title">{TEXT_EDITOR.title}</h2>
        <button type="button" onClick={() => goToPage(page - 1)} disabled={page <= 0}
          aria-label={TEXT_EDITOR.previousPage} title={TEXT_EDITOR.previousPage}>&#8249;</button>
        <span className="text-editor-page-number">{TEXT_EDITOR.page(page + 1, pageCount)}</span>
        <button type="button" onClick={() => goToPage(page + 1)} disabled={page >= pageCount - 1}
          aria-label={TEXT_EDITOR.nextPage} title={TEXT_EDITOR.nextPage}>&#8250;</button>
        <span className="text-editor-gap" />
        <button type="button" aria-pressed={inserting} onClick={() => {
          setSelected(null);
          setInserting(!insertingRef.current);
        }}>{TEXT_EDITOR.insert}</button>
        <button type="button" onClick={deleteSelected} disabled={!selected}>{TEXT_EDITOR.delete}</button>
        <button type="button" onClick={() => stepHistory('undo')} disabled={!history?.canUndo}
          title="Ctrl+Z">{TEXT_EDITOR.undo}</button>
        <button type="button" onClick={() => stepHistory('redo')} disabled={!history?.canRedo}
          title="Ctrl+Y">{TEXT_EDITOR.redo}</button>
        <span className="text-editor-spacer" />
        <button type="button" className="primary" onClick={done}>{TEXT_EDITOR.done}</button>
        <button type="button" onClick={cancel}>{TEXT_EDITOR.cancel}</button>
      </div>
      <div className="text-editor-notes" role="status" aria-live="polite">
        {inserting && <p>{TEXT_EDITOR.insertHint}</p>}
        {notes.map((note) => <p key={note}>{note}</p>)}
      </div>
      <div className="text-editor-area" ref={areaRef}>
        {!view && !drawError && <p className="text-editor-message">{TEXT_EDITOR.loading}</p>}
        {drawError && <p className="text-editor-message">{drawError}</p>}
        {view && (
          <div className="text-editor-page" style={{ width: view.width, height: view.height }}>
            <canvas ref={canvasRef} style={{ width: view.width, height: view.height }} aria-hidden="true" />
            <div className={`text-editor-overlay${inserting ? " inserting" : ""}`} onClick={onPageClick}>
              {view.runs.filter((run) => run.editable).map((run) => {
                const box = boxOnScreen(run.bbox, transform, scale);
                const isSelected = selected !== null && sameRun(locatorOf(run), selected);
                return (
                  <button key={run.id} type="button" aria-label={run.text}
                    className={`text-run${isSelected ? " selected" : ""}`}
                    style={{ left: box.left - 2, top: box.top - 2, width: box.width + 4, height: box.height + 4 }}
                    onClick={(e) => onRunClick(run, e)}
                  />
                );
              })}
              {input && <InputBoxView box={input} transform={transform} scale={scale}
                onChange={(text) => setInput({ ...input, text })}
                onEnter={() => {
                  closeInput(true);
                  dialogRef.current?.focus();
                }}
                onEscape={() => {
                  closeInput(false);
                  dialogRef.current?.focus();
                }}
                onBlur={() => {
                  // The window losing focus (another program in front) is not the user leaving
                  // the box. The box stays, with its text, and gets the focus back with the window.
                  if (!document.hasFocus()) return;
                  closeInput(changed(inputRef.current));
                }}
              />}
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}

/**
 * The input box: over the run's box for a replace, with its baseline at the click for an insert.
 * In a font size near the run's on screen, at least as wide as the box, growing as the user types.
 */
function InputBoxView({ box, transform, scale, onChange, onEnter, onEscape, onBlur }: {
  box: InputBox; transform: readonly number[]; scale: number;
  onChange: (text: string) => void; onEnter: () => void; onEscape: () => void; onBlur: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (box.kind === 'replace') el.select();
    // A new box only: typing must not move the caret or select again.
  }, [box.id]);

  const points = box.kind === 'replace' ? box.run.fontSize : box.styleFrom?.fontSize ?? DEFAULT_SIZE;
  const fontPx = Math.max(MIN_INPUT_PX, screenFontSize(points, transform, scale));
  const lineHeight = fontPx * 1.25;
  let left: number;
  let top: number;
  let minWidth: number;
  if (box.kind === 'replace') {
    const area = boxOnScreen(box.run.bbox, transform, scale);
    left = area.left - 4;
    top = area.top + area.height / 2 - lineHeight / 2 - 4;
    minWidth = area.width + 8;
  } else {
    const [px, py] = applyTransform(transform, box.x, box.y);
    left = px * scale - 4;
    top = py * scale - fontPx - 4;   // the baseline sits about one font size below the top
    minWidth = fontPx * 8;
  }
  return (
    <input
      ref={ref}
      type="text"
      className="text-input"
      aria-label={box.kind === 'replace' ? TEXT_EDITOR.changeText : TEXT_EDITOR.newText}
      value={box.text}
      spellCheck={false}
      style={{
        left, top, fontSize: fontPx, lineHeight: `${lineHeight}px`,
        width: `max(${minWidth}px, ${box.text.length + 2}ch)`,
      }}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onEnter();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onEscape();
        }
      }}
    />
  );
}
