import type { FileAdapter } from "./FileAdapter";
import { BrowserFileAdapter } from "./browserFileAdapter";
import { TauriFileAdapter, testHookRequested as tauriTestHookRequested } from "./tauriFileAdapter";

export async function createFileAdapter(): Promise<FileAdapter> {
  // Spec 8.1: the Tauri adapter inside the desktop app, the harness adapter in a browser tab.
  if ("__TAURI_INTERNALS__" in window) return new TauriFileAdapter();
  const adapter = new BrowserFileAdapter();
  await adapter.init();
  return adapter;
}

/** Whether the release-build probes asked for the test hook. Never outside the desktop app. */
export async function testHookRequested(): Promise<boolean> {
  return "__TAURI_INTERNALS__" in window ? tauriTestHookRequested() : false;
}
