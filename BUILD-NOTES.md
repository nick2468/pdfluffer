# PDFluffer - build notes

The builder's log (spec section 18). Newest findings go under the right heading.

## Environment

Checked 2026-09-19 at the start of chip 1 (plan P0.1).

| Tool | Version | How checked |
|---|---|---|
| Node | v24.19.0 | `node --version` |
| npm | 11.17.0 | `npm --version` |
| git | 2.45.1.windows.1 | `git --version` |
| rustc | 1.98.0 (88d9e12ae 2026-08-18) | `rustc --version`, with `$HOME/.cargo/bin` put on the PATH first |
| cargo | 1.98.0 (797e8a9bc 2026-08-05) | `cargo --version`, same PATH setting |

`.node-version` says `24.21.0`, the pin the sibling apps use. The machine runs 24.19.0,
which is on the same Node 24 line.

The scaffold (`create-tauri-app` 4.7.4, template `react-ts`) chose these versions. They are
kept as chosen (spec 5): React 19.3.0, Vite 8.3.0, TypeScript 6.0.3,
`@vitejs/plugin-react` 6.1.1. Installed by `npm install`: `@tauri-apps/api` 2.11.1,
`@tauri-apps/cli` 2.11.4, `vitest` 4.1.11, `@cantoo/pdf-lib` 2.11.1. Rust crates resolved
to `tauri` 2.11.5 and `tauri-build` 2.6.3.

## Verified facts

Checked 2026-09-19 (plan P0.8) against the vendored PDF.js 6.3.289, by searching
`public/pdfjs/web/viewer.mjs` (21,357 lines) and, for F4 and F8, `public/pdfjs/build/pdf.mjs`.
Line numbers are in those files. Result: **F1 to F10 are all confirmed.** F6 has detail the
spec does not state, and it matters for spec 9.5. See the question under
"Questions for the user".

| # | Result | Searched for | Found |
|---|---|---|---|
| F1 | Confirmed | `webviewerloaded` | `viewer.mjs:21334` `new CustomEvent("webviewerloaded", { bubbles: true, cancelable: true, detail: { source: window } })`, then `:21342` `parent.document.dispatchEvent(event)`. If that throws, it dispatches on its own `document` instead (`:21345`) |
| F2 | Confirmed | `window.PDFViewerApplication` | `viewer.mjs:21077-21079` sets `window.PDFViewerApplication`, `window.PDFViewerApplicationConstants`, `window.PDFViewerApplicationOptions` |
| F3 | Confirmed | `["enableSignatureEditor", {` and the other names | Default options map from `viewer.mjs:532`. `enableSignatureEditor` false (`:666`), `enableSplitMerge` false (`:672`), `enableHighlightFloatingButton` false (`:636`), `defaultUrl` `"compressed.tracemonkey-pldi-09.pdf"` (`:600`), `disablePreferences` false (`:615`). The other spec 9.2 names also exist: `enableXfa` true (`:771`), `enableScripting` true, `enablePermissions` false, `viewOnLoad` 0 (`:741`), `disableHistory` false (`:609`), `viewerCssTheme` 0 (`:738`), `annotationEditorMode` 0 (`:582`). `ViewOnLoad.INITIAL` is 1 (`:18853`) |
| F4 | Confirmed | `async open(args)`, `getDataProp`, `GetDocRequest` | `viewer.mjs:19557` `open(args)` uses `args.data` and `args.filename`. `pdf.mjs:8689` keeps a `Uint8Array` that spans its whole buffer as is, and `pdf.mjs:15532` sends `GetDocRequest` with transfer list `[data.buffer]`, so that buffer is detached. See the note below |
| F5 | Confirmed | `get initializedPromise` | `viewer.mjs:19370` returns `this._initializedCapability.promise`. It resolves at `:18950`, at the end of `initialize`, after `_initializeViewerComponents`, `bindEvents` and `bindWindowEvents` |
| F6 | Confirmed, with detail | `async downloadOrSave` | `viewer.mjs:19645`. If `pdfThumbnailViewer?.hasStructuralChanges()`: `onSavePages` (`:20392`), which calls `pdfDocument.extractPages` (`:20404`) then `downloadManager.download` (`:20409`). Otherwise: `annotationStorage.size > 0 ? this.save() : this.download()` (`:19665`). `save()` (`:19615`) calls `saveDocument()` then `downloadManager.download` (`:19625-19626`). `download()` (`:19605`) calls `getData()` then `downloadManager.download` (`:19611-19613`). After either branch, `downloadOrSave` runs `delete this._mergedDocumentNeedsSaving` (`:19667`) |
| F7 | Confirmed | `async save()` | `viewer.mjs:19627-19629`: `catch (reason) { console.error(...); await this.download(); }`. The hazard is real. Also: `save()` returns at once, downloading nothing, when `_saveInProgress` is true (`:19619`). And `onSavePages` returns without downloading when `extractPages` gives nothing (`:20405-20407`) |
| F8 | Confirmed | `_annotationStorageModified`, `hasStructuralChanges() {`, `_mergedDocumentNeedsSaving` | `viewer.mjs:20064` sets `_annotationStorageModified = true` in `onSetModified`. `:20067` deletes it in `onResetModified`. `pdf.mjs:16805` calls `annotationStorage.resetModified()` inside `saveDocument()` (`:16791`). `hasStructuralChanges()` at `viewer.mjs:10656`. `_mergedDocumentNeedsSaving = true` at `:20425`. PDF.js's own combined check is `_hasChanges()` at `:20053`: `annotationStorage.size > 0 \|\| hasStructuralChanges() \|\| _mergedDocumentNeedsSaving === true` |
| F9 | Confirmed | `localStorage` | `viewer.mjs:3088` `KEY_STORAGE = "pdfjs.signature"`, at most 5 (`isFull` at `:3127` returns `size === 5`). `:3163` `"pdfjs.preferences"`. `:18445` `"pdfjs.history"` |
| F10 | Confirmed | `dispatch("<name>"` for each | `documentloaded` `:19726`, `documentinit` `:19799`, `pagesinit` `:15232`, `documenterror` `:19674` (payload `{ source, message, reason }`), `pagechanging` `:14785`, `scalechanging` `:15527` and `:15577`, `rotationchanging` `:14870` |

