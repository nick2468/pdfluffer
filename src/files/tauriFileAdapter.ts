// The product's file adapter (spec 8.2, 10.3 to 10.5). The only file in src/ that imports
// @tauri-apps. A FileRef here is the absolute, normalised Windows path.

import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { load, type Store } from "@tauri-apps/plugin-store";
import { FileError, type FileAdapter, type FileRef, type OpenedFile, type WriteOptions } from "./FileAdapter";

const PDF_FILTER = { name: "PDF", extensions: ["pdf"] };
const STATE_FILE = "state.json";

/** Maps a rejected invoke, which carries the Rust error string, to a FileError. */
export function toFileError(reason: unknown): FileError {
  if (reason instanceof FileError) return reason;
  const text = typeof reason === "string" ? reason : reason instanceof Error ? reason.message : String(reason);
  switch (text) {
    case "not-found":
      return new FileError("not-found", "The file was not found.");
    case "not-pdf":
      return new FileError("not-pdf", "This is not a PDF file.");
    case "locked":
      return new FileError("locked", "Another program has this file open.");
    default:
      return new FileError("io", text.startsWith("io: ") ? text.slice(4) : text);
  }
}

/** The last path segment, split on either slash. */
function lastSegment(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

async function call<T>(command: string, args?: InvokeArgs): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw toFileError(err);
  }
}

export class TauriFileAdapter implements FileAdapter {
  private store: Promise<Store> | null = null;

  async pickFiles(): Promise<FileRef[]> {
    const chosen = await open({ multiple: true, filters: [PDF_FILTER] });
    if (!chosen || chosen.length === 0) return [];
    return this.normalise(chosen);
  }

  async readFile(ref: FileRef): Promise<OpenedFile> {
    const buffer = await call<ArrayBuffer>("read_pdf", { path: ref });
    return { ref, name: lastSegment(ref), bytes: new Uint8Array(buffer) };
  }

  async writeFile(ref: FileRef, bytes: Uint8Array, options: WriteOptions): Promise<void> {
    try {
      await invoke("write_pdf", bytes, {
        headers: { "x-path": encodeURIComponent(ref), ...(options.keepBackup ? { "x-backup": "1" } : {}) },
      });
    } catch (err) {
      throw toFileError(err);
    }
  }

  async pickSaveTarget(suggestedName: string, near: FileRef | null): Promise<FileRef | null> {
    const folder = near === null ? "" : near.slice(0, near.length - lastSegment(near).length);
    const chosen = await save({ defaultPath: folder + suggestedName, filters: [PDF_FILTER] });
    if (!chosen) return null;
    const path = /\.pdf$/i.test(chosen) ? chosen : `${chosen}.pdf`;
    const [normalised] = await this.normalise([path]);
    return normalised ?? path;
  }

  nameOf(ref: FileRef): string {
    return lastSegment(ref);
  }

  describe(ref: FileRef): string {
    return ref;
  }

  sameFile(a: FileRef, b: FileRef): boolean {
    return a.toLowerCase() === b.toLowerCase();
  }

  takePendingOpenRequests(): Promise<FileRef[]> {
    return call<FileRef[]>("take_pending_files");
  }

  onOpenRequest(listener: (refs: FileRef[]) => void): () => void {
    const pending: Promise<UnlistenFn>[] = [
      listen<FileRef[]>("open-files", (event) => {
        if (event.payload.length > 0) listener(event.payload);
      }),
      getCurrentWebview().onDragDropEvent(async (event) => {
        if (event.payload.type !== "drop") return;
        const pdfs = event.payload.paths.filter((p) => /\.pdf$/i.test(p));
        if (pdfs.length === 0) return;
        const refs = await this.normalise(pdfs);
        if (refs.length > 0) listener(refs);
      }),
    ].map((p) => p.catch((err) => {
      console.warn("Could not listen for open requests:", err);
      return () => {};
    }));
    return () => {
      for (const p of pending) void p.then((unlisten) => unlisten());
    };
  }

  async loadState<T>(key: string): Promise<T | null> {
    const value = await (await this.getStore()).get<T>(key);
    return value ?? null;
  }

  async saveState<T>(key: string, value: T): Promise<void> {
    const store = await this.getStore();
    await store.set(key, value);
    await store.save();
  }

  onCloseRequested(handler: () => Promise<boolean>): () => void {
    const pending = getCurrentWindow()
      .onCloseRequested(async (event) => {
        let close = false;
        try {
          close = await handler();
        } catch (err) {
          // Keep the window, and the user's work, rather than close on an unexpected error.
          console.error("The close check failed:", err);
        }
        if (!close) event.preventDefault();
      })
      .catch((err) => {
        console.warn("Could not listen for the window closing:", err);
        return () => {};
      });
    return () => void pending.then((unlisten) => unlisten());
  }

  async setWindowTitle(title: string): Promise<void> {
    await getCurrentWindow().setTitle(title);
  }

  async openExternal(url: string): Promise<void> {
    await openUrl(url);
  }

  private normalise(paths: string[]): Promise<FileRef[]> {
    return call<FileRef[]>("normalise_paths", { paths });
  }

  /** Loads state.json once. */
  private getStore(): Promise<Store> {
    this.store ??= load(STATE_FILE, { autoSave: false }).catch((err) => {
      this.store = null;
      throw err;
    });
    return this.store;
  }
}
