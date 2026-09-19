// The PDF.js bridge (spec 9). This is the only file that may name PDFViewerApplication or
// reach into the viewer iframe (D7). PDF.js itself is vendored unchanged in public/pdfjs.

import {
  fieldMapFrom,
  hasEffectiveChange,
  isUntouchedAnnotation,
  UNTOUCHED_ANNOTATION,
  type EditorFacts,
  type FieldInfo,
} from './effectiveChange';
import { isReloadKey, shortcutFor } from './shortcutFor';
import type { DocInfo, ExportResult, Viewer, ViewerEvents, ViewState } from './Viewer';
import injectCss from './viewerInject.css?raw';

// Only the PDF.js members this file uses. Checked against 6.3.289, see BUILD-NOTES.md.

interface PdfJsEventBus {
  on(name: string, listener: (event: PdfJsBusEvent) => void): void;
  off(name: string, listener: (event: PdfJsBusEvent) => void): void;
}

interface PdfJsBusEvent { message?: string; }

interface PdfJsAnnotationStorage extends Iterable<[string, unknown]> {
  size: number;
}

interface PdfJsDocument {
  annotationStorage: PdfJsAnnotationStorage;
  isPureXfa: boolean;
  getFieldObjects(): Promise<unknown>;
  getMetadata(): Promise<{ info?: { IsXFAPresent?: unknown } }>;
}

/** Duck typed. An editor is a class instance from the iframe's realm. */
interface PdfJsEditor {
  annotationElementId?: unknown;
  deleted?: unknown;
  isInEditMode?: () => unknown;
  serialize(): unknown;
}

interface PdfJsEditorUIManager {
  getActive(): unknown;
  getMode(): number;
}

interface PdfJsPageViewer {
  currentPageNumber: number;
  currentScaleValue: string;
  pagesRotation: number;
  annotationEditorMode: number;
  _layerProperties?: { annotationEditorUIManager?: PdfJsEditorUIManager | null };
}

interface PdfJsDownloadManager {
  download(data: Uint8Array | undefined): void;
  downloadData(): void;
  openOrDownloadData(): boolean;
}

interface CaptureDownloadManager extends PdfJsDownloadManager {
  onData: ((bytes: Uint8Array) => void) | null;
}

interface PdfJsApp {
  initializedPromise: Promise<void>;
  eventBus: PdfJsEventBus;
  pdfViewer: PdfJsPageViewer;
  pdfDocument: PdfJsDocument | null;
  pdfThumbnailViewer: { hasStructuralChanges?: () => boolean } | null;
  pagesCount: number;
  downloadManager: PdfJsDownloadManager | null;
  download(): Promise<void>;
  downloadOrSave(): Promise<void>;
  open(args: { data: Uint8Array; filename: string }): Promise<void>;
  _annotationStorageModified?: boolean;
  _mergedDocumentNeedsSaving?: boolean;
}

interface PdfJsAppOptions {
  set(name: string, value: unknown): void;
  get(name: string): unknown;
}

interface PdfJsWindow {
  PDFViewerApplication: PdfJsApp;
  PDFViewerApplicationOptions: PdfJsAppOptions;
  addEventListener(type: string, listener: (event: Event) => void, options: { capture: boolean }): void;
  removeEventListener(type: string, listener: (event: Event) => void, options: { capture: boolean }): void;
}

// Spec 9.2. Do not add an option that is not in that table.
const OPTIONS: [string, string | number | boolean][] = [
  ['defaultUrl', ''],
  ['disablePreferences', true],
  ['enableSignatureEditor', true],
  ['enableSplitMerge', true],
  ['enableHighlightFloatingButton', true],
  ['enableXfa', true],
  ['enableScripting', true],
  ['enablePermissions', false],
  ['viewOnLoad', 1],
  ['disableHistory', true],
  ['viewerCssTheme', 0],
  ['annotationEditorMode', 0],
];

const VIEWER_URL = '/pdfjs/web/viewer.html';
/** AnnotationEditorType.INK. The only mode with a drawing session (pdf.mjs `isDrawer`). */
const INK_MODE = 15;
const DIRTY_POLL_MS = 1000;

function applyOptions(options: PdfJsAppOptions): void {
  for (const [name, value] of OPTIONS) {
    try {
      options.set(name, value);
      // AppOptions.set ignores an unknown name or a wrong type without throwing.
      if (options.get(name) !== value) console.warn(`PDF.js option rejected: ${name}`);
    } catch (err) {
      console.warn(`PDF.js option rejected: ${name}`, err);
    }
  }
}

// Spec 9.1 step 1: one listener on the parent document, registered at import time (F1).
// Each mounting iframe waits here until PDF.js reports that its window has loaded.
interface PendingMount {
  iframe: HTMLIFrameElement;
  onLoaded(win: PdfJsWindow): void;
}