Notes found on the way. They change nothing in this chip.

- **F4, cross-frame arrays.** `getDataProp` keeps the caller's array only when
  `val instanceof Uint8Array`. A `Uint8Array` made in the parent window fails that test
  inside the iframe, because each window has its own `Uint8Array`. It then falls through to
  `new Uint8Array(val)` (`pdf.mjs:8696`), which copies. So the parent's buffer is probably
  not detached in the iframe setup. The `.slice()` in spec 9.3 stays correct and harmless.
- **An extra option exists: `enableMerge`**, default false (`viewer.mjs:639`). It gates an
  "add file" button in the thumbnail sidebar, `viewsManagerAddFileButton` in `viewer.html:105`.
  Spec 9.2 does not set it, so it stays off. Recorded only.
- **No Open button in the main toolbar.** In 6.3.289 Open exists only in the secondary menu.

**PDF.js element ids (spec 9.4)**, found in `public/pdfjs/web/viewer.html`. All four
expected ids are confirmed.

| Button | Id | Line |
|---|---|---|
| Open file (secondary menu only) | `secondaryOpenFile` | 605 |
| Download / Save, main toolbar | `downloadButton` | 583 |
| Download / Save, secondary menu | `secondaryDownload` | 614 |
| Current view / bookmark link | `viewBookmark` (with `viewBookmarkSeparator` after it) | 626, 630 |

Print, for reference: `printButton` (579) and `secondaryPrint` (610). These stay visible.

## Decisions taken under a named rule

1. **Chip 1's question on spec 9.5 `exportBytes` is answered.** Spec 9.5 was revised on
   2026-09-19. `hasChanges` now ignores an empty annotation storage, and `download()` counts
   as a failure only on the `save()` branch. `PdfJsViewer.ts` copies the revised code.
2. **Fallback B not needed (spec 9.5, plan P0.11).** Builder checked on 2026-09-19 in the
   built-in browser pane against `npm run dev`, with `samples/form-basic.pdf` loaded
   through the spike's file input. The six findings:
   1. **Dirty turns true within a second. Builder checked.** After typing into "Full name"
      with real key presses, dirty showed true within 1.5 s, while the field still had
      focus. Timed three more edits of "Email" by setting the value and dispatching `input`:
      dirty turned true after 306, 778 and 785 ms. That fits the 1000 ms poll.
   2. **Dirty returns to false after Export, without a reload. Builder checked.** Four
      exports, all mode `append`, dirty false straight after each. Fallback B is not needed.
      The first export was 8,693 bytes. Its first 7,948 bytes equal the original file, and
      the tail holds "Test Person" and ends in `%%EOF`, so it is a true incremental update.
      Underneath, `_annotationStorageModified` is cleared by the save while the annotation
      storage keeps its entry (size stays 1). The next edit sets the flag again and dirty
      returns to true.
   3. **Reload from export keeps the values, and dirty is false. Builder checked.** After
      Reload from export, PDF.js holds a new document object whose `getData()` length is
      8,693, "Full name" shows "Test Person", and dirty is false. The zoom, set to 1.5
      before the reload, came back as 1.5. Page and rotation restore were not exercised
      (the sample has one page, and no rotation was set).
   4. **Add then delete an annotation: dirty returns to false. Builder checked.** With the
      Text tool, added "Note here" on the page. Dirty turned true. Deleted it with its bin
      button ("Text removed" toast). Dirty turned false. At that point
      `_annotationStorageModified` was already cleared by PDF.js itself and the storage size
      was 0. PDF.js's own `_hasChanges()` also said false. Export then returned mode `none`.
   5. **Toolbar. Builder checked.** The signature tool ("Add signature",
      `editorSignatureButton`) is visible in the main toolbar, beside highlight, text, draw
      and image. Open (`secondaryOpenFile`) and both Save buttons (`downloadButton`,
      `secondaryDownload`) are hidden, as are `viewBookmark` and `viewBookmarkSeparator`.
      Print (`printButton`) stays in the main toolbar. The overflow menu's own Print
      (`secondaryPrint`) is hidden by PDF.js's CSS at this width, not by ours. All twelve
      spec 9.2 options read back as set, and `enableMerge` stays false.
   6. **Console. Builder checked.** After the stylesheet fix (deviation 7), no errors. One
      warning, `No available adapters.`, printed by Chromium when PDF.js probes for WebGPU
      (`pdf.mjs:9874`) in a browser with no GPU adapter. Harmless. Also info and log lines:
      Vite's connect lines, React's DevTools hint, the PDF.js version line on each load, and
      one "Spike mount ended: This viewer was destroyed while it was mounting." from React
      StrictMode's mount-unmount-mount in development, which the spike logs on purpose.
      Before the fix there was one error: the CSP block on the `<style>` element. Every
      request went to `http://localhost:1420`.

