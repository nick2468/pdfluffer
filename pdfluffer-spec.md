# PDFluffer - build spec, desktop app version 1

Status: ready to build. Written 2026-09-19. Covers phases 0 to 2 of `pdfluffer-concept.md`:
the Tauri 2 Windows desktop app. The Chrome and Edge extension gets its own spec later.

Progress is tracked in `pdfluffer-plan.md`. The builder ticks boxes there as it goes.

## 0. How to use this spec

This spec is written for a builder that has none of the context behind it. Follow these rules.

1. Read sections 0 to 8 in full before you write any code. Read the section for a plan item
   before you start that item.
2. Build the plan items in order. Do not start a phase before the previous phase meets its
   acceptance criteria (section 17).
3. This spec makes the design decisions. Do not re-make them. Do not swap a library, change
   the architecture, add a dependency, or change a pinned version.
4. Some facts here were checked against the PDF.js `master` branch on 2026-09-19, not
   against the pinned release. Section 7 lists them. Phase 0 re-checks each one. Where a
   fact turns out wrong, use the named fallback in this spec. If there is no named
   fallback, follow rule 5.
5. **Escalation rule.** If the spec contradicts what you find, or an item fails after three
   honest attempts, stop that item. Write what you found in `BUILD-NOTES.md` under
   "Questions for the user". Then continue with items that do not depend on it. Never
   invent a workaround that changes the design.
6. Never claim an item works unless you ran it and saw it work. Say how you checked.
7. Some checks need a human at a real Windows desktop. They are marked **USER check**.
   List them for the user. Do not tick them yourself.

## 1. What we are building

PDFluffer is one person's PDF reader and light editor for Windows. It exists because
Acrobat and UPDF nag, upsell and watermark. PDFluffer has no ads, no account, no telemetry
and makes no network calls.

Version 1 does this:

- Opens several PDFs in tabs. Reopens the same tabs on the next start.
- Reads, searches, selects and copies text.
- Fills forms. Adds text anywhere. Adds signatures and keeps saved signatures.
- Highlights, draws, inserts images, reorders and deletes pages.
- Saves back to the file. Prints.
- Opens when the user double-clicks a PDF in Windows.
- Phase 2 adds: insert another PDF, rotate pages, flatten, revert, backup.

Almost all PDF work is done by **PDF.js**, Mozilla's open-source PDF engine. PDFluffer hosts
the complete PDF.js viewer app, one copy per tab, inside an `<iframe>`. PDFluffer adds the
window, the tab bar, file handling, session restore and the save rules around it.

## 2. Settled decisions

Do not reopen these. The "why" is here so you can apply them to cases this spec misses.

| # | Decision | Why |
|---|---|---|
| D1 | Personal tool. Never distributed | Any licence works. No code signing. No updater |
| D2 | Desktop shell is **Tauri 2**. Windows 11 only for now | Small installer, real file association, single instance, full file paths |
| D3 | Core is **React + TypeScript + Vite** | One core can serve the desktop app now and the extension later |
| D4 | PDF engine is **PDF.js**, the full viewer app, hosted unmodified in an iframe per tab | Every tool works on day one, including the signature dialog. Lowest risk |
| D5 | Keep PDF.js's own toolbar. Hide only its Open and Download buttons | User ruling 2026-09-19. A custom toolbar can come later behind the same interface |
| D6 | **Never edit any file under `public/pdfjs/`** | Upgrades stay a folder swap. All customising is done from outside (section 9) |
| D7 | **Only `src/viewer/PdfJsViewer.ts` may touch PDF.js objects** | PDF.js internals change between versions. One file holds all the risk |
| D8 | The **document session** owns the file bytes. The viewer only displays | Lets other engines be added later without a refactor (concept, section 5.1) |
| D9 | Save asks once per file, then overwrites | User ruling 2026-09-19 (section 12.3) |
| D10 | The save path knows two modes: `append` and `rewrite` | A rewrite breaks a digital signature. The app must warn first (section 12.4) |
| D11 | PDFluffer stores page, zoom and rotation itself. PDF.js's own view history is turned off | PDF.js keeps one shared history record. Several iframes overwrite each other's entries |
| D12 | No network, ever. No CDN links, no web fonts, no analytics, no update check | The reason the project exists |
| D13 | Follow the Windows light or dark setting. No in-app theme switch | Keeps version 1 small |
| D14 | No new browser gets installed or recommended | User ruling 2026-09-19 |
| D15 | State files carry a `version` number. An unknown version is discarded, not migrated | Keeps version 1 small. There is no old data to protect yet |

## 3. Out of scope

Do not build these, even if they look easy. Several are planned for later specs.

1. The browser extension and any installable web app (PWA).
2. A custom toolbar, custom signature dialog or any re-skin beyond section 9.4.
3. Editing existing text or images in a PDF.
4. Certificate-based digital signing or signature verification. Version 1 only **detects**
   a digital signature (section 12.4).
5. OCR. Converting to Word, Excel or images. Compress. Redaction. Passwords on save.
6. Quick marks (tick, cross, date, initials) and underline, strikeout and sticky notes.
   They need deep PDF.js internals. They get their own spec after version 1 is in daily use.
7. Undo for phase 2 operations. "Revert to saved" is the only safety net (section 13.6).
8. Tab reordering by drag. Tearing a tab into a second window. Multiple windows.
9. Watching files for changes on disk. Unloading idle tabs to save memory.
10. A draft store for unsaved edits. Closing with unsaved edits asks the user (section 12.5).
11. An in-app theme switch, a settings page beyond section 11.5, localisation.
12. Linters, formatters, component test frameworks, state libraries, CSS frameworks, UI kits.
13. Mac and Linux builds.
14. A custom app icon. Use the icons the Tauri scaffold generates.

## 4. Prerequisites

Everything needed is already on this machine (audited 2026-09-19). The builder installs no
toolchain. If a check below fails, stop and tell the user.

| Need | State on 2026-09-19 | Action |
|---|---|---|
| Rust toolchain (stable, MSVC) | Present: rustc 1.98.0 in `%USERPROFILE%\.cargo\bin`. **It is not on the shell PATH.** That is this machine's convention, shared with the sibling Tauri apps Cuber, London and SimpleChess | Put it on the PATH at the start of every command that needs `cargo` or `npm run tauri`. See below |
| Node | 24.19.0 (the machine moved from 20.20.2 to the Node 24 line on 2026-09-19) | None. Create a `.node-version` file saying `24.21.0`, the pin every sibling app uses. Keep Vitest at 4.1 to match them |
| NSIS (the installer builder Tauri uses) | Already fetched by the sibling apps' builds | None |
| Visual Studio 2022 with C++ tools | Present | None |
| WebView2 runtime | Present (153) | None |
| git | Present (2.45) | None |

