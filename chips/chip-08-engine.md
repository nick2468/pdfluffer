# Chip 8 - the engine adapter and the document operations

You are the builder for PDFluffer, in `C:\Users\nick2\Code\pdfluffer`. A separate
orchestrator session wrote the spec and reviews your work. This chip is your whole task.

## Where things stand

Chips 1 to 7 are done and reviewed. 248 npm tests and 17 cargo tests pass. Phase 1 is built.
Its USER checks wait for one final test pass at the end of the build, by the user's ruling.
So **do not wait for them, and do not start `tauri dev`**: the app is single-instance and
your launch would hand off to the user's window.

Chip 7 is **ratified in full**: the effective-change rule (decision 10), committing the
open editor before every dirty decision (decision 11), and `Viewer.commitPendingEdits()`.
Spec 8.3 and 9.5 now say so. Move nothing; just know it.

This chip starts phase 2. It builds the engine seam and the three document operations as
plain TypeScript proven by unit tests. It adds **no UI**. Chip 9 adds the menu.

## Read first

1. `CLAUDE.md` and `BUILD-NOTES.md`.
2. `pdfluffer-spec.md` sections 13.1 to 13.4 and 15 item 7. Also 12.4 for the guard dialog.
3. `src/session/SessionManager.ts`, `saveFlow.ts` and `dialogTexts.ts`.
4. `pdfluffer-plan.md` - you do **P2.1 to P2.6**.

## The work

### 1. P2.1 - the seams, in `src/engine/` and `src/tools/`

- `src/engine/EngineAdapter.ts`: copy spec 13.1 exactly.
- `src/engine/engineRegistry.ts`: `export class EngineRegistry` with `register(adapter)`,
  `findAdapter(capability): EngineAdapter | null` (the first registered adapter that has
  it) and `has(capabilities: Capability[]): boolean`. A class, not a module global, so
  tests stay isolated.
- `src/tools/toolRegistry.ts`: the `Tool` interface from spec 13.2 and `export class
  ToolRegistry` with `register(tool)` and `available(engines: EngineRegistry): Tool[]`,
  which returns, in registration order, the tools whose every `needs` entry some adapter
  has. **Register no tools in this chip.**

Tests: a tool with a missing capability is not listed, order is kept, the first matching
adapter wins, and the five reserved capability names compile and match nothing.

### 2. P2.2 - `SessionManager.runOp(tabId, op)`

Per spec 13.3. The manager takes the `EngineRegistry` as a new **optional last**
constructor option (`options.engines`), so every existing test still compiles. Rulings:

- Works only on a `ready` tab. Returns `Promise<boolean>`: true when the operation changed
  the document. It never rejects for a user-level failure.
- Order: `commitPendingEdits()` and refresh dirty (as chip 7 does for save), then the
  signature guard, then `exportBytes()`, then `adapter.run`.
- **The guard** uses the spec 12.4 title and body, with buttons `continue` and `cancel`
  only. Add the texts to `dialogTexts.ts`. `continue` sets `rewriteAcknowledged`, so the
  later save does not ask again. `cancel` returns false and changes nothing.
- **Export first.** If `exportBytes()` returns bytes, they become `session.bytes`, and the
  tab's held unsaved mode (chip 4, deviation 11) becomes `rewrite`. If it throws, show the
  "Could not save" dialog and return false.
- **No adapter** for the capability: return false and log a warning. No dialog.
- **`EngineError('encrypted')`** shows a dialog with title "Cannot change this PDF" and the
  spec 13.3 sentence. Any other engine failure shows the same title with "PDFluffer could
  not apply that change. The document is unchanged." Both have one `ok` button. In both
  cases `session.bytes` must still be what it was before `adapter.run`.
- **Success:** set `session.bytes`, set `pendingEngineChanges` true, mark the tab dirty,
  recompute `hasDigitalSignature` from the new bytes, and reload the viewer with
  `viewer.load(bytes, name, currentView)`. If the reload fails, the tab goes to the `error`
  status. Nothing reaches disk until the user saves.
- **Save after an operation** must write `session.bytes` with mode `rewrite`, even when the
  viewer itself reports no changes. Check how `saveFlow.ts` picks its bytes and mode, and
  make `pendingEngineChanges` feed it. A successful write clears `pendingEngineChanges`.
- The capability for each op kind is the op's `kind` string.

