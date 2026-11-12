# Chip 16 - save rotation, reorder tabs, licence notices

You are the builder for PDFluffer, in `C:\Users\nick2\Code\pdfluffer`. A separate
orchestrator session wrote the spec and reviews your work. This chip is your whole task.

**Run this after chip 15.** If `pdfluffer-plan.md` shows P6.6 to P6.9 unticked, stop and say so.

**Work in the main checkout, `C:\Users\nick2\Code\pdfluffer`, on `main`.** If your session
opened in a worktree under `.claude/worktrees/`, do not build, test or commit there. Run every
command in the main checkout. If your Write or Edit tool refuses a main-checkout path, write
the file through the shell, as chips 14 and 15 did.

## Where things stand

Chip 15 finished the text editor and passed review on 2026-11-05 (575 npm tests, 28 cargo
tests, every smoke test green). Version 0.2.0 is built but **not released**. The user then
asked for two fixes, and ruled that the licence notices found at chip 15's review go into the
same release. **This chip does all three, and 0.2.0 ships after its review.** The version
stays 0.2.0.

## Read first

1. `CLAUDE.md`.
2. `pdfluffer-spec.md` **section 22, all of it** (new, 2026-11-13). Then 9 (customising PDF.js
   from outside), 9.3 (view state), 11.2 (the tab bar), 13.3 (`runOp`), 13.5 (the tools) and
   20.5a (Save first).
3. `BUILD-NOTES.md`: the chip 15 review, and decision 32.
4. `src/viewer/PdfJsViewer.ts` (view state, `listenOnBus`, the events it emits),
   `src/viewer/Viewer.ts`, `src/viewer/fakeViewer.ts`, `src/tools/documentTools.ts`,
   `src/session/SessionManager.ts` (`runOp`, `publish`), `src/app/TabBar.tsx`,
   `src/app/AppMenu.tsx`, `src/app/SavedSignaturesDialog.tsx` (a dialog to copy),
   `scripts/build-signed.mjs`, `scripts/prod-smoke/run.mjs` and `cdp.mjs`.
5. `pdfluffer-plan.md`, phase 7. You do **P7.1 to P7.5**.

## Facts the orchestrator checked on 2026-11-13

- PDF.js 6.3.289's rotate buttons are `#pageRotateCw` and `#pageRotateCcw` in `viewer.html`
  (lines 641 and 644). They dispatch `rotatecw` and `rotateccw` on the event bus
  (`viewer.mjs` about line 16433), which PDF.js binds to `rotatePages(90)` and
  `rotatePages(-90)` (about line 20226). The keys R and Shift+R call `this.rotatePages(...)`
  directly from the keydown handler (about lines 21015 and 21048), not through the bus.
- `PdfJsViewer` already listens for `rotationchanging` (line 250), records
  `pagesRotation` in `getViewState` (line 400), and applies `view.rotation` on load (line 530).
- The tools already exist: `rotateAllRight` and `rotateAllLeft` in `documentTools.ts` call
  `unsavedPageEdits(ctx)` (the Save-first guard) and then `pages.rotate` on `all` through
  `runOp`, which runs the signature guard. The pdf-lib adapter does the rotation.
- `dragDropEnabled` is `true` in `tauri.conf.json` (line 21), for dropping files in from
  Explorer. With it, WebView2 gives HTML5 drag events to Tauri, so the tab drag must use
  pointer events.
- `SessionManager.publish()` compares the snapshot tab by tab and position by position, and
  writes the session state in `this.tabs` order. So reordering `this.tabs` and calling
  `publish()` saves the new order.
- `aboutDialog` in `dialogTexts.ts` is a plain `ChoiceDialog` with an OK button. The
  production CSP has `connect-src 'self'`, so `fetch("./licences.txt")` from the app's own
  origin is allowed.
- `node_modules/@embedpdf/pdfium/` holds `LICENSE` and `LICENSE.pdfium`. `public/pdfjs/LICENSE`
  is PDF.js's. `package.json`'s production dependencies: `@cantoo/pdf-lib`,
  `@embedpdf/pdfium`, five `@tauri-apps/*` packages, `idb-keyval`, `react`, `react-dom`.

## The work

### 1. Rotation is saved (P7.1, spec 22.1)

