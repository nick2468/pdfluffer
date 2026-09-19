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

**Installer build (chip 6, plan P1.18).** `npm run tauri build`, with the Rust PATH set,
succeeded on 2026-09-19 in 3 min 10 s of Rust compile. It made
`src-tauri\target\release\bundle\nsis\PDFluffer_0.1.0_x64-setup.exe`, 7,418,050 bytes
(about 7.1 MB). The NSIS tools were already present: nothing was downloaded. The builder
did not run the installer. U6 is the user's.

**`tauri dev` (chip 6, plan P1.18).** Not observed. When the builder ran it, Vite started
and `target\debug\pdfluffer.exe` ran, then exited at once with code 0 and no Rust
output. Another `pdfluffer.exe` dev instance was already running (started 19:14 by a
`cargo run` the builder did not start). So the new instance handed its arguments to it
through single instance and quit, as designed. The builder could not see that window's
log or drive it. No panic and no permission error appeared in its own log.

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

3. **Deviation 7 is ratified.** Spec 9.4 was updated on 2026-09-19 to name the constructed
   stylesheet.

4. **The browser adapter keeps a written file across a page reload (chip 3, part 5).
   Builder checked** on 2026-09-19 in the built-in browser pane, against the Vite server
   already running from this repo on port 1420 (its command line was this repo's
   `node_modules/vite/bin/vite.js`, and the page showed the new Write back button).
   The pane cannot drive a native file dialog, so a page script stood in for it: it patched
   `HTMLInputElement.prototype.click` so the adapter's hidden input received
   `samples/form-basic.pdf` (7,948 bytes, fetched from Vite) and fired `change`. Everything
   after that is the adapter's own code. Steps and results:
   1. **Open** ran `pickFiles()` then `readFile()`. One page loaded. `spike-ref` held
      `mem:<uuid>` in localStorage under `pdfluffer.state.spike-ref`.
   2. Typed "Harness Writer" into Full name with real key presses. Dirty turned true.
   3. **Export** gave mode `append`, 8,699 bytes, and dirty false.
   4. **Write back** reported "wrote 8699 bytes to (browser harness) form-basic.pdf".
   5. Reloaded the page. The spike read `spike-ref`, called `readFile`, and loaded the file.
      PDF.js held 8,699 bytes, Full name showed "Harness Writer", and dirty was false.
   Console on the fresh loads: no errors, only the known WebGPU warning. The five hidden ids
   still compute to `display: none`.

5. **The save and close flows live in `src/session/saveFlow.ts` and `closeFlow.ts`** (chip 4's
   500-line rule). `SessionManager.ts` reached 580 lines with them inside. They are now plain
   functions over the tab and a small context object the manager passes in, and the manager
   is 478 lines.

6. **Chip 4's known issue 3 is answered by a spec change** (spec 8.5, revised 2026-09-19).
   `SessionSnapshot` now carries `recent` (the first 15 history items) and `settings`.
   Every history change publishes: open, Locate, Save As, `viewchange` and `clearHistory`.
   `updateSettings` publishes too. `getRecent()` and `getSettings()` stay, and return the
   same objects the snapshot holds. A `viewchange` now gives a new snapshot, because the
   recent item carries the view. The tab objects inside it stay the same.
   `clearHistory()` still clears at once. The confirm step lives in the app menu.