const pendingMounts = new Set<PendingMount>();

if (typeof document !== 'undefined') {
  document.addEventListener('webviewerloaded', (event) => {
    const source = (event as CustomEvent<{ source?: unknown }>).detail?.source;
    for (const entry of pendingMounts) {
      if (source !== undefined && entry.iframe.contentWindow === source) {
        pendingMounts.delete(entry);
        entry.onLoaded(source as unknown as PdfJsWindow);
        return;
      }
    }
  });
}

type ListenerMap = { [K in keyof ViewerEvents]: Set<ViewerEvents[K]> };

export class PdfJsViewer implements Viewer {
  private iframe: HTMLIFrameElement | null = null;
  private app: PdfJsApp | null = null;
  private pending: PendingMount | null = null;
  private rejectMount: ((reason: Error) => void) | null = null;
  private destroyed = false;
  private visible = true;
  private dirty = false;
  /** What the loaded file holds for each form widget. Null when unknown or out of date. */
  private baseline: Map<string, FieldInfo> | null = null;
  private pollTimer: number | null = null;
  private busListeners: [string, (event: PdfJsBusEvent) => void][] = [];
  private win: PdfJsWindow | null = null;
  private winListeners: [string, (event: Event) => void][] = [];
  private listeners: ListenerMap = {
    viewchange: new Set(),
    dirtychange: new Set(),
    shortcut: new Set(),
    externallink: new Set(),
    error: new Set(),
  };

  // Spec 9.5: replaces PDF.js's download manager so saved bytes come back to us.
  private readonly capture: CaptureDownloadManager = {
    onData: null,
    download(data: Uint8Array | undefined) { if (data && this.onData) this.onData(data); },
    downloadData() {}, openOrDownloadData() { return false; },
  };

  async mount(container: HTMLElement): Promise<void> {
    if (this.iframe) throw new Error('This viewer is already mounted.');
    if (this.destroyed) throw new Error('This viewer has been destroyed.');

    const iframe = document.createElement('iframe');
    iframe.title = 'PDF viewer';
    iframe.allow = 'fullscreen';
    Object.assign(iframe.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      border: '0',
    });
    this.iframe = iframe;

    const loaded = new Promise<PdfJsWindow>((resolve, reject) => {
      this.rejectMount = reject;
      this.pending = {
        iframe,
        onLoaded: (win) => {
          // Spec 9.1 step 3: synchronously, inside the event. Options set later are ignored.
          applyOptions(win.PDFViewerApplicationOptions);
          resolve(win);
        },
      };
      pendingMounts.add(this.pending);
    });

    iframe.src = VIEWER_URL;
    container.appendChild(iframe);

    const win = await loaded;
    this.pending = null;
    const app = win.PDFViewerApplication;
    await app.initializedPromise;
    if (this.destroyed) throw new Error('This viewer was destroyed while it was mounting.');
    this.rejectMount = null;
    this.app = app;

