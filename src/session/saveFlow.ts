// The save and Save As flows (spec 12.3, 12.4), moved out of SessionManager to keep it
// readable. Plain functions over the tab and a small context the manager supplies.

import { FileError, type FileAdapter, type FileRef } from "../files/FileAdapter";
import { hasDigitalSignature } from "../util/hasDigitalSignature";
import { decideSave } from "./decideSave";
import {
  BUTTON, firstSaveDialog, LOCKED_DIALOG, OPEN_ELSEWHERE_DIALOG, saveFailedDialog,
  SIGNATURE_GUARD_DIALOG, type DialogText,
} from "./dialogTexts";
import type { DocumentSession } from "./DocumentSession";

export interface SaveContext {
  files: FileAdapter;
  keepBackup: boolean;
  ask(text: DialogText): Promise<string>;
  /** True while the tab is still open. */
  has(tab: DocumentSession): boolean;
  /** True when a tab other than this one holds ref. */
  openElsewhere(tab: DocumentSession, ref: FileRef): boolean;
  publish(): void;
  /** Records the tab's new ref at the front of history. */
  touchHistory(tab: DocumentSession): void;
}

type SaveMode = 'none' | 'append' | 'rewrite';

export async function saveTab(ctx: SaveContext, tab: DocumentSession): Promise<boolean> {
  if (!tab.viewer || tab.status !== 'ready') return false;
  const dirty = tab.dirty;
  const mode = await exportInto(ctx, tab);
  if (mode === null) return false;

  for (;;) {
    const step = decideSave({
      dirty, mode, hasDigitalSignature: tab.hasDigitalSignature,
      rewriteAcknowledged: tab.rewriteAcknowledged, saveConfirmed: tab.saveConfirmed,
    });
    if (step === 'nothing-to-save') return true;
    if (step === 'write') break;
    if (step === 'guard-signature') {
      const choice = await ctx.ask(SIGNATURE_GUARD_DIALOG);
      if (choice === BUTTON.saveCopy.id) return saveAsExported(ctx, tab, mode);
      if (choice !== BUTTON.continue.id) return false;
      tab.rewriteAcknowledged = true;
    } else {
      const choice = await ctx.ask(firstSaveDialog(tab.name));
      if (choice === BUTTON.saveAs.id) return saveAsExported(ctx, tab, mode);
      if (choice !== BUTTON.overwrite.id) return false;
      tab.saveConfirmed = true;
      ctx.publish();
    }
    if (!ctx.has(tab)) return false;
  }

  if (!(await write(ctx, tab, tab.ref))) return false;
  await afterWrite(ctx, tab, mode);
  return true;
}

export async function saveTabAs(ctx: SaveContext, tab: DocumentSession): Promise<boolean> {
  if (!tab.viewer || tab.status !== 'ready') return false;
  const mode = await exportInto(ctx, tab);
  if (mode === null) return false;
  return saveAsExported(ctx, tab, mode);
}

/**
 * Steps 1 and 2 of spec 12.3. Returns the save mode, or null after showing the error.
 * An export that is not on disk yet is kept in unsavedMode, so the tab stays dirty.
 */
async function exportInto(ctx: SaveContext, tab: DocumentSession): Promise<SaveMode | null> {
  if (!tab.viewer) return null;
  let result;
  try {
    result = await tab.viewer.exportBytes();
  } catch (err) {
    await ctx.ask(saveFailedDialog(messageOf(err)));
    return null;
  }
  if (result.mode !== 'none') {
    tab.bytes = result.bytes;
    tab.unsavedMode = tab.unsavedMode === 'rewrite' ? 'rewrite' : result.mode;
    ctx.publish();
  }
  if (tab.pendingEngineChanges) return 'rewrite';
  return tab.unsavedMode ?? 'none';
}

async function saveAsExported(ctx: SaveContext, tab: DocumentSession, mode: SaveMode): Promise<boolean> {
  let target: FileRef | null;
  try {
    target = await ctx.files.pickSaveTarget(tab.name, tab.ref);
  } catch (err) {
    await ctx.ask(saveFailedDialog(messageOf(err)));
    return false;
  }
  if (target === null || !ctx.has(tab)) return false;
  if (ctx.openElsewhere(tab, target)) {
    await ctx.ask(OPEN_ELSEWHERE_DIALOG);
    return false;
  }
  if (!(await write(ctx, tab, target))) return false;
  tab.ref = target;
  tab.name = ctx.files.nameOf(target);
  tab.saveConfirmed = true;
  ctx.touchHistory(tab);
  await afterWrite(ctx, tab, mode);
  return true;
}

/** Step 4 of spec 12.3. Shows the error and returns false on failure. */
async function write(ctx: SaveContext, tab: DocumentSession, target: FileRef): Promise<boolean> {
  try {
    await ctx.files.writeFile(target, tab.bytes ?? new Uint8Array(), { keepBackup: ctx.keepBackup });
    return true;
  } catch (err) {
    const locked = err instanceof FileError && err.code === 'locked';
    await ctx.ask(locked ? LOCKED_DIALOG : saveFailedDialog(messageOf(err)));
    return false;
  }
}

/** Step 5 of spec 12.3. A rewrite reloads the viewer. An append does not. */
async function afterWrite(ctx: SaveContext, tab: DocumentSession, mode: SaveMode): Promise<void> {
  tab.pendingEngineChanges = false;
  tab.unsavedMode = null;
  if (tab.bytes) tab.hasDigitalSignature = hasDigitalSignature(tab.bytes);
  ctx.publish();
  if (mode !== 'rewrite' || !tab.viewer || !tab.bytes) return;
  const viewer = tab.viewer;
  try {
    const info = await viewer.load(tab.bytes, tab.name, viewer.getViewState());
    if (!ctx.has(tab)) return;
    tab.isXfa = info.isXfa;
    tab.pageCount = info.pageCount;
    tab.viewerDirty = viewer.hasChanges();
  } catch (err) {
    // The file is saved. Only the view failed, so the tab shows the error panel.
    if (!ctx.has(tab)) return;
    tab.dropViewer();
    tab.status = 'error';
    tab.errorMessage = messageOf(err);
  }
  ctx.publish();
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