7. **Harness checks H1 to H10 (chip 5, plan P1.14).** Run on 2026-09-19 in the built-in
   browser pane against the Vite server on port 1420. It was this repo's
   `node_modules/vite/bin/vite.js`, started from this checkout, and it hot-reloaded each
   edit. The pane cannot drive a native file dialog. As in item 4, a page script patched
   `HTMLInputElement.prototype.click` so the adapter's hidden input received files from
   `samples/`. Everything after that was the app's own code, driven by real clicks and key
   presses. **Limit of the tool:** the pane's key presses carry `keyCode` 0. PDFluffer reads
   `key`, so its own shortcuts work. PDF.js reads `keyCode`, so PDF.js's own shortcuts
   (Ctrl+F, Ctrl+C) do not fire from this tool.

   | # | Result | What I saw |
   |---|---|---|
   | H1 | builder checked, pass | Filled Full name, Email, Subscribe, Country (New Zealand) and Contact by. The dirty dot and ` *` in the title appeared within about a second. |
   | H2 | builder checked, pass | Ctrl+S showed "Save changes to form-basic.pdf?". Overwrite cleared the dot. Chose Post, pressed Ctrl+S: no dialog, the dot cleared. |
   | H3 | builder checked, pass | Zoomed to 160%, reloaded. The tab came back at 160% with every saved value, Post included. The file has one page, so "same page" rests on the unit tests. See question 1: the tab later turned dirty with no edit. |
   | H4 | builder checked, pass | On `flat-form.pdf`: added "Harness Text", drew a signature with "Save signature" ticked, placed it, saved (Overwrite). After a reload the file showed both. The signature menu listed the saved signature, and choosing it placed it again, twice. PDF.js put it at its own default spot, not where I clicked. |
   | H5 | builder checked, pass | Four tabs. Ctrl+Tab and Ctrl+Shift+Tab cycled and wrapped, both from inside the PDF and with focus on a tab bar button. Ctrl+W on a dirty tab asked Save, Discard, Cancel. Cancel and Escape kept it open and dirty. Save wrote, closed it and activated the right neighbour. Discard closed without writing: reopened, the field still held the saved value. Closing the last tab activated the left neighbour. In desktop Chrome, Chrome keeps Ctrl+Tab for itself. U1 covers the real app. |
   | H6 | builder checked, pass | Focus inside the PDF. Ctrl+S opened PDFluffer's first-save dialog, and a listener on the iframe window saw no keydown, so PDF.js never got the key. Ctrl+O called PDFluffer's picker once. No request left `localhost:1420` and no download started. |
   | H7 | builder checked, pass | Computed styles in the iframe: `secondaryOpenFile`, `downloadButton` and `secondaryDownload` hidden. `printButton`, `viewFindButton` and the highlight, text, draw, image and signature buttons visible. |
   | H8 | builder checked, pass | `fake-signed.pdf` showed the Signed chip. The sidebar's page tools are a checkbox per thumbnail and a Manage menu (Copy, Cut, Delete, Export selected...). Delete removed page 2 and the tab turned dirty. Save showed "This PDF is digitally signed". |
   | H9 | USER check | Search builder checked: the find button, "Page 2", Enter gave "1 of 1 match" and moved to page 2. Copy and paste not checked: the pane's drag made no selection, and its Ctrl+C has no `keyCode`. |
   | H10 | builder checked, pass | Every request in the network panel, and every resource entry in the page and each iframe (60), came from `http://localhost:1420`. |

   **Steps for H9 (USER check).** Run `npm.cmd run dev` and open `http://localhost:1420`.
   1. Open `samples/three-pages.pdf` with the + button.
   2. Click in the page, press Ctrl+F, type `Page 2`, press Enter. The view moves to page 2.
   3. Drag across the words "Page 2", press Ctrl+C.
   4. Paste into Notepad. It shows "Page 2".

   **Also checked in the pane:** the app menu (Recent, disabled items, Escape, an outside
   click, a click into the PDF), About (version 0.1.0, PDF.js 6.3.289, the no-network
   line), Settings (the checkbox saves and follows the snapshot), Clear history (Cancel
   keeps it, confirming leaves "No recent files" and the tabs), the not-found panel and
   Locate, the window title, and the external link dialog. For the link I added an `<a>`
   to the viewer page by script and clicked it for real. Cancel kept the page where it was.
   **Not checked live:** the XFA banner (no XFA sample; the unit tests cover `isXfa` and
   Dismiss) and Print (it opens the native print dialog; U3 covers it).

8. **No PDF.js frame is alive when the window closes** (chip 6, ruling 3 on chip 5's known
   issue 3). PDF.js adds its own `beforeunload` handler inside each iframe whose form store
   is modified. After the user chooses Discard, that viewer is still modified, so the Tauri
   window could raise PDF.js's "Leave site?" prompt. Ruled 2026-09-19: when
   `confirmCloseAll()` is about to return true, `SessionManager` first calls `dropViewer()`
   on every tab, after the savers flush. Removing an iframe does not raise the prompt. Two
   tests cover it: a `true` result leaves every `FakeViewer` destroyed, a `false` result
   destroys none. U12 in `docs/user-checks-phase-1.md` checks it in the real window.

9. **Chip 5's `SessionManager.print` (deviation 13) and small choices (deviation 14) are
   ratified** (chip 6, ruling 2).

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
   file, imported with `?raw`, applied from outside, hiding only. Ratified, see decision 3.
8. **Two typing-only changes to the spec 9.5 code blocks.** Strict TypeScript rejects
   `app.pdfDocument?.annotationStorage.size > 0` (possibly undefined), so both places read
   `(app.pdfDocument?.annotationStorage.size ?? 0) > 0`. That gives the same result.
   In `exportBytes`, `captured` and `fellBack` are declared with `as` so TypeScript does
   not narrow them to their first values, which are only changed inside callbacks. The logic
   is otherwise copied as written. `exportBytes` also runs one dirty poll after a
   successful export, so `dirtychange` fires at once rather than on the next tick.

