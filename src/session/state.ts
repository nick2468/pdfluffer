// State schemas, their parsers, the history helpers and the debounced saver (spec 8.6, 12.1).
// Pure TypeScript. Nothing here touches React or PDF.js.

import type { FileAdapter, FileRef } from "../files/FileAdapter";
import type { ViewState } from "../viewer/Viewer";

// key "session"
export interface SessionStateV1 {
  version: 1;
  tabs: { id: string; ref: FileRef; name: string; saveConfirmed: boolean }[];
  activeTabId: string | null;
}

export type HistoryItem = { ref: FileRef; name: string; lastOpened: string; view: ViewState | null };

// key "history" - one list serves both the Recent menu and per-file view memory
export interface HistoryStateV1 {
  version: 1;
  items: HistoryItem[];
}   // newest first. At most 100 items. The Recent menu shows the first 15.

// key "settings"
export interface SettingsV1 { version: 1; restoreSession: boolean; keepBackup: boolean; }

export const HISTORY_LIMIT = 100;
export const RECENT_LIMIT = 15;

export function defaultSession(): SessionStateV1 {
  return { version: 1, tabs: [], activeTabId: null };
}

export function defaultHistory(): HistoryStateV1 {
  return { version: 1, items: [] };
}

export function defaultSettings(): SettingsV1 {
  return { version: 1, restoreSession: true, keepBackup: false };
}

// Parsers. Each returns a clean copy of a valid value, else the default. A missing value
// (null or undefined) is a normal first run and logs nothing. Anything else wrong logs one
// console.warn (D15).

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseView(v: unknown): ViewState | null | undefined {
  if (v === null) return null;
  if (!isObj(v) || !isNum(v.page) || !isStr(v.scale) || !isNum(v.rotation)) return undefined;
  return { page: v.page, scale: v.scale, rotation: v.rotation };
}

function parseTab(v: unknown): SessionStateV1["tabs"][number] | undefined {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.ref) || !isStr(v.name) || !isBool(v.saveConfirmed)) {
    return undefined;
  }
  return { id: v.id, ref: v.ref, name: v.name, saveConfirmed: v.saveConfirmed };
}

function parseHistoryItem(v: unknown): HistoryItem | undefined {
  if (!isObj(v) || !isStr(v.ref) || !isStr(v.name) || !isStr(v.lastOpened)) return undefined;
  const view = parseView(v.view);
  if (view === undefined) return undefined;
  return { ref: v.ref, name: v.name, lastOpened: v.lastOpened, view };
}

/** Parses every element, or returns undefined if one element is wrongly shaped. */
function parseList<T>(v: unknown, parseOne: (e: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: T[] = [];
  for (const e of v) {
    const parsed = parseOne(e);
    if (parsed === undefined) return undefined;
    out.push(parsed);
  }
  return out;
}

function parseWith<T>(key: string, value: unknown, fallback: () => T, parse: (v: Obj) => T | undefined): T {
  if (value === null || value === undefined) return fallback();
  const parsed = isObj(value) && value.version === 1 ? parse(value) : undefined;
  if (parsed === undefined) {
    console.warn(`Stored ${key} state is not valid. Using the default.`);
    return fallback();
  }
  return parsed;
}

export function parseSession(value: unknown): SessionStateV1 {
  return parseWith("session", value, defaultSession, (v) => {
    const tabs = parseList(v.tabs, parseTab);
    if (!tabs || !(v.activeTabId === null || isStr(v.activeTabId))) return undefined;
    return { version: 1, tabs, activeTabId: v.activeTabId };
  });
}

export function parseHistory(value: unknown): HistoryStateV1 {
  return parseWith("history", value, defaultHistory, (v) => {
    const items = parseList(v.items, parseHistoryItem);
    return items && { version: 1, items };
  });
}

export function parseSettings(value: unknown): SettingsV1 {
  return parseWith("settings", value, defaultSettings, (v) => {
    if (!isBool(v.restoreSession) || !isBool(v.keepBackup)) return undefined;
    return { version: 1, restoreSession: v.restoreSession, keepBackup: v.keepBackup };
  });
}

// History helpers. All pure. Each returns a new array.

type SameFile = (a: FileRef, b: FileRef) => boolean;

/** Moves or inserts the file to the front, keeps its stored view, and trims to 100. */
export function touchHistory(
  items: HistoryItem[], ref: FileRef, name: string, nowIso: string, sameFile: SameFile,
): HistoryItem[] {
  const existing = items.find((item) => sameFile(item.ref, ref));
  const rest = items.filter((item) => !sameFile(item.ref, ref));
  return [{ ref, name, lastOpened: nowIso, view: existing?.view ?? null }, ...rest].slice(0, HISTORY_LIMIT);
}

/** Sets the stored view of a file already in the history. Other files are unchanged. */
export function setHistoryView(
  items: HistoryItem[], ref: FileRef, view: ViewState | null, sameFile: SameFile,
): HistoryItem[] {
  return items.map((item) => (sameFile(item.ref, ref) ? { ...item, view } : item));
}

export function viewFor(items: HistoryItem[], ref: FileRef, sameFile: SameFile): ViewState | null {
  return items.find((item) => sameFile(item.ref, ref))?.view ?? null;
}

/** The items the Recent menu shows. */
export function recentItems(items: HistoryItem[]): HistoryItem[] {
  return items.slice(0, RECENT_LIMIT);
}

// Debounced saver: writes the latest value delayMs after the last set (spec 8.6).

export interface DebouncedSaver<T> {
  set(value: T): void;
  flush(): Promise<void>;
}

export function createDebouncedSaver<T>(
  files: Pick<FileAdapter, "saveState">, key: string, delayMs = 500,
): DebouncedSaver<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;

  const cancelTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const flush = async () => {
    cancelTimer();
    if (!pending) return;
    const { value } = pending;
    pending = null;
    await files.saveState(key, value);
  };

  return {
    set(value: T) {
      pending = { value };
      cancelTimer();
      timer = setTimeout(() => {
        flush().catch((err: unknown) => console.warn(`Could not save ${key} state:`, err));
      }, delayMs);
    },
    flush,
  };
}
