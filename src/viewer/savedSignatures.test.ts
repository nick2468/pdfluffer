import { describe, expect, it } from 'vitest';
import {
  MAX_SIGNATURE_NAME,
  parseSavedSignatures,
  renameSavedSignature,
  SavedSignatureStore,
  SIGNATURE_STORAGE_KEY,
} from './savedSignatures';

/** The shape PDF.js 6.3.289 writes: one key per signature, compact JSON, insertion order. */
function stored(...names: string[]): string {
  const entries = names.map((name, index) => [
    `uuid-${index + 1}`,
    { description: name, signatureData: `data-${index + 1}` },
  ]);
  return JSON.stringify(Object.fromEntries(entries));
}

/** A localStorage stand-in. `fail` makes setItem throw, as a full quota does. */
class FakeStorage {
  value: string | null = null;
  writes = 0;
  fail = false;

  getItem(key: string): string | null {
    return key === SIGNATURE_STORAGE_KEY ? this.value : null;
  }

  setItem(key: string, value: string): void {
    if (this.fail) throw new Error("QuotaExceededError");
    if (key !== SIGNATURE_STORAGE_KEY) return;
    this.value = value;
    this.writes++;
  }
}

describe('parseSavedSignatures', () => {
  it('reads an empty list from nothing', () => {
    expect(parseSavedSignatures(null)).toEqual([]);
    expect(parseSavedSignatures("")).toEqual([]);
    expect(parseSavedSignatures("{}")).toEqual([]);
  });

  it('lists every signature in stored order', () => {
    expect(parseSavedSignatures(stored("Nick", "Initials"))).toEqual([
      { uuid: 'uuid-1', description: "Nick" },
      { uuid: 'uuid-2', description: "Initials" },
    ]);
  });

  it('keeps an entry that carries extra fields', () => {
    const raw = JSON.stringify({ a: { description: "N", signatureData: "d", extra: 1 } });
    expect(parseSavedSignatures(raw)).toEqual([{ uuid: 'a', description: "N" }]);
  });

  it('refuses anything that is not the shape we know', () => {
    expect(parseSavedSignatures("not json")).toBeNull();
    expect(parseSavedSignatures("[1,2]")).toBeNull();
    // An array is not the shape we know, even when it is empty or holds entries that look right.
    expect(parseSavedSignatures("[]")).toBeNull();
    expect(parseSavedSignatures('[{"description":"N","signatureData":"d"}]')).toBeNull();
    expect(parseSavedSignatures("null")).toBeNull();
    expect(parseSavedSignatures('"text"')).toBeNull();
    expect(parseSavedSignatures("5")).toBeNull();
  });

  it('refuses a list where any single entry is wrong', () => {
    const good = { description: "N", signatureData: "d" };
    expect(parseSavedSignatures(JSON.stringify({ a: good, b: "text" }))).toBeNull();
    expect(parseSavedSignatures(JSON.stringify({ a: good, b: null }))).toBeNull();
    expect(parseSavedSignatures(JSON.stringify({ a: good, b: [] }))).toBeNull();
    expect(parseSavedSignatures(JSON.stringify({ a: good, b: { description: "N" } }))).toBeNull();
    expect(parseSavedSignatures(JSON.stringify({ a: good, b: { signatureData: "d" } }))).toBeNull();
    expect(parseSavedSignatures(JSON.stringify({ a: { description: 7, signatureData: "d" } }))).toBeNull();
  });
});

