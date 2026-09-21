// Spec 11.8. PDF.js saves signatures in one localStorage key and offers no way to rename
// one, so PDFluffer renames from outside by rewriting that entry's description.
//
// D7 names this file as the one exception to "only PdfJsViewer.ts touches PDF.js": it is the
// only file that may read or write pdfjs.signature. It imports nothing from PDF.js, React or
// src/app, so the rules below are plain unit tests.
//
// Every viewer listens for the storage event on this key and redraws its list of saved
// signatures. The browser fires that event in every same-origin document except the one that
// wrote, and the app frame is not a viewer iframe, so one write refreshes every open tab.

export const SIGNATURE_STORAGE_KEY = "pdfjs.signature";

/** Long enough for any name a person types, short enough to keep the button readable. */
export const MAX_SIGNATURE_NAME = 120;

export interface SavedSignature { uuid: string; description: string; }

/** The stored entry. PDF.js writes these two fields. Anything else it adds later is kept. */
interface StoredEntry { description: string; signatureData: string; }

/**
 * The saved signatures in stored order, which is the order of PDF.js's signature menu.
 * Null means the stored value is not the shape this file knows, and nothing may be written.
 * Nothing stored at all is an empty list, not an error.
 */
export function parseSavedSignatures(raw: string | null): SavedSignature[] | null {
  const parsed = parseStored(raw);
  if (!parsed) return null;
  return Object.entries(parsed).map(([uuid, entry]) => ({ uuid, description: entry.description }));
}

/**
 * The new raw string, or null when the uuid is missing, the shape is unknown, or the name
 * is empty. Only that entry's description changes: every other key, every signatureData,
 * any extra field, and the order stay as they were.
 */
export function renameSavedSignature(raw: string | null, uuid: string, name: string): string | null {
  const description = tidyName(name);
  if (!description) return null;
  const parsed = parseStored(raw);
  // An own key only: "toString" is in every object, and it names no signature.
  if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, uuid)) return null;
  // Rebuilt through fromEntries, which defines each key rather than assigning it, so a
  // stored key named __proto__ cannot reach an object prototype.
  const entries = Object.entries(parsed).map(([key, entry]): [string, StoredEntry] =>
    key === uuid ? [key, { ...entry, description }] : [key, entry]);
  return JSON.stringify(Object.fromEntries(entries));
}

/** The saved signatures of one Storage. The dialog holds one of these. */
export class SavedSignatureStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem">) {}

  /** The list now, or null when the stored value cannot be read. */
  list(): SavedSignature[] | null {
    return parseSavedSignatures(this.read());
  }

  /**
   * Renames one signature. False when nothing was written, which covers a bad name, a uuid
   * that has gone, an unreadable value, the name it already has, and a storage that refuses.
   */
  rename(uuid: string, name: string): boolean {
    // Read again here, not from the list the dialog is showing: a viewer may have added or
    // deleted a signature since, and that change must survive this write.
    const raw = this.read();
    const next = renameSavedSignature(raw, uuid, name);
    // An unchanged name gives back the same string, because PDF.js and this file both write
    // compact JSON with the keys in stored order.
    if (next === null || next === raw) return false;
    try {
      this.storage.setItem(SIGNATURE_STORAGE_KEY, next);
    } catch (err) {
      console.warn("Could not save the signature name:", err);
      return false;
    }
    return true;
  }

  private read(): string | null {
    try {
      return this.storage.getItem(SIGNATURE_STORAGE_KEY);
    } catch (err) {
      console.warn("Could not read the saved signatures:", err);
      return null;
    }
  }
}

function tidyName(name: string): string {
  return name.trim().slice(0, MAX_SIGNATURE_NAME);
}

/** The stored object, or null. Every entry has to be right: one odd one condemns the lot. */
function parseStored(raw: string | null): Record<string, StoredEntry> | null {
  if (raw === null || raw === "") return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(value)) return null;
  for (const entry of Object.values(value)) {
    if (!isPlainObject(entry)) return null;
    if (typeof entry.description !== "string" || typeof entry.signatureData !== "string") return null;
  }
  return value as Record<string, StoredEntry>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