The PATH setting **does not survive between tool calls**. Prefix every command that needs
Rust. In PowerShell:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
```

In Git Bash:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

The builder's first action is to run `node --version`, then, with the PATH set as above,
`rustc --version` and `cargo --version`. Record the output in `BUILD-NOTES.md`. Stop if
Node is older than 24 or if `rustc` is not found in `.cargo\bin`.

Do not use the `pdfjs-dist` npm package. Its `engines` field demands Node 22.13, and it does
not contain the viewer app anyway (section 5).

## 5. Tech stack and allowed dependencies

Pinned. Use exactly these. For anything the scaffold adds by itself (React, Vite,
TypeScript, `@vitejs/plugin-react`), keep the version the scaffold chose.

| Package | Version | Use |
|---|---|---|
| PDF.js viewer, prebuilt | **6.3.289** (release zip, not npm) | The viewer in each tab. Section 6.2 |
| `@cantoo/pdf-lib` | **2.11.1** | Phase 2 operations. A maintained fork of pdf-lib |
| `@tauri-apps/cli` | 2.x, latest at scaffold time | Build tool |
| `@tauri-apps/api` | 2.x | Tauri JavaScript API |
| `@tauri-apps/plugin-dialog` | 2.x | Open and Save dialogs |
| `@tauri-apps/plugin-store` | 2.x | State file in the app data folder |
| `@tauri-apps/plugin-window-state` | 2.x | Remembers window size and position |
| `@tauri-apps/plugin-opener` | 2.x | Opens web links in the system browser |
| `idb-keyval` | latest | Browser development harness only (section 8.2) |
| `vitest` | **^4.1.11** | Unit tests. The same version the sibling apps use. **Not 5.x**, which refuses Node 20 |

Rust crates: `tauri`, `tauri-build`, `tauri-plugin-single-instance`,
`tauri-plugin-dialog`, `tauri-plugin-store`, `tauri-plugin-window-state`,
`tauri-plugin-opener`, `serde`, `serde_json`, `dunce`, `percent-encoding`.

**No other dependency may be added.** If you believe one is needed, follow the escalation
rule. Do not use the `pdfjs-dist` npm package. It does not contain the viewer app.

## 6. Repository layout

### 6.1 Files

```
pdfluffer/
  CLAUDE.md                  rules for every session in this repo
  pdfluffer-concept.md       background. Read-only for the builder
  pdfluffer-spec.md          this file. Read-only for the builder
  pdfluffer-plan.md          checkboxes. The builder ticks them
  BUILD-NOTES.md             the builder's log (section 18)
  VENDOR-PDFJS.md            version, source URL and SHA-256 of the PDF.js zip
  .gitignore
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  public/
    pdfjs/                   the unpacked PDF.js zip. NEVER EDITED (D6)
      build/  web/  LICENSE
  samples/                   small generated test PDFs. Committed
  samples-private/           the user's real PDFs. Git-ignored. Never committed
  scripts/
    make-samples.ts          generates samples/ with @cantoo/pdf-lib
  src/
    main.tsx
    app/                     React components: App, TabBar, AppMenu, dialogs, panels
    session/                 DocumentSession, SessionManager, state schemas, decideSave
    viewer/                  Viewer.ts (interface), PdfJsViewer.ts (the only PDF.js code),
                             viewerInject.css
    files/                   FileAdapter.ts, tauriFileAdapter.ts, browserFileAdapter.ts,
                             fakeFileAdapter.ts (tests)
    engine/                  phase 2: EngineAdapter.ts, engineRegistry.ts, pdfLibAdapter.ts
    tools/                   phase 2: toolRegistry.ts and tool definitions
    util/                    hasDigitalSignature.ts and other pure helpers
  src-tauri/
    Cargo.toml  tauri.conf.json  build.rs
    capabilities/default.json
    src/main.rs  src/lib.rs
```

Tests sit beside the code as `*.test.ts`.

### 6.2 Vendoring PDF.js

1. Get `pdfjs-6.3.289-dist.zip` from
   `https://github.com/mozilla/pdf.js/releases/download/v6.3.289/pdfjs-6.3.289-dist.zip`.
   Use the normal build, not the `legacy` one. If that asset name does not exist, read the
   release page for v6.3.289 and use the matching non-legacy `dist` zip.
2. Unpack it so that `public/pdfjs/web/viewer.html` and `public/pdfjs/build/pdf.mjs` exist.
   If `web/viewer.html` is missing, you have the wrong file. Stop.
3. Write `VENDOR-PDFJS.md`: version, URL, download date, SHA-256 of the zip.
4. Commit the folder unchanged. Do not delete the sample PDF, locales or anything else.

### 6.3 `.gitignore`

```
node_modules/
dist/
src-tauri/target/
src-tauri/gen/
samples-private/
*.pdfluffer-tmp
```

## 7. Facts about PDF.js that this design relies on

Checked against `mozilla/pdf.js` `master` on 2026-09-19. Phase 0 re-checks each against the
vendored 6.3.289 files by searching `public/pdfjs/web/viewer.mjs`. Record each result in
`BUILD-NOTES.md` under "Verified facts" as F1 to F10, confirmed or different.

| # | Fact | Where it was seen |
|---|---|---|
| F1 | When the viewer loads, it dispatches a `webviewerloaded` event on **`parent.document`**. `event.detail.source` is the iframe's `window` | `web/viewer.js` |
| F2 | The viewer sets three globals on its window: `PDFViewerApplication`, `PDFViewerApplicationOptions`, `PDFViewerApplicationConstants` | `web/viewer.js` |
| F3 | In the public build these options default to **off**: `enableSignatureEditor`, `enableSplitMerge` (page organising), `enableHighlightFloatingButton`. `defaultUrl` defaults to a sample PDF. `disablePreferences` defaults to off | `web/app_options.js` |
| F4 | `PDFViewerApplication.open({ data, filename })` opens a PDF from bytes. It **transfers** the buffer to a worker, so the caller's array becomes empty. Always pass a copy | `web/app.js` |
| F5 | `PDFViewerApplication.initializedPromise` resolves when the viewer is ready for `open` | `web/app.js` |
| F6 | `downloadOrSave()` has three branches. Page changes: `pdfDocument.extractPages(...)`, a full rewrite. Form or annotation changes: `pdfDocument.saveDocument()`, an incremental update. No changes: `pdfDocument.getData()`. Every branch ends in `this.downloadManager.download(data, url, filename)` | `web/app.js` |
| F7 | **Hazard.** If `saveDocument()` throws, `save()` logs the error and silently falls back to `this.download()`, which hands out the **original** bytes. A naive integration would report success and lose the user's edits | `web/app.js` |
| F8 | Unsaved-change signals: `PDFViewerApplication._annotationStorageModified === true` (set on change, deleted after a save), `pdfThumbnailViewer.hasStructuralChanges()`, `_mergedDocumentNeedsSaving === true` | `web/app.js` |
| F9 | localStorage keys: `pdfjs.preferences`, `pdfjs.signature` (saved signatures, at most 5), `pdfjs.history` (view history) | `web/genericcom.js`, `web/generic_signature_storage.js` |
| F10 | Event bus names: `documentloaded`, `documentinit`, `pagesinit`, `documenterror`, `pagechanging`, `scalechanging`, `rotationchanging` | `web/app.js`, `web/pdf_viewer.js` |

## 8. Core interfaces

Create these files first. Later code depends only on these interfaces.

### 8.1 `src/files/FileAdapter.ts`

A **file reference** (`FileRef`) is an opaque string that a file adapter can turn back into
a file. In the Tauri app it is the absolute, normalised Windows path. In the browser
harness it is `mem:<uuid>`. Only file adapters look inside a `FileRef`.

