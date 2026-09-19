// Development harness only (spec 8.2). Lets `npm run dev` run in an ordinary browser tab.
// Virtual files live in IndexedDB through idb-keyval: key "file:<uuid>", value { name, bytes }.
// A FileRef here is "mem:<uuid>".

import { entries, get, set } from "idb-keyval";
import { FileError, type FileAdapter, type FileRef, type OpenedFile, type WriteOptions } from "./FileAdapter";

interface VirtualFile { name: string; bytes: Uint8Array; }

const REF_PREFIX = "mem:";
const KEY_PREFIX = "file:";
const STATE_PREFIX = "pdfluffer.state.";

function keyOf(ref: FileRef): string {
  if (!ref.startsWith(REF_PREFIX)) throw new FileError("not-found", `Not a harness file: ${ref}`);
  return KEY_PREFIX + ref.slice(REF_PREFIX.length);
}

export class BrowserFileAdapter implements FileAdapter {
  /** File names by ref, so nameOf can answer synchronously. */
  private names = new Map<FileRef, string>();

  /** Fills the name cache from IndexedDB. createFileAdapter awaits it. */
  async init(): Promise<void> {
    for (const [key, value] of await entries<IDBValidKey, VirtualFile>()) {
      if (typeof key === "string" && key.startsWith(KEY_PREFIX)) {
        this.names.set(REF_PREFIX + key.slice(KEY_PREFIX.length), value.name);
      }
    }
  }

  pickFiles(): Promise<FileRef[]> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.accept = ".pdf";
      input.style.display = "none";
      const finish = (refs: FileRef[]) => {
        input.remove();
        resolve(refs);
      };
      input.addEventListener("cancel", () => finish([]));
      input.addEventListener("change", async () => {
        const refs: FileRef[] = [];
        for (const file of Array.from(input.files ?? [])) {
          refs.push(await this.createFile(file.name, new Uint8Array(await file.arrayBuffer())));
        }
        finish(refs);
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  async readFile(ref: FileRef): Promise<OpenedFile> {
    const file = await this.getFile(ref);
    return { ref, name: file.name, bytes: file.bytes.slice() };
  }

  async writeFile(ref: FileRef, bytes: Uint8Array, _options: WriteOptions): Promise<void> {
    // The harness keeps no backup. keepBackup only matters to the Tauri adapter.
    const file = await this.getFile(ref);
    try {
      await set(keyOf(ref), { name: file.name, bytes: bytes.slice() });
    } catch (err) {
      throw new FileError("io", (err as Error).message);
    }
  }

  async pickSaveTarget(suggestedName: string, _near: FileRef | null): Promise<FileRef | null> {
    const name = window.prompt("Save as (browser harness)", suggestedName)?.trim();
    if (!name) return null;
    return this.createFile(/\.pdf$/i.test(name) ? name : `${name}.pdf`, new Uint8Array());
  }

  nameOf(ref: FileRef): string {
    return this.names.get(ref) ?? ref;
  }

  describe(ref: FileRef): string {
    return "(browser harness) " + this.nameOf(ref);
  }

  sameFile(a: FileRef, b: FileRef): boolean {
    return a.toLowerCase() === b.toLowerCase();
  }

  async takePendingOpenRequests(): Promise<FileRef[]> {
    return [];
  }

  onOpenRequest(_listener: (refs: FileRef[]) => void): () => void {
    return () => {};
  }

  async loadState<T>(key: string): Promise<T | null> {
    const text = localStorage.getItem(STATE_PREFIX + key);
    if (text === null) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      console.warn(`Stored state "${key}" is not valid JSON. Ignoring it.`);
      return null;
    }
  }

  async saveState<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(STATE_PREFIX + key, JSON.stringify(value));
  }

  onCloseRequested(handler: () => Promise<boolean>): () => void {
    // A browser cannot wait for a promise in beforeunload, so the harness cannot keep the
    // tab open. The handler still starts, and localStorage writes inside it are synchronous.
    const listener = () => { void handler(); };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }

  async setWindowTitle(title: string): Promise<void> {
    document.title = title;
  }

  async openExternal(url: string): Promise<void> {
    window.open(url, "_blank", "noopener");
  }

  private async createFile(name: string, bytes: Uint8Array): Promise<FileRef> {
    const ref = REF_PREFIX + crypto.randomUUID();
    await set(keyOf(ref), { name, bytes });
    this.names.set(ref, name);
    return ref;
  }

  private async getFile(ref: FileRef): Promise<VirtualFile> {
    let file: VirtualFile | undefined;
    try {
      file = await get<VirtualFile>(keyOf(ref));
    } catch (err) {
      if (err instanceof FileError) throw err;
      throw new FileError("io", (err as Error).message);
    }
    if (!file) throw new FileError("not-found", `File not found: ${this.nameOf(ref)}`);
    return file;
  }
}
