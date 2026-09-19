// The key-to-shortcut mapping of spec 11.6. Pure, so the parent window and the viewer iframe
// share it and it can be unit tested.

import type { ShortcutName } from "./Viewer";

export interface KeyChord { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; }

/** The PDFluffer shortcut for this key press, or null when the key belongs to PDF.js. */
export function shortcutFor(e: KeyChord): ShortcutName | null {
  if (!e.ctrlKey || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === "tab") return e.shiftKey ? "prevTab" : "nextTab";
  if (key === "s") return e.shiftKey ? "saveAs" : "save";
  if (e.shiftKey) return null;
  if (key === "o") return "open";
  if (key === "w") return "closeTab";
  return null;
}

/** F5 (with any Ctrl or Shift), Ctrl+R or Ctrl+Shift+R. Production builds swallow these, because a reload loses unsaved edits. */
export function isReloadKey(e: KeyChord): boolean {
  if (e.altKey) return false;
  const key = e.key.toLowerCase();
  if (key === "f5") return true;   // Ctrl+F5 and Shift+F5 reload too
  return e.ctrlKey && key === "r";
}