```ts
export type FileRef = string;

export interface OpenedFile {
  ref: FileRef;
  name: string;          // file name with extension, for the tab label
  bytes: Uint8Array;
}

export type FileErrorCode = 'not-found' | 'not-pdf' | 'locked' | 'io';

export class FileError extends Error {
  constructor(public code: FileErrorCode, message: string) { super(message); }
}

export interface WriteOptions { keepBackup: boolean; }

export interface FileAdapter {
  /** Show the Open dialog. Multi-select, PDF filter. Empty array if cancelled. */
  pickFiles(): Promise<FileRef[]>;
  /** Read a file. Throws FileError. */
  readFile(ref: FileRef): Promise<OpenedFile>;
  /** Write bytes over the file. Must be atomic (section 10.3). Throws FileError. */
  writeFile(ref: FileRef, bytes: Uint8Array, options: WriteOptions): Promise<void>;
  /** Show the Save As dialog. Null if cancelled. The result always ends in .pdf. */
  pickSaveTarget(suggestedName: string, near: FileRef | null): Promise<FileRef | null>;
  nameOf(ref: FileRef): string;        // "form.pdf"
  describe(ref: FileRef): string;      // full path, for tooltips
  sameFile(a: FileRef, b: FileRef): boolean;   // case-insensitive on Windows

  /** Files the operating system asked us to open at launch. Returns them once. */
  takePendingOpenRequests(): Promise<FileRef[]>;
  /** Files the OS asks us to open while running: second launch, drag and drop. */
  onOpenRequest(listener: (refs: FileRef[]) => void): () => void;

  loadState<T>(key: string): Promise<T | null>;
  saveState<T>(key: string, value: T): Promise<void>;

  /** Called when the user tries to close the window. Resolve false to keep it open. */
  onCloseRequested(handler: () => Promise<boolean>): () => void;
  setWindowTitle(title: string): Promise<void>;
  openExternal(url: string): Promise<void>;
}
```

`src/files/index.ts` exports `createFileAdapter()`. It returns the Tauri adapter when
`'__TAURI_INTERNALS__' in window`, otherwise the browser adapter.

### 8.2 The three adapters

- **`tauriFileAdapter.ts`** - the product. Section 10 defines the Rust side it calls.
- **`browserFileAdapter.ts`** - the development harness only. It lets `npm run dev` run in
  an ordinary browser tab so behaviour can be checked without a Tauri window. It keeps
  virtual files in IndexedDB through `idb-keyval`: key `file:<uuid>`, value
  `{ name, bytes }`. `pickFiles` uses a hidden `<input type="file" multiple accept=".pdf">`
  and stores each chosen file as a new virtual file. `writeFile` replaces the stored bytes.
  `pickSaveTarget` asks for a name with `window.prompt` and creates a new virtual file.
  `loadState` and `saveState` use localStorage keys `pdfluffer.state.<key>`.
  `takePendingOpenRequests` returns `[]`. `onCloseRequested` uses `beforeunload`.
  `openExternal` uses `window.open(url, '_blank', 'noopener')`.
- **`fakeFileAdapter.ts`** - unit tests only. An in-memory `Map`. It can be told to throw a
  given `FileError` for a given ref.

### 8.3 `src/viewer/Viewer.ts`

```ts
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
  hasChanges(): boolean;
  exportBytes(): Promise<ExportResult>;
  getViewState(): ViewState;
  setVisible(visible: boolean): void;
  print(): void;
  focus(): void;
  on<K extends keyof ViewerEvents>(event: K, listener: ViewerEvents[K]): () => void;
  destroy(): void;
}
```

### 8.4 `src/session/DocumentSession.ts`

One `DocumentSession` per tab. It owns the bytes (D8).

```ts
export type TabStatus = 'unloaded' | 'loading' | 'ready' | 'not-found' | 'error';

export interface TabSnapshot {
  id: string;                  // crypto.randomUUID()
  ref: FileRef;
  name: string;
  status: TabStatus;
  errorMessage: string | null;
  dirty: boolean;              // viewer has changes OR pendingEngineChanges
  hasDigitalSignature: boolean;
  isXfa: boolean;
  xfaBannerDismissed: boolean;
  saveConfirmed: boolean;      // D9: the user already chose Overwrite for this tab
}
```

Private fields: `bytes: Uint8Array | null`, `viewer: Viewer | null`, `view: ViewState | null`,
`pendingEngineChanges: boolean`, `rewriteAcknowledged: boolean`.

### 8.5 `src/session/SessionManager.ts`

A plain TypeScript class. No React inside it. React reads it through one hook,
`useSession()`, built on `useSyncExternalStore`.

```ts
export interface SessionSnapshot { tabs: TabSnapshot[]; activeTabId: string | null; }

export class SessionManager {
  constructor(files: FileAdapter, createViewer: () => Viewer, dialogs: Dialogs);
  subscribe(listener: () => void): () => void;
  getSnapshot(): SessionSnapshot;          // returns a new object only when something changed

  start(): Promise<void>;                  // section 12.6
  openRefs(refs: FileRef[]): Promise<void>;
  openWithDialog(): Promise<void>;
  activate(tabId: string): Promise<void>;
  closeTab(tabId: string): Promise<boolean>;      // false if the user cancelled
  save(tabId: string): Promise<boolean>;
  saveAs(tabId: string): Promise<boolean>;
  revert(tabId: string): Promise<void>;           // phase 2
  locate(tabId: string): Promise<void>;           // for a 'not-found' tab
  confirmCloseAll(): Promise<boolean>;
  setViewerHost(el: HTMLElement | null): void;
  handleShortcut(name: ShortcutName): Promise<void>;   // section 11.6
  dismissXfaBanner(tabId: string): void;
  getSettings(): SettingsV1;
  updateSettings(patch: Partial<Omit<SettingsV1, 'version'>>): void;
  getRecent(): HistoryStateV1['items'];                // first 15
  clearHistory(): void;
}
```

`setViewerHost` replaced a per-tab `attachContainer` on 2026-09-19. Every viewer mounts its
iframe into the **one** shared host element (section 9.1 stacks them there anyway). If a tab
is activated while the host is null, its load waits until the host is set.

`Dialogs` is an interface with one method, so tests can fake it:

```ts
export interface DialogButton { id: string; label: string; kind?: 'primary' | 'danger'; }
export interface Dialogs {
  ask(title: string, body: string, buttons: DialogButton[]): Promise<string>; // returns id
}
```

### 8.6 State schemas

All state goes through `FileAdapter.loadState` and `saveState`. Three keys.

```ts
// key "session"
interface SessionStateV1 {
  version: 1;
  tabs: { id: string; ref: FileRef; name: string; saveConfirmed: boolean }[];
  activeTabId: string | null;
}

// key "history" - one list serves both the Recent menu and per-file view memory
interface HistoryStateV1 {
  version: 1;
  items: { ref: FileRef; name: string; lastOpened: string; view: ViewState | null }[];
}   // newest first. At most 100 items. The Recent menu shows the first 15.

// key "settings"
interface SettingsV1 { version: 1; restoreSession: boolean; keepBackup: boolean; }
// defaults: restoreSession true, keepBackup false
```

Rules: if a stored value is missing, not an object, or has a `version` other than 1, use
the default and log one `console.warn` (D15). Write `session` and `history` 500 ms after
the last change (debounce). Also write both at once when the window is about to close.

