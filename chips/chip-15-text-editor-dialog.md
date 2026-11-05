# Chip 15 - the text editor dialog

You are the builder for PDFluffer, in `C:\Users\nick2\Code\pdfluffer`. A separate
orchestrator session wrote the spec and reviews your work. This chip is your whole task.

**Run this after chip 14.** If `pdfluffer-plan.md` shows P6.1 to P6.5 unticked, stop and say so.

## Where things stand

Chip 14 built the PDFium text engine and passed review on 2026-11-05: 528 npm tests, 28 cargo
tests, `edit-probe.mjs` 15 of 15, every smoke test green. It added no UI. **This chip adds
the editor the user sees, its undo, the end-to-end smoke test and version 0.2.0.** After your
review the orchestrator makes the signed build, the user walks the install, and 0.2.0 ships.

## Read first

1. `CLAUDE.md`.
2. `pdfluffer-spec.md` **section 21, all of it.** It changed on 2026-11-05: E3 revised, E9
   gained clipping text, `EditNote` gained `edit`, 21.5 is now exact about clicks, focus
   loss, undo, Done and the history rule, and 21.6 gained items 6 and 7. Then 20.5a (Save
   first), 12.4 (the signature guard) and 13.3 (`runOp`).
3. `BUILD-NOTES.md` decisions 23 to 26 and 31 (how the engine behaves), and "Questions for
   the user" (chip 14's three, now ruled).
4. `src/engine/textEdit.ts`, `src/engine/pdfiumAdapter.ts`, `src/session/SessionManager.ts`
   (`runOp`, `runOpOnce`, `save`, `revert`, `confirmCloseAll`), `src/app/AppMenu.tsx`,
   `src/app/App.tsx`, `src/app/SavedSignaturesDialog.tsx` (a full React dialog to copy).
5. `pdfluffer-plan.md`, phase 6. You do **P6.6 to P6.9**, and write P6.11's check list.

## Facts the orchestrator checked on 2026-11-05

- `EngineRegistry.findAdapter('text.edit')` returns the PDFium adapter. It implements
  `TextEditEngine` from `textEdit.ts`. The dialog must reach PDFium only through that
  interface, so it never imports `@embedpdf/pdfium` (CLAUDE.md).
- App shortcuts already do nothing while any `dialog[open]` exists (`App.tsx`, the keydown
  handler). A modal `<dialog>` with `showModal()` therefore gives spec 21.5's shortcut rule
  for free, and a `ChoiceDialog` opened on top of it stacks in the top layer.
- `runOpOnce` holds the order to copy: commit pending edits, the signature guard
  (`OPERATION_GUARD_DIALOG`, then `rewriteAcknowledged`), export, then the engine on a copy,
  then `pendingEngineChanges`, `hasDigitalSignature`, `publish()`, `reload()`.
- `revert` clears `pendingEngineChanges` and `rewriteAcknowledged` (SessionManager.ts about
  line 462). `files.onCloseRequested(() => manager.confirmCloseAll())` is in `main.tsx`.
- `README.md` line 88 still says editing existing text is out of scope.
- `scripts/prod-smoke/edit-probe.mjs` expects "Page one" on `three-pages.pdf` to be drawn in
  a Windows font. Under the revised E3 it keeps Helvetica-Bold, so that check must change.

## The work

### 1. The engine rulings (part of P6.6)

In `pdfiumAdapter.ts`, with unit tests:

- **E3 revised.** A run's font that is not embedded (`FPDFFont_GetIsEmbedded` false) is kept
  when a trial text object in that font, given the new text with `FPDFText_SetText`, reads the
  same text back through `FPDFTextObj_GetText`. Destroy the trial object. Embedded fonts keep
  the proven-present rule. Tests: on a pdf-lib Helvetica run, "Page one" keeps Helvetica with
  no note; a character Helvetica's encoding cannot name (try "Ω") substitutes, with the note.
  If PDFium reads back an unencodable character as itself, so the trial cannot tell, stop
  this item, keep E3 as it was, and record the evidence.
- **`EditNote.edit`.** Each note carries the 0-based index of the edit that caused it, and
  appears once per edit, not once per list. Update the existing tests.
- Update `edit-probe.mjs` for the revised E3: "Page one" keeps its font with no
  `font-substituted` note, and a second replace with a character outside the encoding proves
  the Windows font path still works in the release build.