## Deviations

1. **`.gitattributes` added** (not in spec 6.1). It marks `public/pdfjs/**` as `-text` and
   `*.pdf` as `binary`. Reason: this machine's git has `core.autocrlf=input`, and one
   vendored file, `web/cmaps/GB-H.bcmap`, contains CR bytes. Without the rule git could
   rewrite it on commit. Checked: `git archive HEAD public/pdfjs` unpacked and compared
   with `diff -rq` against a fresh unzip of the release zip. They are identical.
2. **Scaffold files dropped:** the template's `README.md`, root `.gitignore` (the spec 6.3
   one is used instead) and `.vscode/`. The template's `src-tauri/.gitignore` is kept.
3. **`App.tsx` lives in `src/app/`**, as spec 6.1 lays out, not in `src/` where the scaffold
   put it.
4. **The `preview` npm script is kept** from the scaffold, beside the five the plan names.
5. **`scripts/make-samples.ts` runs with plain `node`.** Node 24 strips TypeScript types
   natively, so no runner is needed and the `.mjs` fallback was not used.
6. **`tauri-plugin-fs` appears in `Cargo.lock`.** `tauri-plugin-dialog` depends on it. The
   `fs` plugin is not registered and has no permissions, as spec 10.5 requires.
7. **The injected stylesheet is a constructed stylesheet, not a `<style>` element**
   (spec 9.4, chip 2). The vendored `public/pdfjs/web/viewer.html:30-33` carries its own
   CSP meta tag with `style-src 'self'`. Chromium blocked the `<style>` element and logged
   "Applying inline style violates the following Content Security Policy directive
   'style-src 'self''". The buttons stayed visible. `PdfJsViewer.injectStyle` now builds a
   `CSSStyleSheet` with the iframe window's own constructor, calls `replaceSync` with the
   same imported CSS string, and appends it to `document.adoptedStyleSheets`. A constructed
   stylesheet is not inline, so the CSP allows it. Checked in the browser pane: no CSP
   error, and all five ids compute to `display: none`. The design is unchanged: the same
   file, imported with `?raw`, applied from outside, hiding only. See question 1.
8. **Two typing-only changes to the spec 9.5 code blocks.** Strict TypeScript rejects
   `app.pdfDocument?.annotationStorage.size > 0` (possibly undefined), so both places read
   `(app.pdfDocument?.annotationStorage.size ?? 0) > 0`. That gives the same result.
   In `exportBytes`, `captured` and `fellBack` are declared with `as` so TypeScript does
   not narrow them to their first values, which are only changed inside callbacks. The logic
   is otherwise copied as written. `exportBytes` also runs one dirty poll after a
   successful export, so `dirtychange` fires at once rather than on the next tick.

## Questions for the user

For the orchestrator. Nothing below blocks chip 2.

1. **Please ratify deviation 7, the constructed stylesheet.** Spec 9.4 says to add a
   `<style>` element, and the vendored viewer's own CSP blocks that. The fix keeps the
   design, but it changes the mechanism the spec names, so the spec text may want updating.
   The same CSP also applies inside the Tauri window, whatever `tauri.conf.json` allows,
   because a page's meta CSP and the host's CSP are both enforced. P0.13 will show whether
   the Tauri window adds anything.

## Known issues

1. **Chromium logs `No available adapters.`** when PDF.js probes for WebGPU
   (`pdf.mjs:9874`) on a machine or browser with no GPU adapter. It is a warning only.
   PDF.js carries on without WebGPU.
