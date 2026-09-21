// A Viewer test double for unit tests only. It records calls and lets a test drive it.

import type { DocInfo, ExportResult, PageImage, Viewer, ViewerEvents, ViewState } from "./Viewer";

type Listeners = { [K in keyof ViewerEvents]: Set<ViewerEvents[K]> };

export interface FakeLoad { bytes: Uint8Array; filename: string; view: ViewState | null; }

export class FakeViewer implements Viewer {
  mounted = false;
  visible = false;
  destroyed = false;
  focusCount = 0;
  printCount = 0;
  commitCount = 0;
  /** Work held outside hasChanges(), as PDF.js holds a text box that is still being typed. */
  pendingEdit = false;
  readonly loads: FakeLoad[] = [];

  docInfo: DocInfo = { pageCount: 1, isXfa: false };
  loadError: string | null = null;
  nextExport: ExportResult | Error = { mode: "none" };
  viewState: ViewState = { page: 1, scale: "auto", rotation: 0 };
  /** What renderPageImage gives back, whatever the page. */
  pageImage: PageImage = {
    bytes: new Uint8Array([0xff, 0xd8, 0xff]), width: 1200, height: 1600, transform: [2, 0, 0, -2, 0, 1600],
  };
  /** Every renderPageImage call, in order. */
  readonly renders: { page: number; maxDimension: number }[] = [];
  /** Non-space characters on each page, 1-based page n at index n - 1. Missing is 0. */
  textLengths: number[] = [];

  private dirty = false;
  private listeners: Listeners = {
    viewchange: new Set(), dirtychange: new Set(), shortcut: new Set(),
    externallink: new Set(), error: new Set(),
  };

  /** Stores the flag, makes hasChanges() return it, and emits dirtychange. */
  setDirty(dirty: boolean): void {
    this.dirty = dirty;
    this.emit("dirtychange", dirty);
  }

  emit<K extends keyof ViewerEvents>(event: K, ...args: Parameters<ViewerEvents[K]>): void {
    for (const listener of [...this.listeners[event]]) {
      (listener as (...a: Parameters<ViewerEvents[K]>) => void)(...args);
    }
  }

  // Viewer

  async mount(_container: HTMLElement): Promise<void> {
    this.mounted = true;
  }

  async load(bytes: Uint8Array, filename: string, view: ViewState | null): Promise<DocInfo> {
    this.loads.push({ bytes: bytes.slice(), filename, view });
    if (this.loadError !== null) throw new Error(this.loadError);
    // A fresh document has no changes, as PDF.js's new annotation storage has none.
    // No dirtychange event: the manager reads hasChanges() itself after every load.
    this.dirty = false;
    this.pendingEdit = false;
    return { ...this.docInfo };
  }

  commitPendingEdits(): void {
    this.commitCount++;
    if (!this.pendingEdit) return;
    this.pendingEdit = false;
    this.setDirty(true);
  }

  hasChanges(): boolean {
    return this.dirty;
  }

  async exportBytes(): Promise<ExportResult> {
    const result = this.nextExport;
    if (result instanceof Error) throw result;
    if (result.mode !== "none") this.setDirty(false);
    return result;
  }

  async renderPageImage(page: number, maxDimension: number): Promise<PageImage> {
    this.renders.push({ page, maxDimension });
    return this.pageImage;
  }

  async pageTextLength(page: number): Promise<number> {
    return this.textLengths[page - 1] ?? 0;
  }

  getViewState(): ViewState {
    return { ...this.viewState };
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
  }

  print(): void {
    this.printCount++;
  }

  focus(): void {
    this.focusCount++;
  }

  on<K extends keyof ViewerEvents>(event: K, listener: ViewerEvents[K]): () => void {
    this.listeners[event].add(listener);
    return () => { this.listeners[event].delete(listener); };
  }

  destroy(): void {
    this.destroyed = true;
    for (const set of Object.values(this.listeners)) set.clear();
  }
}