### 2. The history, in plain TypeScript (P6.7)

`src/session/textEditHistory.ts`, no React, with table-driven tests over a fake
`TextEditEngine`:

- Holds the base bytes, the edit list, the redo list, and how many steps undo may still take.
- `apply(edit)` appends, clears redo, and returns `{ bytes, notes }` from one `applyEdits`
  over the base. A refused edit (an `EngineError`) is not appended and its message comes back.
- `undo()` drops the newest edit onto the redo list, at most 20 steps back from the newest
  (spec 21.5). `redo()` puts it back. Both replay. `canUndo` and `canRedo` say whether they would act.
- The list is never shortened to keep it under 20 (spec 21.5 explains why).

In `SessionManager`, the history's life per spec 21.5's history rule:

- `beginTextEdit(tabId)`: the tab must be ready and not busy, and an engine must have
  `text.edit`. Then the Save-first guard (`hasStructuralChanges`, `SAVE_FIRST_DIALOG`), the
  signature guard, commit pending edits, export. It continues the tab's kept history only
  when the export mode is `none` **and** the tab's bytes are the ones the last Done produced
  (the same `Uint8Array`); otherwise a new history over the tab's bytes. It marks the tab
  busy, and returns the history, or null when a guard stopped it.
- `finishTextEdit(tabId, history)`: one `applyEdits` over the history's base, then exactly
  what `runOpOnce` does after its engine call (an encrypted file gets `ENCRYPTED_DIALOG`, any
  other failure `OPERATION_FAILED_DIALOG`). Keeps the history and the bytes it produced on the
  tab. Clears busy.
- `cancelTextEdit(tabId)`: clears busy, changes nothing.
- The kept history ends on a save, on Revert, and on any other `runOp`. Tests for each.
- Window close: while an editor is open with new edits, `confirmCloseAll` asks "Discard these
  text edits?" (**Discard** / **Keep editing**) before anything else, and Keep editing stops
  the close. The dialog registers what the manager needs; the manager does not import React.

### 3. The dialog (P6.6)

`src/app/TextEditorDialog.tsx`, plain CSS in `app.css`, opened by **Edit text...**, the first
item in the menu's Document section. The item shows when some engine has `text.edit` and is
enabled when the active tab is ready. Every behaviour is in spec 21.5; build exactly that.
Points the spec leaves to you:

- **Drawing.** Show `renderPage`'s RGBA on a canvas, fitted whole into the dialog's page
  area. Ask for `maxDimension` = the area's longer side times `devicePixelRatio`, and size the
  canvas in CSS pixels. Place each editable run's box from its `bbox` through `transform`.
  Each box is a `<button>` whose accessible name is the run's text, so the smoke test and a
  screen reader can find it. Runs that are not editable get no box (E9).
- **The input box** sits over the run's box, in a font size near the run's on screen, at
  least as wide as the box, growing as the user types.
- **Loading.** The first open loads PDFium's `.wasm`. Show "Loading the text editor..." until
  the first page is drawn.
- **Notes**, in plain words, under the toolbar. Use exactly:
  - `font-substituted`: "This text's own font lacks some of these letters, so it now uses {font}."
  - `runs-past-end`: "The new text is longer than the old, so it may overlap the text after it."
  - a refused edit: "PDFluffer could not make this edit. {message}"
- **Undo and Redo** are toolbar buttons and Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z, which act only
  when no input box has focus (in an input box they stay the browser's own text undo).
  PageUp and PageDown change page when no input box has focus.
- Put every user-facing string in `dialogTexts.ts`. Australian English.

### 4. The end-to-end smoke test (P6.8)

`scripts/prod-smoke/edit.mjs`, following `run.mjs`'s safety rules exactly (refuse if PDFluffer
runs, temp copies, back up and restore the user's state, `Page.bringToFront` on every
connection). Drive the real UI by DOM clicks, not the test hook. Use the reopen-the-menu
pattern from `ocr.mjs`'s `runTool` (commit `b465fba`): the menu closes when the window loses
focus, and the test runs on the user's real desktop. It must prove, on a copy of
`three-pages.pdf`:

1. PDFium is not fetched at start. **Edit text...** opens the dialog, the page is drawn, and a
   box named "Page 1" exists.