## 9. The PDF.js bridge: `src/viewer/PdfJsViewer.ts`

This file implements `Viewer`. It is the only file that may name `PDFViewerApplication` or
reach into the iframe (D7). Type the PDF.js objects with a small local interface that lists
only the members used. Do not use `any` outside this file.

### 9.1 Mounting

1. Register **one** module-level listener for `webviewerloaded` on `document` when the
   module is first imported. This must exist before any iframe is created (F1).
2. `mount` creates `<iframe src="/pdfjs/web/viewer.html" title="PDF viewer" allow="fullscreen">`,
   adds it to the container, and waits for the `webviewerloaded` event whose
   `event.detail.source === iframe.contentWindow`.
3. Inside that event, **synchronously**, set the options in section 9.2 on
   `source.PDFViewerApplicationOptions`. Options set later are ignored.
4. Await `source.PDFViewerApplication.initializedPromise` (F5).
5. Replace the download manager (section 9.5). Inject the stylesheet (9.4). Install the
   event forwarders (9.6).

All iframes are stacked in one container with `position: absolute; inset: 0`. `setVisible`
switches `visibility` between `visible` and `hidden`, plus `pointer-events`. **Never use
`display: none`.** PDF.js lays pages out wrongly when its frame has no size.

### 9.2 Options to set

Call `PDFViewerApplicationOptions.set(name, value)` for each row, each in its own
`try/catch`. If a name is rejected, log it and record it in `BUILD-NOTES.md`. Do not set
any option that is not in this table.

| Option | Value | Why |
|---|---|---|
| `defaultUrl` | `""` | Stops the sample PDF loading (F3) |
| `disablePreferences` | `true` | PDFluffer's options always win |
| `enableSignatureEditor` | `true` | Off by default in the public build (F3). Core requirement |
| `enableSplitMerge` | `true` | Page reorder, delete, copy, export (F3) |
| `enableHighlightFloatingButton` | `true` | Highlight button appears on text selection |
| `enableXfa` | `true` | XFA forms render where PDF.js can (section 12.7) |
| `enableScripting` | `true` | Form calculations |
| `enablePermissions` | `false` | A personal tool does not enforce copy restrictions |
| `viewOnLoad` | `1` | 1 means "initial view". PDFluffer restores the view itself (D11) |
| `disableHistory` | `true` | No browser history entries from inside the iframe |
| `viewerCssTheme` | `0` | 0 means follow the system (D13) |
| `annotationEditorMode` | `0` | Editing tools available, none selected |

### 9.3 Loading a document

```ts
await app.open({ data: bytes.slice(), filename });   // .slice() is required (F4)
```

Apply the view state on the event bus `pagesinit` event, in this order: rotation, scale,
page. Clamp `page` to `1..pagesCount`. If `view` is null, do nothing and let PDF.js choose.
Resolve `load` with `{ pageCount: app.pagesCount, isXfa: app.pdfDocument.isPureXfa === true }`.
On the event bus `documenterror` event, reject `load` with the message.

Subscribe to `pagechanging`, `scalechanging` and `rotationchanging`. On each, emit
`viewchange` with `getViewState()`, which reads `app.pdfViewer.currentPageNumber`,
`app.pdfViewer.currentScaleValue` and `app.pdfViewer.pagesRotation`.

Password-protected files: PDF.js shows its own password box inside the iframe. Do nothing
extra. Never store a password.

### 9.4 Styling from outside

`src/viewer/viewerInject.css` is imported as a string (`?raw`) and applied as a
**constructed stylesheet**: build a `CSSStyleSheet` with the iframe window's own
constructor, call `replaceSync(css)`, and append it to the iframe document's
`adoptedStyleSheets`. Do **not** use a `<style>` element. The vendored `viewer.html` carries
its own CSP meta tag with `style-src 'self'`, which blocks inline styles. A constructed
stylesheet is not inline, so it is allowed (found and proven in chip 2, ratified
2026-09-19). That meta CSP applies inside the Tauri window too, on top of `tauri.conf.json`.
The stylesheet may only hide elements. Hide PDF.js's own
**Open file** and **Download/Save** buttons, in both the main toolbar and the secondary
(overflow) menu, and the **current view / bookmark** link if present. Find the real element
ids in `public/pdfjs/web/viewer.html`. Expected ids, to be confirmed: `secondaryOpenFile`,
`downloadButton`, `secondaryDownload`, `viewBookmark`. Record the ids you used in
`BUILD-NOTES.md`. Keep Print, Find, zoom, the sidebar and every editing tool visible.

### 9.5 Exporting bytes safely

Replace the download manager once, after step 4 of mounting:

```ts
const capture = {
  onData: null as ((bytes: Uint8Array) => void) | null,
  download(data: Uint8Array | undefined) { if (data && this.onData) this.onData(data); },
  downloadData() {}, openOrDownloadData() { return false; },
};
app.downloadManager = capture;
```

`hasChanges()` is defined from three signals (F8). Revised 2026-09-19 after chip 1's fact
check, which showed `downloadOrSave()` calls `download()` legitimately when the annotation
storage is empty:

```ts
hasChanges(): boolean {
  const annotations = app._annotationStorageModified === true
                   && app.pdfDocument?.annotationStorage.size > 0;   // add-then-delete is not a change
  const structural = app.pdfThumbnailViewer?.hasStructuralChanges?.() === true;
  const merged = app._mergedDocumentNeedsSaving === true;
  return annotations || structural || merged;
}
```

`exportBytes()` must guard against the hazard in F7. `download()` counts as a failure
**only in the branch where `downloadOrSave()` would call `save()`**, because only there is
`download()` a fallback:

```ts
async exportBytes(): Promise<ExportResult> {
  if (!this.hasChanges()) return { mode: 'none' };
  const structural = app.pdfThumbnailViewer?.hasStructuralChanges?.() === true;
  const merged = app._mergedDocumentNeedsSaving === true;
  const viaSave = !structural && app.pdfDocument.annotationStorage.size > 0;
  let captured: Uint8Array | null = null;
  let fellBack = false;
  const originalDownload = app.download;
  capture.onData = b => { captured = b; };
  if (viaSave) app.download = async () => { fellBack = true; };  // F7: here a download IS the failure fallback
  try { await app.downloadOrSave(); }
  finally { app.download = originalDownload; capture.onData = null; }
  if (fellBack || !captured || captured.length === 0) {
    // also covers save() returning early on _saveInProgress, and extractPages giving nothing
    throw new Error('The viewer could not write your changes. Nothing was saved.');
  }
  return { mode: structural || merged ? 'rewrite' : 'append', bytes: captured };
}
```

**Dirty signal.** Poll `hasChanges()` every 1000 ms while the tab is visible, and once when
it is hidden. Emit `dirtychange` only when the value flips. Clear the timer in `destroy`.

**Named fallback B.** Phase 0 checks that `hasChanges()` returns to false after a
successful append-mode export. If it does not in 6.3.289, then after **every** successful
save the session must call `viewer.load(savedBytes, name, currentView)` again, and
`hasChanges()` must be defined as `app._hasChanges()`. Record the choice in `BUILD-NOTES.md`.

### 9.6 Event forwarders inside the iframe