- Catch PDF.js's rotate commands in `PdfJsViewer.ts` (the only file allowed to touch PDF.js)
  and emit a new viewer event, for example `rotaterequest` with `delta` 90 or -90. Add it to
  `Viewer.ts` and `fakeViewer.ts`.
- Catch them before PDF.js turns the view where you can do so from outside. The bus events
  can be intercepted. For the R keys, try a capture-phase keydown listener in the iframe that
  stops the event before PDF.js's own handler. Follow spec 22.1's fallback for any path that
  cannot be caught: let it turn, set `pagesRotation` back to 0, then emit. Record which
  paths needed that.
- Ignore R and Shift+R while the user types in a form field, a text box or a PDF.js editor,
  exactly as PDF.js itself does. Your listener must not take R away from typing.
- `SessionManager` handles the event by running the same thing as the Rotate all pages
  right or left tool, with its Save-first guard. Share the code rather than copy it.
- Stop restoring the view rotation: `applyViewState` sets 0, `getViewState` records 0. Keep
  `rotation` in the state schema so older state files still load. Update the tests.
- Tests: the fake viewer's event runs `pages.rotate` on `all` with the right degrees; a busy
  tab ignores it; Save first and the signature guard still stop it; the tab becomes dirty;
  a stored rotation of 90 is not applied.

### 2. Tabs reorder by dragging (P7.2, spec 22.2)

- `SessionManager.moveTab(tabId, toIndex)`: moves the tab, clamps the index, does nothing for
  an unknown id or the same place, and calls `publish()`. Tests: the order changes, the
  session state is saved in the new order, no tab becomes dirty, no viewer loads.
- A pure `src/util/tabDrop.ts` that turns the pointer's x and the tabs' left and right edges
  into the drop index, with table tests (first place, last place, the tab's own place, past
  either end).
- In `TabBar.tsx`, pointer events with `setPointerCapture`: a drag starts after 5 CSS pixels
  of movement with the main button held; the tab follows the pointer horizontally and the
  others move aside (a CSS transform is enough); pointerup calls `moveTab`; Escape or
  `pointercancel` puts it back. A click with no drag still activates the tab, and middle-click
  still closes it. The close button never starts a drag. The `+` button stays last.
- If the tab bar scrolls (many tabs), dragging near either edge may scroll it. If that is
  hard, leave it, and record it.

### 3. Licence notices (P7.3 and P7.4, spec 22.3)

- `scripts/make-notices.mjs` (plain Node, no new dependency) writes `public/licences.txt`
  exactly as spec 22.3 says. Add `"notices": "node scripts/make-notices.mjs"` to
  `package.json`. `--check` compares the generated text with the committed file and exits 1
  with a clear message when they differ.
- Rust: `cargo metadata --format-version 1 --offline --filter-platform x86_64-pc-windows-msvc`
  in `src-tauri/`, with the Rust PATH set inside the script's environment
  (`%USERPROFILE%\.cargo\bin`). Follow `resolve.nodes[].deps[].dep_kinds` from the
  `pdfluffer` package, keeping only kinds with `kind: null` (normal). Read each package's
  licence files from the folder of its `manifest_path`: `LICENSE*`, `LICENCE*`, `COPYING*`,
  `NOTICE*`, `UNLICENSE`.
- Write the file with `\n` line endings, sorted by package name, so a rerun on the same tree
  gives the same bytes.
- `scripts/build-signed.mjs`: the preflight runs `node scripts/make-notices.mjs --check` and
  refuses on failure.
- The About dialog gets a **Licences** button beside OK. It opens a `LicencesDialog`
  (React, plain CSS) that fetches `./licences.txt` and shows it in a scrolling monospace box,
  with a Close button. While it loads it says "Loading the licences...". If the fetch fails it
  says "PDFluffer could not load its licence notices." with the reason. Strings go in
  `dialogTexts.ts`. Australian English: licence as a noun.
- README's Licence section: one line saying the notices for every bundled component are in
  the app under About, Licences, and in `public/licences.txt`.
- **The size:** expect a few hundred kilobytes, mostly from the Rust crates. If the file
  passes 3 MB even with shared texts, record the size and continue.

### 4. The release-build test, the build, the docs (P7.5)

