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

None yet.

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

## Questions for the user

For the orchestrator. Nothing below blocks chip 1.

1. **Spec 9.5 `exportBytes` may throw on two legitimate saves (from F6).** The spec treats
   any call to `app.download()` during `downloadOrSave()` as the F7 failure fallback. But
   `downloadOrSave()` also calls `download()` directly, not as a fallback, whenever there
   are no structural changes and `annotationStorage.size` is 0 (`viewer.mjs:19665`). Two
   cases reach that with `hasChanges()` true:
   - `_mergedDocumentNeedsSaving` is true (a merged or reloaded document) with no
     annotations. The good bytes come from `getData()`, but `fellBack` is set, so export
     throws.
   - `_annotationStorageModified` is true but storage size is back to 0, for example after
     the user adds and then deletes an annotation.
   Not designed around, per the chip. The spike (P0.10, P0.11) is the natural place to
   confirm it. A possible direction for the orchestrator: count `download()` as a fallback
   only when it runs from inside `save()`.

## Known issues

None yet.
