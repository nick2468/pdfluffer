// The Dialogs service of spec 8.5 and 11.5. ask() queues a question and returns a promise.
// ChoiceDialog shows the first question in the queue, one at a time.

import type { DialogButton, Dialogs } from "../session/dialogTexts";

export interface PendingDialog {
  title: string;
  body: string;
  buttons: DialogButton[];
}

interface Entry extends PendingDialog { resolve(id: string): void; }

export class DialogService implements Dialogs {
  private queue: Entry[] = [];
  private listeners = new Set<() => void>();

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

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** Escape means the button with id "cancel", or the last button when there is none. */
export function escapeId(buttons: DialogButton[]): string {
  if (buttons.some((b) => b.id === "cancel")) return "cancel";
  return buttons[buttons.length - 1]?.id ?? "cancel";
}