Add these listeners to the iframe's `window`, all with `{ capture: true }`.

1. **keydown.** For each shortcut in section 11.6, call `preventDefault()` and
   `stopPropagation()`, then emit `shortcut`. This stops PDF.js's own Ctrl+S and Ctrl+O.
   In production builds (`import.meta.env.PROD`) also swallow F5, Ctrl+R and Ctrl+Shift+R,
   because a reload loses unsaved edits. Let every other key through.
2. **click.** If the target is inside an `<a>` whose `href` starts with `http:`, `https:` or
   `mailto:`, call `preventDefault()` and emit `externallink` with the URL.
3. **dragover and drop.** Call `preventDefault()` and `stopPropagation()` **only when the
   drag carries files** (`event.dataTransfer?.types` includes `"Files"`). This stops PDF.js
   opening a dropped file inside the tab, which would bypass the session. Drags without
   files must pass through, because PDF.js may use them to reorder page thumbnails.

`print()` calls `iframe.contentWindow.print()`. PDF.js replaces that function with its own
print routine. `focus()` calls `iframe.contentWindow.focus()`.

## 10. The Tauri host: `src-tauri/`

### 10.1 Scaffolding

Scaffold in a scratch folder, then move files up, because the repo folder is not empty.

1. Try: `npm create tauri-app@latest scaffold-tmp -- --template react-ts --manager npm --yes`.
2. If that prompts or fails, use the fallback. `npm create vite@latest scaffold-tmp -- --template react-ts`,
   then inside it `npm install -D @tauri-apps/cli` and `npx tauri init --ci` with
   `--app-name PDFluffer --window-title PDFluffer --frontend-dist ../dist --dev-url http://localhost:1420 --before-dev-command "npm run dev" --before-build-command "npm run build"`.
3. Move the scaffold's files into the repo root. Do not overwrite the `.md` files.
   Delete `scaffold-tmp`. Remove the scaffold's demo component, demo command and demo assets.
4. Set the Vite dev server to port 1420 with `strictPort: true`.

### 10.2 `tauri.conf.json` - required values

```json
{
  "productName": "PDFluffer",
  "identifier": "com.pdfluffer.desktop",
  "app": {
    "windows": [{
      "label": "main", "title": "PDFluffer",
      "width": 1200, "height": 850, "minWidth": 600, "minHeight": 400,
      "dragDropEnabled": true
    }],
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self' blob: data: ipc: http://ipc.localhost; frame-src 'self'; object-src 'none'"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "fileAssociations": [{
      "ext": ["pdf"], "name": "PDF Document", "description": "PDF Document",
      "role": "Editor", "mimeType": "application/pdf"
    }],
    "windows": { "nsis": { "installMode": "currentUser" } }
  }
}
```

The CSP (content security policy) is the browser rule set that says what the page may load.
It lists **no remote origin**, which enforces D12. It is a starting point. In phase 0, open
the developer tools in `tauri dev` and watch for CSP errors. Add only the narrowest source
that fixes a real error, never a remote one, and record the change.

### 10.3 Rust commands, in `src/lib.rs`

| Command | Signature | Behaviour |
|---|---|---|
| `read_pdf` | `(path: String) -> Result<tauri::ipc::Response, String>` | Refuse a path whose extension is not `pdf` (any case): `Err("not-pdf")`. Missing file: `Err("not-found")`. Other failure: `Err("io: <detail>")`. Success: `Response::new(bytes)`, which reaches JavaScript as an `ArrayBuffer` |
| `write_pdf` | `(request: tauri::ipc::Request) -> Result<(), String>` | The body is raw bytes (`InvokeBody::Raw`). Header `x-path` holds the target path, percent-encoded UTF-8. Header `x-backup` is `1` or absent. Refuse a non-`pdf` extension. See the write steps below |
| `normalise_paths` | `(paths: Vec<String>) -> Vec<String>` | For each path: `dunce::canonicalize`. If the file does not exist yet, canonicalise the parent folder and re-attach the file name. Drop paths that cannot be resolved |
| `take_pending_files` | `(state) -> Vec<String>` | Return and clear the pending list |

**`write_pdf` steps.** (1) If `x-backup` is `1`, the target exists, and
`<stem>.backup.pdf` does not exist, copy the target to `<stem>.backup.pdf`. (2) Write the
bytes to `<target>.pdfluffer-tmp` and flush. (3) `std::fs::rename` the temporary file over
the target. (4) On any failure delete the temporary file and return `Err`. A sharing
violation or permission error returns `Err("locked")`. The original file must be unchanged
after any failure.

JavaScript calls it like this:

```ts
await invoke('write_pdf', bytes, {
  headers: { 'x-path': encodeURIComponent(path), ...(keepBackup ? { 'x-backup': '1' } : {}) },
});
```

`tauriFileAdapter` maps the error strings to `FileError` codes. `pickFiles` and
`pickSaveTarget` use `@tauri-apps/plugin-dialog` with the filter
`{ name: 'PDF', extensions: ['pdf'] }`, then pass results through `normalise_paths`.
`pickSaveTarget` sets `defaultPath` to the folder of `near` plus the suggested name, and
appends `.pdf` if the user left it off. `sameFile` compares lower-cased strings.
`loadState` and `saveState` use `@tauri-apps/plugin-store` with the file `state.json`.

### 10.4 Launch arguments and single instance

Write one pure function, `parse_pdf_args(args: &[String], cwd: &Path) -> Vec<String>`. It
skips the first argument (the exe), ignores arguments that start with `-`, resolves
relative paths against `cwd`, keeps only existing files with a `pdf` extension (any case),
and normalises them as `normalise_paths` does. Cover it with `cargo test`.

Startup order in `run()`:

1. Register `tauri_plugin_single_instance` **first**. Tauri requires that. Its callback
   runs in the already-running app when a second launch happens. In it: run
   `parse_pdf_args` on the received `args` and `cwd`, `app.emit("open-files", paths)`, then
   un-minimise and focus the `main` window.
2. Register the other plugins: window-state, dialog, store, opener.
3. `.manage(PendingFiles(Mutex::new(vec)))` where `vec` is `parse_pdf_args` of this
   process's own `std::env::args()`.
4. Register the four commands.

`tauriFileAdapter.onOpenRequest` listens to the `open-files` event **and** to
`getCurrentWebview().onDragDropEvent`. For a payload of type `drop`, it keeps paths ending
in `.pdf`, normalises them, and calls the listener.

