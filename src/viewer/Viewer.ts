// The viewer contract (spec 8.3). Everything outside src/viewer depends only on this file.

export type ShortcutName = 'open' | 'save' | 'saveAs' | 'closeTab' | 'nextTab' | 'prevTab';

export interface ViewState {
  page: number;        // 1-based
  scale: string;       // PDF.js scale value: "auto", "page-width", "page-fit", or "1.25"
  rotation: number;    // 0, 90, 180, 270
}

export interface DocInfo { pageCount: number; isXfa: boolean; }

export type ExportResult =
  | { mode: 'none' }                              // the viewer has nothing new to save
  | { mode: 'append'; bytes: Uint8Array }         // incremental update
  | { mode: 'rewrite'; bytes: Uint8Array };       // whole new file

export interface ViewerEvents {
  viewchange: (view: ViewState) => void;
  dirtychange: (dirty: boolean) => void;
  shortcut: (name: ShortcutName) => void;          // section 11.6
  externallink: (url: string) => void;
  error: (message: string) => void;
}

export interface Viewer {
  /** Create the iframe inside container and wait until PDF.js is ready. */
  mount(container: HTMLElement): Promise<void>;
  /** Load a document. Resolves when pages are laid out and the view state is applied. */
  load(bytes: Uint8Array, filename: string, view: ViewState | null): Promise<DocInfo>;
  /**
   * Commit work the viewer is still holding outside its change store, such as a text box
   * being typed or a drawing in progress. Call it before reading `hasChanges()` for a
   * decision that could lose work: closing a tab, closing the window, or saving.
   */
  commitPendingEdits(): void;
  hasChanges(): boolean;
  exportBytes(): Promise<ExportResult>;
  getViewState(): ViewState;
  setVisible(visible: boolean): void;
  print(): void;
  focus(): void;
  on<K extends keyof ViewerEvents>(event: K, listener: ViewerEvents[K]): () => void;
  destroy(): void;
}
