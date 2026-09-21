// The Dialogs service of spec 8.5 and 11.5. ask() queues a question and returns a promise.
// ChoiceDialog shows the first question in the queue, one at a time. progress() shows a long
// job's dialog at once, beside that queue, and ProgressDialog draws it (spec 20.5).

import type { DialogButton, Dialogs, Progress } from "../session/dialogTexts";

export interface PendingDialog {
  title: string;
  body: string;
  buttons: DialogButton[];
}

interface Entry extends PendingDialog { resolve(id: string): void; }

/** What ProgressDialog draws. A new object on every change, so React sees each one. */
export interface ProgressView {
  title: string;
  text: string;
  /** The user chose Cancel and the job is finishing the step it is on. */
  cancelling: boolean;
}

/** The job's handle. It only reaches the screen while it is the one showing. */
class ProgressHandle implements Progress {
  cancelled = false;
  constructor(private readonly service: DialogService) {}

  update(text: string): void {
    this.service.changeProgress(this, (view) => ({ ...view, text }));
  }

  close(): void {
    this.service.closeProgress(this);
  }
}

export class DialogService implements Dialogs {
  private queue: Entry[] = [];
  private listeners = new Set<() => void>();
  private progressHandle: ProgressHandle | null = null;
  private progressView: ProgressView | null = null;

  ask(title: string, body: string, buttons: DialogButton[]): Promise<string> {
    return new Promise((resolve) => {
      this.queue.push({ title, body, buttons, resolve });
      if (this.queue.length === 1) this.notify();
    });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** The dialog on screen, or null. The same object until it is answered. */
  readonly current = (): PendingDialog | null => this.queue[0] ?? null;

  /** Answers the dialog on screen with a button id. */
  answer(id: string): void {
    const entry = this.queue.shift();
    if (!entry) return;
    entry.resolve(id);
    this.notify();
  }

  progress(title: string, text: string): Progress {
    const handle = new ProgressHandle(this);
    this.progressHandle = handle;
    this.progressView = { title, text, cancelling: false };
    this.notify();
    return handle;
  }

  /** The progress dialog on screen, or null. The same object until it changes. */
  readonly currentProgress = (): ProgressView | null => this.progressView;

  /** The Cancel button. The job sees it through `cancelled` and stops at a safe point. */
  cancelProgress(): void {
    const handle = this.progressHandle;
    if (!handle || handle.cancelled) return;
    handle.cancelled = true;
    this.changeProgress(handle, (view) => ({ ...view, cancelling: true }));
  }

  /** @internal For ProgressHandle. A handle that is no longer showing changes nothing. */
  changeProgress(handle: ProgressHandle, change: (view: ProgressView) => ProgressView): void {
    if (handle !== this.progressHandle || !this.progressView) return;
    this.progressView = change(this.progressView);
    this.notify();
  }

  /** @internal For ProgressHandle. */
  closeProgress(handle: ProgressHandle): void {
    if (handle !== this.progressHandle) return;
    this.progressHandle = null;
    this.progressView = null;
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** Escape means the button with id "cancel", or the last button when there is none. */
export function escapeId(buttons: DialogButton[]): string {
  if (buttons.some((b) => b.id === "cancel")) return "cancel";
  return buttons[buttons.length - 1]?.id ?? "cancel";
}