2. Replace "Page 1" with "Page A": the box "Page A" appears and no font note shows.
3. Insert "Added line" by Insert text and a click on an empty area: its box appears.
4. Delete the "Added line" box: it is gone. Undo: it is back. Redo: it is gone again.
5. Cancel with these edits asks "Discard these text edits?"; Keep editing keeps them.
6. Done: the tab shows unsaved, and PDF.js in the tab reads "Page A" on page 1.
7. Reopen the editor: Undo is enabled (the history continued). Undo once, Done: PDF.js reads
   "Added line" again.
8. Save (Overwrite): reopen the editor, and Undo is disabled (a save ends the history).
9. Relaunch the app on the saved file: PDF.js reads "Page A" and "Added line".
10. A replace with a character outside Helvetica's encoding shows the font note in the dialog,
    then Cancel and Discard leave the tab unchanged.
11. No console error, CSP violation or exception.

### 5. Version 0.2.0 and the docs (P6.9 and P6.11)

- Bump to **0.2.0** in `package.json`, `tauri.conf.json`, `Cargo.toml` (`Cargo.lock` follows).
  **Never change `bundle.publisher`.**
- `README.md`: add text editing to "What it does" (one bullet: change, insert and delete text
  line by line), and replace the "Editing existing text and images is out of scope" limit
  with the real limits from spec 21.6 in two or three plain lines. Images stay out of scope.
- `docs/user-checks-edit.md`, the USER check P6.11, in the style of `docs/user-checks-ocr.md`:
  before you start (install the release, work on a copy of a real PDF), then short numbered
  steps: change a word, insert a line, delete a line, undo and redo, Done, save, then open the
  file in Acrobat, Chrome and Edge and check the text and its look. Say what a font note
  means before asking the user to notice one. Explain any technical word in plain words
  first. Do not tick P6.11.
- With the Rust PATH set, a fresh `npm run tauri build` (unsigned) after your last code
  commit. Record the installer's path, size and SHA-256. Then, with PDFluffer closed:
  `npm run smoke:prod`, `npm run smoke:ocr`, `node scripts/prod-smoke/backup.mjs`,
  `node scripts/prod-smoke/edit-probe.mjs` and `node scripts/prod-smoke/edit.mjs`. All green.
  Add `smoke:edit` to `package.json` scripts for `edit.mjs`.

## Decision rules

- Choose the option that loses no user data. If a path could drop typed text or unsaved
  edits, stop and record it rather than guess.
- If one edit's replay takes over a second on a 20-page sample you generate in the test,
  record the timings, keep the design, and say so. Do not cache PDFium documents between
  calls without recording why.
- If PDFium's drawing and PDF.js's disagree visibly about where text sits, record it with
  numbers. The dialog shows PDFium's drawing, by E6.
- No new dependencies. No em dashes under `src/` or `src-tauri/`. Never commit a Windows font
  or a real document.

## Out of scope

Zoom in the editor, reflow, images, editing form fields or annotations, signing the build,
tagging, releasing, pushing, the showcase site. Do not edit the concept. Never edit
`public/pdfjs/`. Edit the spec only to record a decision rule you used, marked as yours.

## Escalation

On a contradiction, or after three honest failed attempts at one item: stop that item, write
it under "Questions for the user" in `BUILD-NOTES.md`, and continue elsewhere.

## Acceptance - check each yourself and say how

1. `npm run check`, `cargo test` and `npm run build` pass.
2. `grep -rln "@embedpdf/pdfium" src` prints only the adapter and its test.
   `grep -rln "@tauri-apps" src` prints exactly the two allowed files.
3. The five smoke runs above are green against the fresh build. If the user has the app
   open, do not close it: hand them over.
4. `git status --porcelain public/pdfjs` prints nothing.
5. Plan boxes P6.6 to P6.9 are ticked, each only if its tests pass. P6.10 and P6.11 stay open.

## Conventions

Follow the Git and Style sections of `CLAUDE.md`. Commit small: one plan item or a few. Never
push. End each commit with a `Co-Authored-By:` trailer naming the model you are.

## Closing report

What you built, how you checked each acceptance item, the E3 trial result, the replay timings,
the installer path, size and SHA-256, the smoke results, every deviation and question, and
`git log --oneline` since chip 14.