describe('renameSavedSignature', () => {
  it('changes one description and leaves the rest of the file alone', () => {
    const raw = stored("One", "Two", "Three");
    const next = renameSavedSignature(raw, 'uuid-2', "Middle");
    expect(next).not.toBeNull();
    expect(JSON.parse(next as string)).toEqual({
      'uuid-1': { description: "One", signatureData: 'data-1' },
      'uuid-2': { description: "Middle", signatureData: 'data-2' },
      'uuid-3': { description: "Three", signatureData: 'data-3' },
    });
    // The order is the order of the signature menu, so it has to survive a rename.
    expect(Object.keys(JSON.parse(next as string))).toEqual(['uuid-1', 'uuid-2', 'uuid-3']);
  });

  it('keeps any extra field of the renamed entry', () => {
    const raw = JSON.stringify({ a: { description: "Old", signatureData: "d", extra: [1, 2] } });
    const next = renameSavedSignature(raw, 'a', "New");
    expect(JSON.parse(next as string)).toEqual({
      a: { description: "New", signatureData: "d", extra: [1, 2] },
    });
  });

  it('trims the name', () => {
    const next = renameSavedSignature(stored("Old"), 'uuid-1', "  Nick Hall  ");
    expect(parseSavedSignatures(next)).toEqual([{ uuid: 'uuid-1', description: "Nick Hall" }]);
  });

  it('cuts a very long name', () => {
    const next = renameSavedSignature(stored("Old"), 'uuid-1', "x".repeat(MAX_SIGNATURE_NAME + 10));
    expect(parseSavedSignatures(next)?.[0].description).toHaveLength(MAX_SIGNATURE_NAME);
  });

  it('refuses an empty name', () => {
    expect(renameSavedSignature(stored("Old"), 'uuid-1', "")).toBeNull();
    expect(renameSavedSignature(stored("Old"), 'uuid-1', "   ")).toBeNull();
  });

  it('refuses a uuid that is not there', () => {
    expect(renameSavedSignature(stored("Old"), 'gone', "New")).toBeNull();
    expect(renameSavedSignature(null, 'uuid-1', "New")).toBeNull();
  });

  it('refuses a shape it does not know, so a strange value is never overwritten', () => {
    expect(renameSavedSignature("[1,2]", 'uuid-1', "New")).toBeNull();
    expect(renameSavedSignature("not json", 'uuid-1', "New")).toBeNull();
  });
});

describe('SavedSignatureStore', () => {
  it('lists what the storage holds, and null when it cannot read it', () => {
    const storage = new FakeStorage();
    const store = new SavedSignatureStore(storage);
    expect(store.list()).toEqual([]);
    storage.value = stored("Nick");
    expect(store.list()).toEqual([{ uuid: 'uuid-1', description: "Nick" }]);
    storage.value = "[1,2]";
    expect(store.list()).toBeNull();
  });

  it('re-reads the storage, so a signature added meanwhile is kept', () => {
    const storage = new FakeStorage();
    storage.value = stored("One");
    const store = new SavedSignatureStore(storage);
    expect(store.list()).toHaveLength(1);

    // A viewer in another tab saves a second signature after the dialog read the list.
    storage.value = stored("One", "Two");

    expect(store.rename('uuid-1', "Renamed")).toBe(true);
    expect(store.list()).toEqual([
      { uuid: 'uuid-1', description: "Renamed" },
      { uuid: 'uuid-2', description: "Two" },
    ]);
  });

  it('writes nothing when the name is the one it already has', () => {
    const storage = new FakeStorage();
    storage.value = stored("Nick");
    const store = new SavedSignatureStore(storage);
    expect(store.rename('uuid-1', "Nick")).toBe(false);
    expect(store.rename('uuid-1', "  Nick  ")).toBe(false);
    expect(storage.writes).toBe(0);
  });

  it('writes nothing for a uuid that is gone or a name that is empty', () => {
    const storage = new FakeStorage();
    storage.value = stored("Nick");
    const store = new SavedSignatureStore(storage);
    expect(store.rename('gone', "New")).toBe(false);
    expect(store.rename('uuid-1', " ")).toBe(false);
    expect(storage.writes).toBe(0);
    expect(storage.value).toBe(stored("Nick"));
  });

  it('reports failure instead of throwing when the storage refuses the write', () => {
    const storage = new FakeStorage();
    storage.value = stored("Nick");
    storage.fail = true;
    const store = new SavedSignatureStore(storage);
    expect(store.rename('uuid-1', "New")).toBe(false);
    expect(storage.value).toBe(stored("Nick"));
  });
});