Tests, with a small `FakeEngine` adapter: a successful op marks dirty, reloads the viewer
once with the new bytes and keeps the view; save afterwards writes the engine's bytes in
`rewrite` mode and clears the flag; pending form edits are exported before the op runs and
are inside the bytes the engine receives; the guard asks on a signed file, `cancel` runs
nothing, `continue` runs and the later save does not ask again; `encrypted` and a generic
failure each show their dialog and leave the bytes alone; no adapter returns false; a tab
that is not `ready` returns false; closing a tab with `pendingEngineChanges` asks Save,
Discard, Cancel.

### 3. P2.3 to P2.6 - `src/engine/pdfLibAdapter.ts`

Per spec 13.4, with `@cantoo/pdf-lib` 2.11.1. `name` is `"pdf-lib"`. Every result has mode
`rewrite`. One commit per operation.

- **Encrypted input:** `PDFDocument.load` throws for an encrypted file. Catch **only that
  case** and throw `EngineError('encrypted', ...)`. Find the real error class or message in
  the installed package and test against a truly encrypted file. `@cantoo/pdf-lib` can
  encrypt on save; if it can, build the test file with it. If you cannot produce one,
  say so, and test the mapping with a mocked load failure instead. Any other failure is
  `EngineError('failed', ...)`.
- **insertPdf (P2.3):** load both, `copyPages` every page of `other`, `addPage` each.
  An encrypted `other` is also `encrypted`.
- **rotate (P2.4):** `pages` is 1-based page numbers, or `'all'`. New rotation is
  `((current + degrees) % 360 + 360) % 360`. A page number out of range is
  `EngineError('failed')`.
- **flatten form fields (P2.5):** `doc.getForm().flatten()` inside `try/catch`. A file with
  no form is not an error.
- **flatten annotations (P2.6):** the algorithm in spec 13.4, exactly. Put the geometry in
  a pure function, `placementFor(bbox, matrix, rect)`, returning `{ sx, sy, tx, ty } |
  null`, and unit test it: identity matrix, a `/Rect` with swapped corners, a 90 degree
  matrix, a zero-size box returning null. **The stop rule in spec 13.4 applies to this item
  alone.** If it trips, ship P2.5 only, leave P2.6 unticked, and record why.

Tests per spec 15 item 7, building every input with `@cantoo/pdf-lib` inside the test. For
flatten, build a page with a form field, a link annotation, and a `Stamp` annotation that
has a real `/AP /N` form XObject. After flatten: no form fields, the stamp gone from
`/Annots`, the link still there, and the page's content stream holds a `Do` operator.
Also test that flattening twice changes nothing the second time, and that a document with
no `/Annots` passes through.

## Decision rules

- `src/engine` and `src/tools` import nothing from React, `src/app` or `PdfJsViewer.ts`.
  Only `pdfLibAdapter.ts` may import `@cantoo/pdf-lib`.
- Read `@cantoo/pdf-lib`'s own type definitions in `node_modules` for the low-level API
  (`PDFName`, `PDFArray`, `PDFDict`, `PDFRef`, `PDFStream`, `page.node`,
  `pushOperators`, the operator helpers). Do not guess names. If a name in spec 13.4 does
  not exist, use the real one and record it.
- Strict TypeScript may need small typing-only changes to spec code. Record them.
- Do not pass the caller's `Uint8Array` to anything that might keep or detach it. Copy.

## Out of scope

Any UI, the Document submenu, the four tools, Revert to saved, the backup checkbox
(all chip 9), the false-dirty rule, Tauri and Rust, new dependencies. Do not edit the spec
or the concept. Never edit `public/pdfjs/`.

## Escalation

On a contradiction, or after three honest failed attempts at one item: stop that item,
write it under "Questions for the user" in `BUILD-NOTES.md`, and continue elsewhere.

## Acceptance - check each yourself and say how

1. `npm run check` passes, with all the new tests, and every older test still passes.
2. `grep -rln "@cantoo/pdf-lib" src` prints only `src/engine/pdfLibAdapter.ts` and its test.
3. `grep -rnE "from ['\"]react|PdfJsViewer|src/app" src/engine src/tools` prints nothing.
4. `git status --porcelain public/pdfjs` prints nothing. `package.json` is unchanged.
5. Plan boxes P2.1 to P2.5 are ticked, and P2.6 only if its tests pass. No other new box.

## Conventions

Follow the Git and Style sections of `CLAUDE.md`. Small commits. Never push. No em dashes
under `src/`. End each commit with a `Co-Authored-By:` trailer naming the model you are.

## Closing report

What you built, how you checked each acceptance item, the test count, whether the flatten
stop rule tripped, every deviation and question, and `git log --oneline` since chip 7.
