// The viewer contract (spec 8.3). Everything outside src/viewer depends only on this file.

export type ShortcutName = 'open' | 'save' | 'saveAs' | 'closeTab' | 'nextTab' | 'prevTab';

export interface ViewState {
  page: number;        // 1-based
  scale: string;       // PDF.js scale value: "auto", "page-width", "page-fit", or "1.25"
  rotation: number;    // 0, 90, 180, 270
}

export interface DocInfo { pageCount: number; isXfa: boolean; }

/** Six numbers, PDF's order: a b c d e f. */
export type Matrix = [number, number, number, number, number, number];

/** One page drawn as a picture, for OCR (spec 20.4). */
export interface PageImage {
  bytes: Uint8Array;               // JPEG
  width: number;                   // pixels
  height: number;
  /**
   * PDF.js's viewport transform for this picture: PDF user space, in points, to picture
   * pixels. It already holds the page's /Rotate, its crop box offset and the flip of the
   * y axis, so a caller that inverts it never has to reason about page rotation.
   */
  transform: Matrix;
}

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
  /**
   * Spec 20.4. Draws one page, 1-based, at about 300 dpi, shrunk so its longer side fits
   * inside maxDimension. For OCR only: the picture is read and thrown away.
   */
  renderPageImage(page: number, maxDimension: number): Promise<PageImage>;
  /** Spec 20.4, O5. The page's real text, counted without spaces. */
  pageTextLength(page: number): Promise<number>;
  getViewState(): ViewState;
  setVisible(visible: boolean): void;
  print(): void;
  focus(): void;
  on<K extends keyof ViewerEvents>(event: K, listener: ViewerEvents[K]): () => void;
  destroy(): void;
}
