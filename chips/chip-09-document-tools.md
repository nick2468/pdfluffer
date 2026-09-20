# Chip 9 - the Document tools, Revert, backup, and the final check list

You are the builder for PDFluffer, in `C:\Users\nick2\Code\pdfluffer`. A separate
orchestrator session wrote the spec and reviews your work. This chip is your whole task.
It is the **last build chip**. After it, the user tests everything once.

## Where things stand

Chips 1 to 8 are done and reviewed. 304 npm tests and 17 cargo tests pass. The engine seam,
`SessionManager.runOp`, and the pdf-lib adapter (insert PDF, rotate, flatten fields and
annotations) all work and are unit tested. The flatten stop rule did **not** trip. Chip 8's
deviations 19 to 21 are **ratified**. Nothing registers the adapter yet, and there is no
Document menu.

The user confirmed on 2026-09-21 that the desktop app opens, saves and restores a real
file. All other USER checks wait for one final pass, which this chip prepares.
**Do not start `tauri dev`**: the app is single-instance. Work in the browser harness.

## Read first

1. `CLAUDE.md` and `BUILD-NOTES.md`.
2. `pdfluffer-spec.md` sections 11.3, 11.5, 13.2, 13.5, 13.6, 16 (H11 and the U checks), 17.
3. `src/app/services.ts`, `AppMenu.tsx`, `SettingsDialog.tsx`, `src/tools/toolRegistry.ts`,
   `src/session/SessionManager.ts` (`runOp`) and `docs/user-checks-phase-1.md`.
4. `pdfluffer-plan.md` - you do **P2.7 to P2.9**.

## The work

### 1. P2.7 - the four tools and the Document submenu

- `src/tools/documentTools.ts` exports the four tools of spec 13.5 as plain objects. They
  call `ctx.session.runOp(...)`. They import nothing from React or `src/app`.
  - **Insert PDF at end...**: `files.pickFiles()`, then for each ref in order `readFile`
    and one `pages.insertPdf` op. Stop at the first op that returns false. A file that
    fails to read shows the existing "Could not open" style of message through
    `ctx.dialogs` and stops. Picking nothing does nothing.
  - **Rotate all pages right / left**: `pages: 'all'`, 90 and -90.
  - **Rotate this page right**: needs the current page. Add
    `SessionManager.currentPage(tabId): number | null`, read from the stored view state
    (null when unknown, and then the tool does nothing). Test-first.
  - **Flatten...**: confirm first with the spec 13.5 sentence, buttons `continue` and
    `cancel`. Put the texts in `dialogTexts.ts`.
- `services.ts` builds one `EngineRegistry` holding `PdfLibAdapter`, one `ToolRegistry`
  holding the four tools, and passes `engines` to the `SessionManager`.
- `AppMenu.tsx` gains the **Document** list, built from `tools.available(engines)`, shown
  as a nested list like Recent. Items are disabled without a `ready` active tab. While an
  operation runs, the menu is closed and a second operation cannot start: guard it in the
  manager with a per-tab "busy" flag, test-first (`runOp` on a busy tab returns false).
- **Load pdf-lib lazily.** Change `PdfLibAdapter` so `@cantoo/pdf-lib` is loaded with a
  dynamic `import()` inside `run`, with type-only imports at the top. The app must start
  without fetching that chunk. Check in the harness network panel, and check that
  `npm run build` emits it as its own chunk. If strict typing makes this ugly, keep the
  static import and record why.

### 2. P2.8 - Revert to saved, and the backup setting

- `SessionManager.revert(tabId)`, test-first, per spec 13.6. Only on a `ready` tab.
  Confirm with title "Revert to saved?" and body "This discards every change since the
  last save.", buttons `continue` (kind `danger`) and `cancel`. Then re-read the file. A
  read failure shows a dialog and changes nothing. On success clear
  `pendingEngineChanges`, the held unsaved mode (chip 4, deviation 11) and
  `rewriteAcknowledged`, recompute `hasDigitalSignature`, and reload the viewer with the
  current view. The tab ends clean. `saveConfirmed` is kept.
- The app menu gains **Revert to saved**, enabled only when the active tab is dirty.
- Unhide the `keepBackup` checkbox in Settings. Check that `save` already passes
  `settings.keepBackup` to `writeFile`. If it does not, fix it test-first. The browser
  adapter ignores the flag; the Rust side already implements it (chip 6).

### 3. P2.9 - harness check H11, then regressions

In a browser against `npm run dev`, record each as "builder checked" or "USER check":