    app.downloadManager = this.capture;
    this.injectStyle();
    this.forwardEvents(win);
    this.listenOnBus('pagechanging', () => this.emit('viewchange', this.getViewState()));
    this.listenOnBus('scalechanging', () => this.emit('viewchange', this.getViewState()));
    this.listenOnBus('rotationchanging', () => this.emit('viewchange', this.getViewState()));
    this.setVisible(this.visible);
  }

  async load(bytes: Uint8Array, filename: string, view: ViewState | null): Promise<DocInfo> {
    const app = this.requireApp();
    const bus = app.eventBus;
    let onPagesInit: (() => void) | null = null;
    let onError: ((event: PdfJsBusEvent) => void) | null = null;

    const pagesInit = new Promise<void>((resolve, reject) => {
      onPagesInit = () => {
        if (view) this.applyView(view);
        resolve();
      };
      onError = (event) => reject(new Error(event.message || 'The document could not be opened.'));
      bus.on('pagesinit', onPagesInit);
      bus.on('documenterror', onError);
    });

    this.baseline = null;
    try {
      const opened = app.open({ data: bytes.slice(), filename });   // .slice() is required (F4)
      // PDF.js dispatches documenterror before open() rejects, so the first rejection wins.
      await Promise.all([opened, pagesInit]);
    } finally {
      if (onPagesInit) bus.off('pagesinit', onPagesInit);
      if (onError) bus.off('documenterror', onError);
    }

    const doc = app.pdfDocument;
    const baseline = await this.readBaseline(doc);
    if (this.app === app && app.pdfDocument === doc) this.baseline = baseline;
    this.pollDirty();
    return { pageCount: app.pagesCount, isXfa: app.pdfDocument?.isPureXfa === true };
  }

  hasChanges(): boolean {
    const app = this.app;
    if (!app) return false;
    // Spec 9.5, revised 2026-09-19, and chip 7 for the annotation half.
    const annotations = this.annotationsChanged(app);
    const structural = app.pdfThumbnailViewer?.hasStructuralChanges?.() === true;
    const merged = app._mergedDocumentNeedsSaving === true;
    return annotations || structural || merged;
  }

  async exportBytes(): Promise<ExportResult> {
    const app = this.requireApp();
    const capture = this.capture;
    if (!this.hasChanges()) return { mode: 'none' };
    const structural = app.pdfThumbnailViewer?.hasStructuralChanges?.() === true;
    const merged = app._mergedDocumentNeedsSaving === true;
    const viaSave = !structural && (app.pdfDocument?.annotationStorage.size ?? 0) > 0;
    // The file on disk is about to differ from the one PDF.js loaded, and an append save does
    // not reload the viewer. From here until the next load, every stored entry counts.
    this.baseline = null;
    // Declared with `as` so TypeScript does not narrow them to their first values.
    let captured = null as Uint8Array | null;
    let fellBack = false as boolean;
    const originalDownload = app.download;
    capture.onData = b => { captured = b; };
    if (viaSave) app.download = async () => { fellBack = true; };  // F7: here a download IS the failure fallback
    try { await app.downloadOrSave(); }
    finally { app.download = originalDownload; capture.onData = null; }
    if (fellBack || !captured || captured.length === 0) {
      // also covers save() returning early on _saveInProgress, and extractPages giving nothing
      throw new Error('The viewer could not write your changes. Nothing was saved.');
    }
    this.pollDirty();
    return { mode: structural || merged ? 'rewrite' : 'append', bytes: captured };
  }

  getViewState(): ViewState {
    const pdfViewer = this.app?.pdfViewer;
    if (!pdfViewer) return { page: 1, scale: 'auto', rotation: 0 };
    return {
      page: pdfViewer.currentPageNumber,
      scale: String(pdfViewer.currentScaleValue),
      rotation: pdfViewer.pagesRotation,
    };
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.iframe) {
      // Never display: none. PDF.js lays pages out wrongly in a frame with no size (spec 9.1).
      this.iframe.style.visibility = visible ? 'visible' : 'hidden';
      this.iframe.style.pointerEvents = visible ? 'auto' : 'none';
    }
    if (!this.app) return;
    if (visible) {
      if (this.pollTimer === null) {
        this.pollTimer = window.setInterval(() => this.pollDirty(), DIRTY_POLL_MS);
      }
    } else {
      this.stopPolling();
    }
    this.pollDirty();
  }

  print(): void {
    this.iframe?.contentWindow?.print();
  }

  focus(): void {
    this.iframe?.contentWindow?.focus();
  }

  on<K extends keyof ViewerEvents>(event: K, listener: ViewerEvents[K]): () => void {
    const set = this.listeners[event] as Set<ViewerEvents[K]>;
    set.add(listener);
    return () => { set.delete(listener); };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopPolling();
    if (this.pending) {
      pendingMounts.delete(this.pending);
      this.pending = null;
    }
    if (this.rejectMount) {
      this.rejectMount(new Error('This viewer was destroyed while it was mounting.'));
      this.rejectMount = null;
    }
    if (this.app) {
      for (const [name, listener] of this.busListeners) this.app.eventBus.off(name, listener);
      this.capture.onData = null;
    }
    this.busListeners = [];
    for (const [name, listener] of this.winListeners) this.win?.removeEventListener(name, listener, { capture: true });
    this.winListeners = [];
    this.win = null;
    for (const set of Object.values(this.listeners)) set.clear();
    this.iframe?.remove();
    this.iframe = null;
    this.app = null;
  }

  private requireApp(): PdfJsApp {
    if (!this.app) throw new Error('The viewer is not mounted yet.');
    return this.app;
  }

  private emit<K extends keyof ViewerEvents>(event: K, ...args: Parameters<ViewerEvents[K]>): void {
    const set = this.listeners[event] as Set<(...a: Parameters<ViewerEvents[K]>) => void>;
    for (const listener of set) listener(...args);
  }

  private listenOnBus(name: string, listener: (event: PdfJsBusEvent) => void): void {
    this.requireApp().eventBus.on(name, listener);
    this.busListeners.push([name, listener]);
  }

  // Spec 9.6: capture-phase listeners on the iframe's window. The events come from the
  // iframe's realm, so `instanceof` against this window's classes would fail. Duck typing only.
  private forwardEvents(win: PdfJsWindow): void {
    this.win = win;
    const add = (name: string, listener: (event: Event) => void) => {
      win.addEventListener(name, listener, { capture: true });
      this.winListeners.push([name, listener]);
    };
    add('keydown', (event) => {
      const e = event as KeyboardEvent;
      const name = shortcutFor(e);
      if (name) {
        e.preventDefault();
        e.stopPropagation();
        this.emit('shortcut', name);
      } else if (import.meta.env.PROD && isReloadKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    add('click', (event) => {
      const target = event.target as { closest?: (selector: string) => { href?: string } | null } | null;
      const href = target?.closest?.('a[href]')?.href;
      if (typeof href === 'string' && /^(https?|mailto):/i.test(href)) {
        event.preventDefault();
        this.emit('externallink', href);
      }
    });
    const blockFileDrop = (event: Event) => {
      const types = (event as DragEvent).dataTransfer?.types;
      if (types && Array.from(types).includes('Files')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    add('dragover', blockFileDrop);
    add('drop', blockFileDrop);
  }

  // Spec 9.3: rotation, then scale, then page, clamped to the page count.
  private applyView(view: ViewState): void {
    const app = this.requireApp();
    const pdfViewer = app.pdfViewer;
    pdfViewer.pagesRotation = view.rotation;
    pdfViewer.currentScaleValue = view.scale;
    pdfViewer.currentPageNumber = Math.min(Math.max(1, Math.round(view.page)), Math.max(1, app.pagesCount));
  }

  // Spec 9.4. The vendored viewer.html has a CSP meta tag with `style-src 'self'`, which
  // blocks a <style> element. A constructed stylesheet is not inline, so the CSP allows it.
  // It must come from the iframe window's own CSSStyleSheet constructor.
  private injectStyle(): void {
    const win = this.iframe?.contentWindow as (Window & typeof globalThis) | null | undefined;
    const doc = this.iframe?.contentDocument;
    if (!win || !doc) return;
    const sheet = new win.CSSStyleSheet();
    sheet.replaceSync(injectCss);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  }

  /**
   * Chip 7. True when a save would write an annotation change. The modified flag stays the
   * first gate: an append save clears it. Then the rule in effectiveChange.ts drops entries
   * proven to match the loaded file. Where that proof is not available, every entry counts,
   * which is the rule before chip 7.
   */
  private annotationsChanged(app: PdfJsApp): boolean {
    if (app._annotationStorageModified !== true) return false;
    const storage = app.pdfDocument?.annotationStorage;
    if (!storage || storage.size === 0) return false;   // add-then-delete is not a change
    if (!this.baseline || this.mayHoldUncommittedEdit(app)) return true;
    return hasEffectiveChange(storageEntries(storage), this.baseline);
  }

  /**
   * Before it saves, PDF.js commits the active editor and ends an ink drawing session
   * (`downloadOrSave` calls `endCurrentEditing`). Until then that work is not in the storage,
   * so while either may exist the no-op rule is not applied. Leaving ink mode ends the session.
   */
  private mayHoldUncommittedEdit(app: PdfJsApp): boolean {
    const ui = app.pdfViewer._layerProperties?.annotationEditorUIManager;
    if (!ui) return true;
    return ui.getActive() != null || ui.getMode() === INK_MODE || app.pdfViewer.annotationEditorMode === INK_MODE;
  }

  /** The loaded file's form values, or null if they cannot be read. */
  private async readBaseline(doc: PdfJsDocument | null): Promise<Map<string, FieldInfo> | null> {
    if (!doc) return null;
    try {
      const [fieldObjects, metadata] = await Promise.all([doc.getFieldObjects(), doc.getMetadata()]);
      const hasXfa = doc.isPureXfa || metadata.info?.IsXFAPresent !== false;
      return fieldMapFrom(fieldObjects, { hasXfa });
    } catch (err) {
      console.warn('Could not read the form fields. Every form entry will count as a change.', err);
      return null;
    }
  }

  private pollDirty(): void {
    const dirty = this.hasChanges();
    if (dirty !== this.dirty) {
      this.dirty = dirty;
      this.emit('dirtychange', dirty);
    }
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

function isEditor(value: unknown): value is PdfJsEditor {
  return typeof value === 'object' && value !== null
      && typeof (value as { serialize?: unknown }).serialize === 'function';
}

function editorFacts(editor: PdfJsEditor): EditorFacts {
  const inFile = typeof editor.annotationElementId === 'string';
  return {
    annotationElementId: editor.annotationElementId,
    deleted: editor.deleted,
    inEditMode: typeof editor.isInEditMode === 'function' ? editor.isInEditMode() : undefined,
    // A new editor can never count as untouched, so skip its serialisation.
    serialized: inFile ? editor.serialize() : undefined,
  };
}

/** The storage entries, with each untouched annotation editor replaced by the marker. Lazy,
 * so the rule stops reading at the first change. */
function* storageEntries(storage: PdfJsAnnotationStorage): Generator<[string, unknown]> {
  for (const [id, value] of storage) {
    yield [id, isEditor(value) && isUntouchedAnnotation(editorFacts(value)) ? UNTOUCHED_ANNOTATION : value];
  }
}
