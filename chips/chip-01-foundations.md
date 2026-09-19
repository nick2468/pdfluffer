# Chip 1 - foundations

You are the builder for PDFluffer, in `C:\Users\nick2\Code\pdfluffer`. A separate
orchestrator session wrote the spec and will review your work. This chip is your whole task.
Do not go beyond it.

## Context in five lines

PDFluffer is a personal PDF reader and light editor for Windows with no ads and no network
use. It is a Tauri 2 desktop app with a React and TypeScript core. Each tab hosts the
unmodified PDF.js viewer app in an iframe. Nothing is built yet. This chip lays the
foundations. It writes no product code.

## Read first, in this order

1. `CLAUDE.md` - the standing rules. They bind you.
2. `pdfluffer-spec.md` sections 0, 2, 3, 4, 5, 6, 7, 10.1, 10.2, 10.5, 14 and 18.
3. `pdfluffer-plan.md` - you do items **P0.1 to P0.8 and P0.12** only.

## Facts you need (checked 2026-09-19)

- The folder is **not a git repo yet**. It holds only `.md` files and this `chips/` folder.
- Node 24.19.0 and npm 11 are on the PATH. git 2.45 is on the PATH.
- Rust 1.98 is installed at `%USERPROFILE%\.cargo\bin` and is **not on the PATH**. Start
  every command that needs `cargo` or `npm run tauri` with the PATH line from `CLAUDE.md`.
  The setting does not survive between tool calls.
- Visual Studio C++ tools, WebView2 and NSIS are already present. Install no toolchain.
- The PDF.js zip download needs the user's permission. Ask once, stating the file name,
  the GitHub release URL from spec 6.2, and that it is about 10 to 20 MB.

## The work, in order

1. **P0.1** Run `node --version`, then with the PATH set, `rustc --version` and
   `cargo --version`. Stop and report if Node is older than 24 or `rustc` is missing.
2. **P0.2** `git init -b main`. Write `.gitignore` exactly as spec 6.3. Write `.node-version`
   containing `24.21.0`. Commit the existing `.md` files, `chips/`, `.gitignore` and
   `.node-version` as the first commit.
3. **P0.3** Create `BUILD-NOTES.md` with the six headings from spec 18. Record the versions.
4. **P0.4** Scaffold per spec 10.1. Scaffold into `scaffold-tmp`, then move the files up.
   Never overwrite an existing `.md` file. If the first scaffold command prompts or hangs,
   cancel it and use the fallback in spec 10.1. Remove the demo component, demo Rust
   command and demo assets. Leave a plain page that shows the word "PDFluffer".
   Set Vite to port 1420 with `strictPort: true`.
5. **P0.5** Install only the packages in spec 5 (npm and Rust). Pin `@cantoo/pdf-lib` to
   exactly `2.11.1` and `vitest` to `^4.1.11`. Add npm scripts: `dev`, `build`,
   `check` (`tsc --noEmit && vitest run`), `samples`, `tauri`. Add one trivial test file,
   `src/util/smoke.test.ts`, so that `vitest run` has something to pass.
6. **P0.12** Set `tauri.conf.json` and `capabilities/default.json` to the values in spec
   10.2 and 10.5. Register the five plugins in `src-tauri/src/lib.rs` in the order spec 10.4
   gives: single-instance first, with an empty callback for now. Write **no** custom
   commands yet.
7. **P0.6** Vendor PDF.js 6.3.289 per spec 6.2 into `public/pdfjs/`, unchanged. Write
   `VENDOR-PDFJS.md` with the version, URL, date and SHA-256 of the zip. Delete the zip
   after unpacking, or keep it outside the repo.
8. **P0.7** Write `scripts/make-samples.ts` and generate the four files in spec 14 into
   `samples/`. If running TypeScript directly needs a tool not in spec 5, write the script
   as `scripts/make-samples.mjs` in plain JavaScript instead. Do not add a dependency.
9. **P0.8** Re-check facts F1 to F10 from spec 7 against the vendored files, mainly
   `public/pdfjs/web/viewer.mjs`. Search the file, do not read it whole. For each fact,
   record in `BUILD-NOTES.md`: confirmed or different, the text you searched for, and the
   line you found. Also record the real element ids of PDF.js's Open file, Download or
   Save, and current-view buttons from `public/pdfjs/web/viewer.html` (spec 9.4).
   If a fact is **different**, record exactly what you found. Do not design around it.
   That is the orchestrator's job.

## Decision rules

- A build error names the fix more often than not. Read it fully before changing anything.
- If a Tauri permission name in spec 10.5 is rejected, the error lists valid names. Use the
  closest one and record the change under "Deviations".
- If the scaffold picks versions of React, Vite or TypeScript, keep them. Do not upgrade or
  downgrade anything by hand.
- If `cargo` fails with "not found", you forgot the PATH line.

## Out of scope for this chip

`Viewer.ts`, `PdfJsViewer.ts`, any iframe, any file adapter, any session code, any Rust
command, the spike page (P0.9 to P0.11), and everything in phases 1 and 2. Do not edit
`pdfluffer-spec.md` or `pdfluffer-concept.md`. Never edit anything under `public/pdfjs/`.

## Escalation

On a contradiction with the spec, or after three honest failed attempts at one item: stop
that item, write it under "Questions for the user" in `BUILD-NOTES.md`, and carry on with
items that do not depend on it.

## Acceptance - check each yourself and say how you checked

1. `npm run check` passes.
2. With the PATH set, `cargo check` passes in `src-tauri/`.
3. `npm run dev` serves on port 1420. `http://localhost:1420/` shows "PDFluffer".
   `http://localhost:1420/pdfjs/web/viewer.html` loads the PDF.js viewer with its sample
   document. Check with a browser tool if you have one, otherwise with `curl` for HTTP 200
   on both URLs and on `/pdfjs/build/pdf.mjs`. Stop the dev server afterwards.
4. `git status` shows `public/pdfjs/` committed and unmodified, and nothing from
   `samples-private/`, `node_modules/`, `dist/` or `src-tauri/target/` tracked.
5. `samples/` holds the four PDFs, and `fake-signed.pdf` contains the text `/ByteRange`.
6. `BUILD-NOTES.md` has the environment, F1 to F10, and the three element ids.
7. Plan boxes P0.1 to P0.8 and P0.12 are ticked. No other box is ticked.

**USER check, do not tick:** with the PATH set, `npm run tauri dev` opens a window titled
PDFluffer showing the page. Give the user the exact command to run.

## Conventions

Follow the Git and Style sections of `CLAUDE.md`. Commit after each plan item or small
group. Never push. End each commit message with a `Co-Authored-By:` trailer naming the
model you actually are.

## Closing report

Finish with a short report: what you did, how you checked each acceptance item, every
deviation, every question, and the commit list from `git log --oneline`. Do not claim
anything you did not run.