### 10.5 `capabilities/default.json`

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-destroy",
    "core:window:allow-set-title",
    "core:window:allow-set-focus",
    "dialog:allow-open",
    "dialog:allow-save",
    "store:default",
    "window-state:default",
    "opener:allow-open-url"
  ]
}
```

If the build rejects a permission name, the error lists the valid names. Use the closest
one and record it. Do not add the `fs` plugin. The four commands replace it.

`onCloseRequested` in the adapter uses `getCurrentWindow().onCloseRequested`. If the
handler resolves false, call `event.preventDefault()`.

## 11. The app frame

### 11.1 Layout

```
+--------------------------------------------------------------------------+
| [form.pdf * x] [lease.pdf  Signed x] [+]                       [Save] [=] |  tab bar, 40px
+--------------------------------------------------------------------------+
| (banner row, only when needed: XFA notice)                                |
+--------------------------------------------------------------------------+
|                                                                          |
|   the active tab's PDF.js iframe, filling the rest of the window          |
|                                                                          |
+--------------------------------------------------------------------------+
```

Plain CSS in `src/app/app.css`. Colours come from CSS variables with a
`@media (prefers-color-scheme: dark)` block (D13). Use the system font stack
(`"Segoe UI", system-ui, sans-serif`). No web fonts, no icon fonts. Icons are inline SVG or
plain text characters.

### 11.2 Tab bar

- One tab per open file, in open order. No wrapping. The strip scrolls sideways when full.
- Tab content: file name (ellipsis, at most 220px), a dot when `dirty`, a small `Signed`
  chip when `hasDigitalSignature`, a close button.
- Tooltip: `files.describe(ref)`. The `Signed` chip tooltip: "This PDF carries a digital
  signature. A change that rewrites the file will break it. PDFluffer warns you first."
- Click activates. Middle-click closes. The `+` button runs `openWithDialog()`.
- The `Save` button is enabled only when the active tab is dirty.
- `[=]` opens the app menu.

### 11.3 App menu

Open... (Ctrl+O) / Recent (submenu, up to 15, greyed "No recent files" when empty) /
Save (Ctrl+S) / Save As... (Ctrl+Shift+S) / Print... (Ctrl+P) / Close tab (Ctrl+W) /
separator / **Document** submenu (phase 2, built from the tool registry) /
Revert to saved (phase 2) / separator / Settings... / Clear history... / About PDFluffer.

Items that need an active `ready` tab are disabled without one.

### 11.4 Panels that replace the iframe

| Tab status | Panel |
|---|---|
| no tabs at all | Empty state: the name "PDFluffer", an "Open a PDF" button, and the Recent list |
| `loading` | "Opening <name>..." |
| `not-found` | "File not found", the full path, buttons **Locate...** and **Close tab** |
| `error` | "PDFluffer could not open this file", the message, button **Close tab** |

### 11.5 Dialogs and Settings

One reusable `ChoiceDialog` built on the HTML `<dialog>` element with `showModal()`. The
`Dialogs.ask` service (section 8.5) drives it. Escape means the button with id `cancel`.

Settings dialog: two checkboxes. "Reopen my files when PDFluffer starts" (`restoreSession`).
"Keep a backup of the original the first time I overwrite it" (`keepBackup`, phase 2. Hide
this checkbox until phase 2).

"Clear history..." confirms, then empties `history`. It does not close open tabs.
About shows the app version, the PDF.js version, and "No ads. No account. No network."

### 11.6 Keyboard shortcuts

Focus usually sits inside an iframe, so shortcuts must work from both places. Handle them
in one function, `handleShortcut(name)`. Call it from a `keydown` listener on the parent
`window` and from the viewer's `shortcut` event (section 9.6).

| Keys | `ShortcutName` | Action |
|---|---|---|
| Ctrl+O | `open` | `openWithDialog()` |
| Ctrl+S | `save` | `save(active)` |
| Ctrl+Shift+S | `saveAs` | `saveAs(active)` |
| Ctrl+W | `closeTab` | `closeTab(active)` |
| Ctrl+Tab | `nextTab` | activate the tab to the right, wrapping |
| Ctrl+Shift+Tab | `prevTab` | activate the tab to the left, wrapping |

Ctrl+P, Ctrl+F, Ctrl+Z, Ctrl+C and every other key belong to PDF.js. Do not intercept them.

### 11.7 Window title

`<active tab name> - PDFluffer`, with ` *` after the name when dirty. `PDFluffer` with no tabs.

## 12. Behaviours

### 12.1 Opening files

`openRefs(refs)` for each ref, in order: if an open tab has the same file
(`files.sameFile`), skip creating one. Otherwise add a tab with status `unloaded`. Then
activate the tab for the **last** ref. Update `history`: move or insert the item to the
front with `lastOpened` set to now, then trim to 100.

### 12.2 Activating a tab and lazy loading

`activate(tabId)`:

1. Hide the previously active viewer with `setVisible(false)`. Keep it alive.
2. If the tab is `unloaded`: set `loading`, call `files.readFile(ref)`.
   - `FileError('not-found')`: status `not-found`. Stop.
   - any other error: status `error` with the message. Stop.
   - success: keep `bytes`, set `hasDigitalSignature` (section 12.4), create and mount a
     viewer, call `load(bytes, name, view)` where `view` is the `history` item's `view` for
     this ref or null. Set `isXfa`. Status `ready`.
3. Show the viewer and focus it.

A tab's viewer is created only when the tab is first activated. This keeps start fast.

### 12.3 Saving: ask once, then overwrite (D9)

Put the decision in a **pure function** so it can be unit tested:

```ts
export type SaveStep = 'nothing-to-save' | 'guard-signature' | 'ask-first-save' | 'write';
export function decideSave(input: {
  dirty: boolean; mode: 'none' | 'append' | 'rewrite';
  hasDigitalSignature: boolean; rewriteAcknowledged: boolean; saveConfirmed: boolean;
}): SaveStep;
```

Order of checks: not dirty gives `nothing-to-save`. A `rewrite` on a signed file that is
not yet acknowledged gives `guard-signature`. Not `saveConfirmed` gives `ask-first-save`.
Otherwise `write`. Treat `pendingEngineChanges` as `rewrite` mode.

`save(tabId)`:

1. `result = await viewer.exportBytes()`. If it throws, show the message in a dialog and
   return false. **Write nothing.**
2. If `result.mode` is not `none`, set `session.bytes = result.bytes`.
3. Loop on `decideSave` until it returns `write` or the user cancels.
   - `guard-signature`: dialog, section 12.4. "Save As a copy..." switches to `saveAs`.
   - `ask-first-save`: title "Save changes to <name>?". Body "Overwrite replaces the
     original file. PDFluffer will not ask again for this file while its tab stays open."
     Buttons **Overwrite** (sets `saveConfirmed`), **Save As...** (switches to `saveAs`),
     **Cancel**.
4. `files.writeFile(ref, session.bytes, { keepBackup })`. On `FileError('locked')` show
   "Another program has this file open. Close it there, or use Save As." and return false.
5. On success clear `pendingEngineChanges`. If the mode was `rewrite`, reload the viewer
   from `session.bytes` with the current view state. If it was `append`, do not reload
   (unless fallback B applies, section 9.5).

`saveAs(tabId)`: export as in steps 1 and 2. `pickSaveTarget(name, ref)`. If the chosen
file is open in **another** tab, show "That file is open in another tab." and return false.
Write. Then point the tab at the new ref, update its name, set `saveConfirmed` to true,
and update `history`. Save As works even when the tab is not dirty.

### 12.4 Digital signatures: detect and guard (D10)

`src/util/hasDigitalSignature.ts` exports `hasDigitalSignature(bytes: Uint8Array): boolean`.
It returns true when the bytes contain the ASCII sequence `/ByteRange`. A signed PDF always
stores that key uncompressed, so a plain byte scan is reliable. Scan the bytes directly.
Do not decode the whole file to a string.

Guard dialog, shown before a `rewrite` reaches disk and before a phase 2 operation runs:
title "This PDF is digitally signed". Body "This change rewrites the file. The digital
signature will stop verifying." Buttons **Save As a copy...**, **Continue anyway** (sets
`rewriteAcknowledged`), **Cancel**. Filling a form or adding a signature image is `append`
mode and never shows this dialog.

### 12.5 Closing

`closeTab`: if dirty, dialog "Save changes to <name>?" with **Save**, **Discard**,
**Cancel**. Save runs `save()` and closes only if it returned true. Then destroy the
viewer, remove the tab, and activate the neighbour on the right, else on the left.

`confirmCloseAll`, called from `onCloseRequested`: for each dirty tab in order, activate
it and run the same dialog. Any Cancel returns false and the window stays open. When all
pass, write `session` and `history` immediately and return true.

### 12.6 Start and session restore

`start()`:

1. Load `settings`, `history`, `session`.
2. Subscribe `files.onOpenRequest(refs => openRefs(refs))`.
3. If `settings.restoreSession`, rebuild tabs from `session.tabs` with status `unloaded`.
4. `pending = await files.takePendingOpenRequests()`.
5. If `pending` is not empty, `openRefs(pending)`. Its last file becomes active, because
   the user just double-clicked it. Otherwise activate `session.activeTabId` if that tab
   exists, else the first tab, else show the empty state.

Subscribe before taking pending requests, so a request that arrives in between is not lost.
A `not-found` tab stays in the bar and stays in the saved session. **Locate...** runs
`pickFiles`, takes the first result, replaces the tab's ref and name, and activates it.
A file that changed on disk needs no special code. Tabs always read fresh bytes.

Persist `view` into `history` on every `viewchange` (debounced, section 8.6).

### 12.7 XFA banner

When `isXfa` is true and the banner is not dismissed for that tab, show above the viewer:
"This is an XFA form. PDFluffer's support for XFA is partial. Check the saved file in
another viewer before you send it." with a **Dismiss** button. Nothing else changes.

### 12.8 External links

On the viewer's `externallink` event: dialog "Open this link in your browser?" showing the
full URL, buttons **Open** and **Cancel**. Open calls `files.openExternal(url)`.

## 13. Phase 2: engine adapter, tools, operations

Build this only after phase 1 meets its acceptance criteria.

### 13.1 `src/engine/EngineAdapter.ts`

```ts
export type Capability =
  | 'pages.insertPdf' | 'pages.rotate' | 'flatten'
  | 'text.edit' | 'redact' | 'ocr' | 'sign.verify' | 'sign.certificate';

