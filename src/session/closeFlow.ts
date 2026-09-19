// The close flows (spec 12.5), moved out of SessionManager to keep it readable.

import { BUTTON, closeDirtyDialog, type DialogText } from "./dialogTexts";
import type { DocumentSession } from "./DocumentSession";

/** The spec 12.5 dialog. True when the tab may close: saved, or the user chose Discard. */
export async function askToSave(
  ask: (text: DialogText) => Promise<string>, tab: DocumentSession, save: () => Promise<boolean>,
): Promise<boolean> {
  const choice = await ask(closeDirtyDialog(tab.name));
  if (choice === BUTTON.discard.id) return true;
  if (choice === BUTTON.save.id) return save();
  return false;
}

/** The tab to activate after closing the one at index: the right neighbour, else the left. */
export function neighbourAfterClose<T>(remaining: T[], index: number): T | undefined {
  return remaining[index] ?? remaining[index - 1];
}

export interface CloseAllContext {
  tabs(): DocumentSession[];
  has(tab: DocumentSession): boolean;
  activate(tab: DocumentSession): Promise<void>;
  askToSave(tab: DocumentSession): Promise<boolean>;
  /** Writes session and history at once. */
  flush(): Promise<void>;
}

/** For each dirty tab in order: activate it and ask. The first Cancel keeps the window open. */
export async function confirmCloseAll(ctx: CloseAllContext): Promise<boolean> {
  for (const tab of [...ctx.tabs()]) {
    if (!ctx.has(tab) || !tab.dirty) continue;
    await ctx.activate(tab);
    if (!(await ctx.askToSave(tab))) return false;
  }
  await ctx.flush();
  return true;
}