`scripts/prod-smoke/fixes.mjs`, with `"smoke:fixes"` in `package.json`, following `run.mjs`'s
safety rules exactly (refuse if PDFluffer runs, temp copies of `samples/`, back up, clear and
restore the user's state, `Page.bringToFront` on every connection). Use the reopen-the-menu
pattern (`chooseMenuItem` in `run.mjs`): the menu closes when the window loses focus, and
the test runs on the user's real desktop. It must prove:

1. Click `#pageRotateCw` in the PDF.js iframe on `three-pages.pdf`: the tab becomes unsaved,
   every page's `/Rotate` reads 90 (`pdfDocument.getPage(i).rotate`), and
   `pdfViewer.pagesRotation` is 0.
2. Press R in the viewer (a real key through CDP `Input.dispatchKeyEvent`, with the page
   focused, not in a field): the pages read 180.
3. Save with Overwrite, relaunch on the file: the pages still read 180, and the restored view
   rotation is 0.
4. With three tabs open, drag the first tab past the third with real mouse events through
   CDP `Input.dispatchMouseEvent` (press, several moves, release): the tab order is the new
   one, the active tab is the dragged one or unchanged as you designed it (say which), and
   nothing is unsaved.
5. A click with no movement on a tab only activates it, and the order is unchanged.
6. Close and relaunch: the tabs come back in the new order.
7. About, Licences: the dialog shows text that contains "MIT License", "PDFium", "pdf-lib",
   "React" and "tauri". Close it.
8. No console error, CSP violation or exception.

Then, with the Rust PATH set, a fresh `npm run tauri build` (unsigned) after your last code
commit. Record the installer's path, size and SHA-256. With PDFluffer closed, run:
`npm run smoke:fixes`, `npm run smoke:prod`, `npm run smoke:ocr`, `npm run smoke:edit`,
`node scripts/prod-smoke/backup.mjs` and `node scripts/prod-smoke/edit-probe.mjs`. All green.
If a smoke test fails once and passes on a rerun, record both runs and the cause you found.

## Decision rules

- Choose the option that loses no user data. A rotate must never turn a page twice, and a
  drag must never close, reload or dirty a tab.
- If the R key cannot be caught without editing PDF.js or without breaking R in form fields,
  use the fallback in spec 22.1 and record it.
- If a Rust crate has no licence file, use spec 22.3's rule and list it in BUILD-NOTES.
- No new dependencies. No em dashes under `src/` or `src-tauri/`. Never edit `public/pdfjs/`.
  Never commit a Windows font or a real document. `samples-private/` is never read.

## Out of scope

Keyboard shortcuts to move tabs, dragging a tab out to a new window, rotating single pages
from PDF.js, signing the build, tagging, releasing, pushing, the showcase site. Do not change
`bundle.publisher` or the version. Edit the spec only to record a decision rule you used,
marked as yours.

## Escalation

On a contradiction, or after three honest failed attempts at one item: stop that item, write
it under "Questions for the user" in `BUILD-NOTES.md`, and continue elsewhere.

## Acceptance - check each yourself and say how

1. `npm run check`, `cargo test` and `npm run build` pass.
2. `grep -rln "@embedpdf/pdfium" src` prints only the adapter and its test.
   `grep -rln "@tauri-apps" src` prints exactly the two allowed files.
   No file outside `src/viewer/PdfJsViewer.ts` reaches inside the iframe.
3. `npm run notices -- --check` passes on the committed file.
4. The six smoke runs above are green against the fresh build. If the user has the app open,
   do not close it: hand them over.
5. `git status --porcelain public/pdfjs` prints nothing.
6. Plan boxes P7.1 to P7.5 are ticked, each only if its tests pass. P6.10 and P6.11 stay open.

## Conventions

Follow the Git and Style sections of `CLAUDE.md`. Commit small: one plan item or a few. Never
push. End each commit with a `Co-Authored-By:` trailer naming the model you are. Record your
decisions as the next numbered decision in `BUILD-NOTES.md`.

## Closing report

What you built, how you checked each acceptance item, which rotate paths were caught before
PDF.js turned the view, the licences file's size and package counts (npm, Rust), any package
without a licence file, the installer path, size and SHA-256, the smoke results, every
deviation and question, and `git log --oneline` since `060921e`.