1. Insert: open `three-pages.pdf`, insert `form-basic.pdf`. Four pages. The tab is dirty.
2. Rotate all right, then rotate this page right on page 2. Page 2 differs from the rest.
3. Flatten a form with a filled field, added text and a placed signature. After it, none
   can be selected or edited, and they still look the same.
4. Save after an operation, reload the page: the changes are in the file.
5. Revert after an operation: the document returns to the saved state and the tab is clean.
6. An operation on `fake-signed.pdf` shows the digital signature guard. Cancel changes
   nothing.
7. Cancel in the Flatten confirm changes nothing.
8. Regressions: H1, H2, H5 and H8 still pass. The false-dirty case from chip 7 (reopen a
   form with a selected radio button, wait ten seconds) is still clean.
9. The pdf-lib chunk is not requested until the first operation.

### 4. The final check list for the user

Write **`docs/user-checks-final.md`**, replacing `docs/user-checks-phase-1.md` (delete the
old file with `git rm`). One list the user can follow cold, in one sitting:

- Keep the "Before you start" section, the test folder, and the `npm.cmd` command lines.
- **Order by importance**, most load-bearing first, so an early failure is found early:
  install and launch; open, fill, save, reopen (mark this one "passed 2026-09-21 in the dev
  app, repeat once in the installed app"); double-click to open and single instance;
  session restore; close with unsaved edits (Save, Discard, Cancel, and no "Leave site?"
  prompt); the half-typed text box check (U13); signatures; the saved file in Acrobat,
  Chrome and Edge; print; page reorder by dragging thumbnails with the U4 decision rule;
  drag a PDF onto the window; file locked by another program; file not found and Locate;
  copy and paste text; the phase 2 tools (insert, rotate, flatten, revert, backup file
  created); a flattened signed form in Acrobat, Chrome and Edge (P2.10); the console in the
  dev app for CSP errors; and last, **looks and feel**, with a few prompts (tab bar,
  menu, dialogs, dark mode, anything awkward).
- Number them F1 upward. For each: steps, what to expect, and what to report if it fails.
- End with a short table the user can fill: number, pass or fail, notes.

### 5. A fresh installer

With the Rust PATH set, run `npm run tauri build` once at the very end, after the last
code commit. Record the installer path, size and build time. Do not run the installer.

## Decision rules

- The manager owns behaviour. Tools and components call it. No engine or save logic in React.
- If a harness check fails because of a bug in earlier chips' code, fix it **with a test
  first** and record it under "Deviations".
- No new dependencies. No CSS framework. UI text in Australian English.
- Do not change `hasChanges`, the save flow's rules, or anything in `src-tauri/`, except a
  recorded fix for a failing check.

## Out of scope

Undo for operations, rotating a chosen page range, a progress bar, tab reordering, a custom
icon, the extension, anything in spec section 3. Do not edit the spec or the concept.
Never edit `public/pdfjs/`.

## Escalation

On a contradiction, or after three honest failed attempts at one item: stop that item,
write it under "Questions for the user" in `BUILD-NOTES.md`, and continue elsewhere.

## Acceptance - check each yourself and say how

1. `npm run check` passes with the new tests. `npm run build` succeeds.
2. With the PATH set, `cargo test` still passes.
3. `grep -rln "@cantoo/pdf-lib" src` prints only `src/engine/pdfLibAdapter.ts` and its test.
4. `grep -rln "PDFViewerApplication" src` prints only `src/viewer/PdfJsViewer.ts`.
   `grep -rln "@tauri-apps" src` prints only `src/files/tauriFileAdapter.ts`.
5. `git status --porcelain public/pdfjs` prints nothing. `package.json` dependencies are
   unchanged.
6. The nine harness checks are recorded.
7. `docs/user-checks-final.md` exists, and `docs/user-checks-phase-1.md` is gone.
8. The installer build result is recorded.
9. Plan boxes P2.7 and P2.8 are ticked, and P2.9 only if every harness check is "builder
   checked" and passed. P1.14, P1.20, P1.21, P2.10 and P2.11 stay unticked.

## Conventions

Follow the Git and Style sections of `CLAUDE.md`. Small commits. Never push. No em dashes
under `src/`. End each commit with a `Co-Authored-By:` trailer naming the model you are.
Commands you hand to the user say `npm.cmd`.

## Closing report

What you built, how you checked each acceptance item, the harness table, the test counts,
the installer path and size, every deviation and question, and `git log --oneline` since
chip 8.
