# Chip 2 - the PDF.js bridge and the spike

You are the builder for PDFluffer, in `C:\Users\nick2\Code\pdfluffer`. A separate
orchestrator session wrote the spec and reviews your work. This chip is your whole task.

## Where things stand

Chip 1 is done and reviewed. The repo has the Tauri 2 + React scaffold, the pinned packages,
PDF.js 6.3.289 vendored unchanged in `public/pdfjs/`, four sample PDFs in `samples/`, and
`BUILD-NOTES.md` with facts F1 to F10 **all confirmed** and the PDF.js button ids.
`npm run check` and `cargo check` pass. There is no product code yet.

Chip 1's question about spec 9.5 was right. **The orchestrator has rewritten spec 9.5**
(`hasChanges` and `exportBytes`). Use the new text. The question is answered, so move it in
`BUILD-NOTES.md` from "Questions for the user" to "Decisions taken under a named rule",
with one line saying spec 9.5 was revised on 2026-09-19.

## Read first

1. `CLAUDE.md`.
2. `BUILD-NOTES.md`, all of it. It has the line numbers you will need.
3. `pdfluffer-spec.md` sections 7, 8.3, and **all of section 9**. Also 17 (phase 0 criteria).
4. `pdfluffer-plan.md` - you do **P0.9, P0.10, P0.11** and prepare P0.13.

## The task

Build the one file that talks to PDF.js, and prove on a throwaway page that it can open a
form, detect an edit, and export the edited bytes safely.

### 1. `src/viewer/Viewer.ts` (P0.9)

Copy the interface from spec 8.3 exactly. Add `export type ShortcutName = 'open' | 'save' |
'saveAs' | 'closeTab' | 'nextTab' | 'prevTab';`.

### 2. `src/viewer/PdfJsViewer.ts` (P0.9)

`export class PdfJsViewer implements Viewer`. In this chip implement:

- **Mounting**, spec 9.1 steps 1 to 5, and the options table in spec 9.2. One module-level
  `webviewerloaded` listener on `document`, registered at import time, which matches
  `event.detail.source` to the right iframe. Each option set in its own `try/catch`.
- **`load`**, spec 9.3, including applying a `ViewState` on `pagesinit` and rejecting on
  `documenterror`. Always pass `bytes.slice()`.
- **`viewchange` events**, spec 9.3.
- **The capture download manager, `hasChanges` and `exportBytes`**, spec 9.5 as revised.
  Copy the two code blocks. Do not simplify them.
- **The dirty poll** and `dirtychange`, spec 9.5.
- **`getViewState`, `setVisible`, `print`, `focus`, `on`, `destroy`.** `destroy` clears the
  timer, removes listeners and removes the iframe.
- **The injected stylesheet**, spec 9.4: `src/viewer/viewerInject.css`, hiding
  `#secondaryOpenFile`, `#downloadButton`, `#secondaryDownload`, `#viewBookmark` and
  `#viewBookmarkSeparator`. Those ids are confirmed in `BUILD-NOTES.md`.

**Leave for chip 3:** the event forwarders of spec 9.6 (keydown, click, dragover, drop).
Emit `shortcut` and `externallink` from nowhere yet. Keep the event types in place.

Rules for this file:

- Type PDF.js with a small local `interface PdfJsApp` that lists only the members you use.
  No `any` leaking out of this file. A narrow `as unknown as PdfJsApp` cast at the one
  place you read it off the iframe window is fine.
- This is the **only** file that may name `PDFViewerApplication` or touch the iframe (D7).
- Never edit anything under `public/pdfjs/` (D6).

### 3. The spike page (P0.10)

Replace the body of `src/app/App.tsx` with a throwaway spike. It is deleted in chip 3, so
keep it plain. It needs:

- A file input that reads a chosen PDF into a `Uint8Array` and calls `viewer.load(...)`.
- A full-height container holding one `PdfJsViewer`.
- A status line showing: page count, `isXfa`, the latest `viewchange`, and the dirty flag.
- An **Export** button that calls `exportBytes()` and shows the mode, the byte length, and
  whether the bytes differ from the loaded ones. On a thrown error it shows the message.
- A **Download export** link, harness only, so the exported file can be opened elsewhere.
- A **Reload from export** button that calls `viewer.load(exportedBytes, name, currentView)`.

### 4. Answer the dirty-signal question (P0.11)

Using the spike in a browser against `npm run dev`, with `samples/form-basic.pdf`, find out
and write down in `BUILD-NOTES.md` under "Decisions taken under a named rule":

1. After filling a field, does the dirty flag turn true within about a second?
2. After a successful **Export**, does it return to false **without** a reload?
   If yes, record "fallback B not needed". If no, record "fallback B applies" (spec 9.5)
   and say what you saw. Do not implement fallback B here. Chip 3 does that if needed.
3. After **Reload from export**, are the filled values still there, and is dirty false?
4. Add an annotation (the text tool), then delete it. Does dirty return to false?
5. Is the signature tool visible in the toolbar? Are Open and Download gone? Does Print
   remain?
6. Do any console errors or warnings appear? List them.

If you have a browser tool, do these yourself and say so. If you do not, write them as a
numbered USER check list with exact steps, and do not claim results.

## Decision rules

- If `webviewerloaded` never arrives, check that the listener is registered **before** the
  iframe's `src` is set, and that the listener is on the parent `document` (F1).
- If an option name is rejected, log it, record it, and continue. Do not add options that
  are not in spec 9.2. In particular leave `enableMerge` alone.
- If `load` never resolves, check you are awaiting `initializedPromise` before `open`.
- If a PDF.js member in spec 9 does not exist at runtime in 6.3.289, stop that part and
  record exactly what exists instead. Do not guess at a replacement.
- Vite imports a CSS file as text with the `?raw` suffix. If TypeScript complains about the
  import, `src/vite-env.d.ts` already references `vite/client`, which declares it.

## Out of scope

File adapters, sessions, tabs, the app frame, dialogs, shortcuts, Rust commands, anything
in phase 1 or 2, and spec 9.6. No new dependencies. Do not edit the spec or the concept.

## Escalation

On a contradiction with the spec, or after three honest failed attempts at one item: stop
that item, write it under "Questions for the user" in `BUILD-NOTES.md`, and continue with
what does not depend on it. Chip 1's question was exactly the right kind. Do that again.

## Acceptance - check each yourself and say how

1. `npm run check` passes. `tsc` reports no `any` escaping `PdfJsViewer.ts`.
2. `grep -rn "PDFViewerApplication" src` finds matches only in `src/viewer/PdfJsViewer.ts`.
3. `git status --porcelain public/pdfjs` prints nothing.
4. The six findings of part 4 are recorded, each marked "builder checked" or "USER check".
5. Plan boxes P0.9, P0.10 and P0.11 are ticked only if you verified them yourself.
   P0.13 and P0.14 stay unticked.

**USER check (P0.13), do not tick:** give the user the exact PowerShell lines to run
`npm run tauri dev` with the Rust PATH set, and ask them to repeat part 4 in the Tauri
window with the developer tools open (right-click, Inspect), watching for CSP errors.

## Conventions

Follow the Git and Style sections of `CLAUDE.md`. Small commits. Never push. No em dashes
under `src/`. End each commit with a `Co-Authored-By:` trailer naming the model you are.

## Closing report

What you built, how you checked each acceptance item, the six findings, every deviation and
question, and `git log --oneline` since chip 1. Claim nothing you did not run.