export type EngineOp =
  | { kind: 'pages.insertPdf'; other: Uint8Array }              // append all pages at the end
  | { kind: 'pages.rotate'; pages: number[] | 'all'; degrees: 90 | -90 | 180 }
  | { kind: 'flatten' };

export type EngineErrorCode = 'encrypted' | 'unsupported' | 'failed';
export class EngineError extends Error {
  constructor(public code: EngineErrorCode, message: string) { super(message); }
}

export interface EngineResult { bytes: Uint8Array; mode: 'append' | 'rewrite'; }

export interface EngineAdapter {
  readonly name: string;
  capabilities(): ReadonlySet<Capability>;
  run(op: EngineOp, bytes: Uint8Array): Promise<EngineResult>;
}
```

Five capability names have no operation yet. They are listed on purpose. They reserve the
place where later engines plug in. `engineRegistry.ts` holds a list of adapters and
exports `findAdapter(capability)`, which returns the first adapter that has it, or null.

### 13.2 `src/tools/toolRegistry.ts`

```ts
export interface Tool {
  id: string; label: string; needs: Capability[];
  run(ctx: { tabId: string; session: SessionManager; files: FileAdapter; dialogs: Dialogs }): Promise<void>;
}
```

The **Document** submenu lists every registered tool whose `needs` are all met by some
adapter. A tool whose capability is missing is not shown.

### 13.3 Running an operation: `SessionManager.runOp(tabId, op)`

1. If the tab has a digital signature and `rewriteAcknowledged` is false, show the guard
   dialog (12.4). "Save As a copy..." is not offered here. Offer **Continue anyway** and **Cancel**.
2. `exportBytes()` first, so pending form values are inside `session.bytes`.
3. `adapter.run(op, session.bytes)`. On `EngineError('encrypted')` show "This PDF is
   password-protected. PDFluffer cannot run this operation on it yet." and stop.
4. Set `session.bytes` to the result, set `pendingEngineChanges` to true, and reload the
   viewer from the new bytes with the current view state.

Nothing reaches disk until the user saves.

### 13.4 `pdfLibAdapter.ts`

Uses `@cantoo/pdf-lib`. Capabilities: `pages.insertPdf`, `pages.rotate`, `flatten`. Every
result has mode `rewrite`. `PDFDocument.load` throws on an encrypted file. Catch that and
throw `EngineError('encrypted')`.

- **insertPdf:** load both documents, `copyPages` every page of `other`, `addPage` each.
- **rotate:** for each chosen page, `setRotation(degrees((current + delta + 360) % 360))`.
- **flatten:** two steps.
  1. `doc.getForm().flatten()` inside `try/catch`. A file with no form is not an error.
  2. Flatten annotations. For each page, for each entry of `/Annots` whose `/Subtype` is
     `Stamp`, `FreeText`, `Ink` or `Highlight`, and whose `/AP /N` is a reference to a stream:
     - `bbox` = the stream's `/BBox`. `m` = its `/Matrix`, or identity if absent.
     - `tb` = the bounding box of the four `bbox` corners after transforming them by `m`.
     - `rect` = the annotation's `/Rect`, normalised so width and height are positive.
     - `sx = rect.width / tb.width`, `sy = rect.height / tb.height`,
       `tx = rect.x - tb.x * sx`, `ty = rect.y - tb.y * sy`. Skip the annotation if
       `tb.width` or `tb.height` is 0.
     - `name = page.node.newXObject('FlatAnnot', apRef)`.
     - `page.pushOperators(pushGraphicsState(), concatTransformationMatrix(sx, 0, 0, sy, tx, ty), drawObject(name), popGraphicsState())`.
     - Remove that entry from `/Annots`.
     Do not apply `m` yourself. The PDF renderer applies a form XObject's own `/Matrix`.
     Leave every other annotation type, such as links, untouched.

  **Stop rule for flatten step 2.** If it cannot pass its unit test and the manual check in
  section 16 after three attempts, ship step 1 only, label the tool "Flatten form fields",
  and record the gap under "Questions for the user".

### 13.5 Tools

| Tool | Label | Action |
|---|---|---|
| `insertPdf` | Insert PDF at end... | `pickFiles`, read each, run one `pages.insertPdf` per file |
| `rotateAllRight` / `rotateAllLeft` | Rotate all pages right / left | `pages.rotate` on `all`, 90 or -90 |
| `rotatePageRight` | Rotate this page right | `pages.rotate` on the current page |
| `flatten` | Flatten... | Confirm first: "Flatten bakes form values, signatures and notes into the pages. They can no longer be edited. You can still use Revert to saved until you save." |

### 13.6 Revert and backup

**Revert to saved:** confirm, re-read the file, clear `pendingEngineChanges`, reload the
viewer. **Backup:** unhide the Settings checkbox. `save` passes `keepBackup` to `writeFile`.

## 14. Test files

`scripts/make-samples.ts` builds these with `@cantoo/pdf-lib` into `samples/`. No test
file is ever downloaded. Add an npm script `samples` to run it.

| File | Content |
|---|---|
| `form-basic.pdf` | One page. Two text fields, one checkbox, one dropdown, one radio group |
| `flat-form.pdf` | One page that looks like a form but has no fields: labels and drawn lines |
| `three-pages.pdf` | Three pages, each with a large "Page N" label |
| `fake-signed.pdf` | `three-pages.pdf` with the bytes `\n% /ByteRange [0 0 0 0]\n` appended. Only for the detector |

The user's real forms go in `samples-private/`, which git ignores. Never commit, quote or
upload anything from that folder.

## 15. Unit tests (Vitest, node environment)

`npm run check` runs `tsc --noEmit` then `vitest run`. It must pass before every commit.

1. `hasDigitalSignature`: true for `fake-signed.pdf` bytes, false for `three-pages.pdf`,
   false for an empty array.
2. `decideSave`: every row of its truth table, including signed plus rewrite plus
   acknowledged.
3. State schemas: a wrong version or a garbage value gives the default. A valid value
   round-trips.
4. `SessionManager` with `fakeFileAdapter`, a fake `Viewer` and fake `Dialogs`:
   opening adds and activates. Opening the same file twice activates the existing tab.
   Closing activates the right neighbour, else the left. Restore rebuilds `unloaded` tabs.
   Pending files win the active tab. A missing file becomes `not-found` only when
   activated. Locate replaces the ref. `history` moves to front and caps at 100.
5. Save flow: first save asks. Overwrite sets `saveConfirmed` and the second save does not
   ask. Cancel writes nothing. A throwing `exportBytes` writes nothing. `locked` writes
   nothing and returns false. Save As onto a file open in another tab is refused.
6. Close flow: Save, Discard and Cancel each behave as section 12.5 says.
   `confirmCloseAll` stops at the first Cancel.
7. Phase 2, `pdfLibAdapter`: insert gives the summed page count. Rotate sets the rotation.
   Flatten removes the form fields and the listed annotation types, keeps a link
   annotation, and adds a `Do` operator to the page. An encrypted input throws
   `EngineError('encrypted')`.
8. Rust, `cargo test`: `parse_pdf_args` skips the exe, ignores flags, keeps `.PDF` in any
   case, drops missing files and non-PDF files, resolves a relative path against `cwd`.

## 16. Manual checks

**Harness checks** run in an ordinary browser tab against `npm run dev`. The builder does
them itself if it has a browser tool. Otherwise it lists them for the user.

| # | Check |
|---|---|
| H1 | Open `form-basic.pdf`. Fill every field. The tab shows the dirty dot within about a second |
| H2 | Save. The first-save dialog appears. Choose Overwrite. The dot clears. Save again after another edit: no dialog |
| H3 | Reload the page. The tab returns, on the same page and zoom. The filled values are in the file |
| H4 | Add text on `flat-form.pdf`. Draw a signature, place it, save it as a saved signature, reload, and place the saved signature again |
| H5 | Open three files. Ctrl+Tab cycles. Ctrl+W closes. Closing a dirty tab asks Save, Discard, Cancel, and each works |
| H6 | With focus inside the PDF, Ctrl+S saves through PDFluffer and no browser download starts. Ctrl+O opens PDFluffer's picker |
| H7 | PDF.js's own Open and Download buttons are not visible. Print, Find and the editing tools are |
| H8 | `fake-signed.pdf` shows the `Signed` chip. Delete a page in the sidebar and save: the guard dialog appears |
| H9 | Select text and copy it. Paste it elsewhere. Search finds "Page 2" |
| H10 | The browser's network panel shows requests to `localhost` only |
| H11 | Phase 2: insert, rotate and flatten each change the document. Flatten a signed-by-image form: the signature can no longer be selected. Revert restores the file |

**USER checks** need the real Tauri app. List them for the user. Do not tick them yourself.

| # | Check |
|---|---|
| U1 | `npm run tauri dev` opens the window. H1 to H9 behave the same, against real files on disk |
| U2 | The saved `form-basic.pdf` shows its values in Acrobat, Chrome and Edge |
| U3 | Print opens the Windows print dialog and the preview is correct |
| U4 | Drag a thumbnail to reorder pages. **Decision rule:** if dragging does not work, set `dragDropEnabled` to `false` in `tauri.conf.json`, drop the drag-and-drop-to-open feature from version 1, record it, and re-test |
| U5 | With `dragDropEnabled` true: drop a PDF from Explorer onto the window. It opens in a new tab |
| U6 | `npm run tauri build` makes an installer. It installs with no administrator prompt |
| U7 | Choose PDFluffer as the default PDF app in Windows Settings. Double-click a PDF: it opens. Double-click another while PDFluffer runs: it opens as a new tab in the same window, and the window comes to the front |
| U8 | Close PDFluffer with three tabs open. Start it again: the three tabs return, the last active one is active and on its page |
| U9 | Rename a file that is open in a saved session, then start PDFluffer: the tab shows "File not found". Locate fixes it |
| U10 | Open a file in Acrobat, then save it from PDFluffer: the "another program has this file open" message appears and the file is not damaged |
| U11 | The developer tools console in `tauri dev` shows no CSP errors while opening, filling, signing, saving and printing |

## 17. Acceptance criteria

- **Phase 0 is done when:** the prerequisites are recorded. PDF.js is vendored and
  `VENDOR-PDFJS.md` exists. F1 to F10 are each recorded as confirmed or different.
  A throwaway page hosts one viewer in an iframe, opens `form-basic.pdf` from bytes, shows
  the signature tool, and `exportBytes()` returns bytes that differ from the original after
  a field is filled. The dirty-signal question (fallback B) is answered in writing.
  `npm run tauri dev` shows that page in a Tauri window (USER check).
- **Phase 1 is done when:** `npm run check` passes. H1 to H10 pass. `cargo test` passes.
  The USER checks U1 to U11 are listed for the user with exact steps.
- **Phase 2 is done when:** `npm run check` passes with the phase 2 tests. H11 passes.
  The Settings backup checkbox works.

## 18. `BUILD-NOTES.md`

Create it in phase 0 with these headings and keep it current:
**Environment** (tool versions). **Verified facts** (F1 to F10). **Decisions taken under a
named rule** (for example fallback B, the U4 rule, the flatten stop rule). **Deviations**
(anything built differently from this spec, with the reason). **Questions for the user**.
**Known issues**.

## 19. Known limits accepted for version 1

Do not try to fix these. They are recorded so nobody mistakes them for bugs.

1. PDF attachments inside a PDF use PDF.js's original download path and may not save.
2. The WebView2 right-click menu may still offer Refresh. A refresh loses unsaved edits.
   The tabs themselves come back through session restore.
3. The installer is larger than the concept document's estimate, because PDF.js ships its
   fonts, character maps and locales. That is fine.
4. Dark mode changes the app frame and the PDF.js toolbar, not the page colours.
5. Saved signatures live in the WebView2 profile's localStorage (F9), at most five.
6. The custom Rust commands can read and write any `.pdf` path the Windows user can reach.
   That is acceptable for a personal tool whose page loads no remote content (D12).
