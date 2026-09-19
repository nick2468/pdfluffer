import type { FileAdapter } from "./FileAdapter";
import { BrowserFileAdapter } from "./browserFileAdapter";

export async function createFileAdapter(): Promise<FileAdapter> {
  // TODO(chip 6): return the Tauri adapter when '__TAURI_INTERNALS__' in window (spec 8.1).
  const adapter = new BrowserFileAdapter();
  await adapter.init();
  return adapter;
}