9. **A tiny ambient type for `node:fs`** (chip 3). The project has no `@types/node`, and spec 5
   allows no new dependency, so `tsc` rejected `import { readFileSync } from "node:fs"` in
   the `hasDigitalSignature` test. `src/testing/node-fs.d.ts` declares that one function,
   returning `Uint8Array` (Node's `Buffer` is a subclass). Typing only. App code must not
   import `node:fs`.
10. **Small choices the chip left open** (chip 3):
   - `FakeFileAdapter.nameOf` and `writeFile` fall back to the last path segment of the ref
     for a file the fake does not hold, so Save As onto a new ref has a name.
     `pickFiles` and `pickSaveTarget` return `[]` and `null` when nothing is queued.
   - A parser rejects the whole stored value, and uses the default, when any one tab or
     history item is wrongly shaped. It returns a clean copy with only the schema's fields.
     A `view` must be `null` or have a numeric `page` and `rotation` and a string `scale`.
   - `BrowserFileAdapter.loadState` returns null and warns once when stored text is not
     valid JSON. `writeFile` on a ref it does not hold throws `not-found`.
   - `createDebouncedSaver` takes `Pick<FileAdapter, "saveState">`, so any full adapter fits.
     A failed write from the timer is logged with `console.warn`. A failed `flush` rejects.
11. **A tab stays dirty until its exported bytes reach disk** (chip 4, "loses no user
    data"). PDF.js clears its own dirty flag when `exportBytes` succeeds. If the user then
    cancels the first-save dialog, or the write fails, the viewer reports clean although
    the file on disk is old. The tab could then close with no prompt and lose the edit. So a
    successful export sets a private `unsavedMode` on the `DocumentSession`. `dirty` counts
    it. A later save uses those bytes and that mode even when the new export says `none`.
    A successful write clears it. For the same reason, the `dirty` passed to `decideSave`
    is read **before** the export.
12. **Small choices the chip left open** (chip 4):
    - Save As never shows the signature guard. The guard's own "Save As a copy..." leads to
      Save As, so a copy is the safe path. Save As onto the tab's own file is allowed.
    - After a successful write, `hasDigitalSignature` is worked out again from the written
      bytes, so the Signed chip matches the file on disk.
    - After a `rewrite` save, if the viewer fails to reload, the tab shows the error panel.
      The file is already saved.
    - `save` on a clean tab returns true and writes nothing. `save` and `saveAs` on a tab
      that is not `ready` return false.
    - In `confirmCloseAll`, a Save that fails keeps the window open, like Cancel. A failed
      state flush is logged, and the window still closes.
    - Locate works only on a `not-found` tab. It resets `saveConfirmed`, because the tab now
      points at a different file. Locate onto a file open in another tab shows the "File is
      open elsewhere" dialog and changes nothing.
    - The close dialog (spec 12.5) has an empty body, because the spec gives none.
    - `start()` skips a saved tab whose file is already open. If an open request arrives
      while `start()` waits for pending files, its tab stays active.
    - `start()` does not register `onCloseRequested`. Spec 12.6 does not list it. Chip 5
      wires `files.onCloseRequested(() => manager.confirmCloseAll())`.
    - The window title is set only when it changes.
    - `Dialogs` and `DialogButton` live in `dialogTexts.ts` and are re-exported from
      `SessionManager.ts`. The spec 8.4 "private" fields are public to TypeScript so the
      manager and the flow functions can reach them. No snapshot carries them.

13. **`SessionManager.print(tabId)` added** (not in spec 8.5). Spec 11.3 puts Print in the
    app menu, and components may not touch a viewer. It prints a `ready` tab and does
    nothing otherwise. Test-first in `SessionManager.test.ts`.

14. **Small choices the chip left open** (chip 5):
    - The parent window also swallows F5, Ctrl+R and Ctrl+Shift+R in production builds, the
      same as the iframe (spec 9.6), because a reload loses edits wherever focus is.
      `isReloadKey` counts F5 with Ctrl or Shift too.
    - Ctrl+Shift+O and Ctrl+Shift+W are not shortcuts. Only the six chords of spec 11.6 are.
    - The parent window ignores shortcuts while a modal dialog is open, so Ctrl+S cannot
      start a second save.
    - `ChoiceDialog` handles Escape on `keydown`. The browser's `cancel` event did not fire
      for the pane's key presses. A `cancel` or `close` from the browser is still answered.
    - A dialog focuses its primary button. With none, it focuses the Escape button, never a
      danger button. So Enter in Clear history and the signature guard means Cancel.
    - Clear history's confirm button is labelled "Clear history" (id `ok`, kind `danger`).
    - About uses `ChoiceDialog` with the body on three lines. Settings has its own
      `<dialog>` with a Close button.
    - The app menu also closes when the window loses focus, because a click into a viewer
      iframe never reaches the parent document.
    - Tabs are focusable. Enter or Space activates one.
    - The not-found panel shows `files.describe(ref)`. In the harness that is "(browser
      harness) <name>". In Tauri it will be the path.
    - The empty state renders for a moment before `start()` restores the tabs.
    - After a dialog closes, the browser puts focus back where it was. PDFluffer does not
      refocus the viewer.
    - `shortcutFor` and `isReloadKey` live in `src/viewer/shortcutFor.ts`.

15. **`read_pdf` and `write_pdf` are `#[tauri::command(async)]`** (chip 6). Spec 10.3 gives
    plain signatures. A plain synchronous command runs on the main thread, so reading or
    writing a large file would freeze the window. The attribute runs the same function on
    Tauri's thread pool. The signatures are unchanged.

16. **Small choices the chip left open** (chip 6):
    - The pure Rust helpers live in `paths.rs` (`normalise`, `parse_pdf_args`,
      `has_pdf_extension`) and `files.rs` (`read_pdf_bytes`, `write_atomic`,
      `write_error`). The commands in `lib.rs` are thin wrappers.
    - `write_atomic` refuses a non-PDF path with `Err("not-pdf")`, the same string as
      `read_pdf`.
    - `read_pdf` maps only a missing file to `not-found`. Every other read failure is
      `io: <detail>`, as spec 10.3 says. The "locked" rule applies to writes.
    - The backup name uses the file stem as it is: `Form.PDF` backs up to
      `Form.backup.pdf`.
    - An extra cargo test holds the target open with share mode 0, as a program that
      locks the file would. `write_atomic` returns `locked` and the file is unchanged.
    - Launch arguments are read with `std::env::args_os`, converted lossily.
      `std::env::args` panics on an argument that is not valid Unicode.
    - `toFileError` passes a `FileError` through, and maps a non-string rejection (for
      example an IPC `Error`) to `io` with its message. The user-facing texts are "The
      file was not found.", "This is not a PDF file." and "Another program has this file
      open." An `io: ` prefix is stripped from the detail.
    - If the close handler throws, the adapter keeps the window open and logs the error.
      Losing the user's work is worse than a window that needs a second try.
    - The store loads with `autoSave: false`, because `saveState` saves itself. A failed
      load is not cached, so the next call tries again.
    - `pickSaveTarget` passes the PDF filter to the Save dialog too. If `normalise_paths`
      drops the chosen path, it returns the path as chosen.
    - The `open-files` listener ignores an empty list, though Rust never sends one.

## Questions for the user

For the orchestrator.

None open.

## Known issues

1. **Chromium logs `No available adapters.`** when PDF.js probes for WebGPU
   (`pdf.mjs:9874`) on a machine or browser with no GPU adapter. It is a warning only.
   PDF.js carries on without WebGPU.

2. **The browser harness cannot keep its tab open on close.** A browser does not wait for
   a promise in `beforeunload`, so `BrowserFileAdapter.onCloseRequested` starts the handler
   and lets the tab close whatever it resolves. localStorage writes inside the handler are
   synchronous, so state saves before the first `await` still land. The Tauri adapter
   (chip 6) is not affected.

3. **PDF.js asks "Leave site?" on a reload of the harness** when a viewer has unsaved
   changes. PDF.js adds its own `beforeunload` handler inside each iframe whose form store
   is modified. Chrome shows one prompt and logs "Blocked attempt to show multiple
   'beforeunload' confirmation panels" for each other dirty viewer. Harmless in the
   harness. For the Tauri window, see decision 8.

4. **PDF.js marks some files changed when nothing changed** (spec 9.5 `hasChanges`). The
   harness shows two cases. Neither loses data. Both nag, and PDFluffer promises no
   nagging.
   - **A radio group with a selected button.** On a `form-basic.pdf` saved with Post
     chosen, the tab turns dirty seconds after opening, with no edit. PDF.js's form store
     then held `{value: false}` for the two other buttons in the group (`24R`, `29R`), and
     `_annotationStorageModified` was true. Rendering the selected button writes "off" for
     its siblings. Seen on two separate opens.
   - **Entering the signature tool** on a file that already carries saved annotations
     turned the tab dirty before anything was placed.

   The effect: closing such a tab asks Save, Discard, Cancel, and Save writes a harmless
   append. Ruled 2026-09-19: chip 7 investigates. Do not change `hasChanges` before then.
