# Chip 3 - file adapters and the pure logic

You are the builder for PDFluffer, in `C:\Users\nick2\Code\pdfluffer`. A separate
orchestrator session wrote the spec and reviews your work. This chip is your whole task.

## Where things stand

Chips 1 and 2 are done and reviewed. `src/viewer/PdfJsViewer.ts` works: it mounts PDF.js in
an iframe, loads bytes, reports dirty, and exports safely. Fallback B is **not** needed.
`src/app/App.tsx` is a throwaway spike page. It stays until chip 5.

The orchestrator **ratified deviation 7**: spec 9.4 now names the constructed stylesheet.
Move question 1 in `BUILD-NOTES.md` from "Questions for the user" to "Decisions taken under
a named rule", with one line saying spec 9.4 was updated on 2026-09-19.

Phase 1 is split over four chips. This one builds the parts that need no UI and no PDF.js:
plain TypeScript with unit tests. Chip 4 builds the session manager on top of them.

## Read first

1. `CLAUDE.md` and `BUILD-NOTES.md`.
2. `pdfluffer-spec.md` sections 8.1, 8.2, 8.6, 12.1 (the history rule), 12.3 (only
   `decideSave`), 12.4 (only `hasDigitalSignature`), and 15 items 1 to 3.
3. `pdfluffer-plan.md` - you do **P1.1 to P1.4**.

## The work

### 1. P1.1 - file adapters, in `src/files/`

- `FileAdapter.ts`: copy spec 8.1 exactly.
- `fakeFileAdapter.ts`: `export class FakeFileAdapter implements FileAdapter`, for tests.
  An in-memory `Map<FileRef, { name: string; bytes: Uint8Array }>`. Test helpers:
  `addFile(ref, name, bytes)`, `removeFile(ref)`, `failNext(op: 'read' | 'write', ref, error: FileError)`,
  `queuePickFiles(refs)`, `queueSaveTarget(ref | null)`, `setPending(refs)`,
  `emitOpenRequest(refs)`, `requestClose(): Promise<boolean>` (runs the registered close
  handler), and public arrays `writes`, `titles`, `opened` recording calls. `sameFile`
  compares lower-cased strings. `readFile` returns a **copy** of the bytes. State lives in
  a `Map` and is deep-cloned with `structuredClone` on load and save.
- `browserFileAdapter.ts`: per spec 8.2, with `idb-keyval`. `FileRef` is `mem:<uuid>`.
  `pickSaveTarget` uses `window.prompt` for the name, appends `.pdf` if missing, creates an
  empty virtual file and returns its ref. `describe` returns `"(browser harness) " + name`.
  `nameOf` must work synchronously, so keep an in-memory `Map<FileRef, string>` of names,
  filled from IndexedDB by an `init()` that `createFileAdapter` awaits.
- `tauriFileAdapter.ts`: **not in this chip.**
- `index.ts`: `export async function createFileAdapter(): Promise<FileAdapter>`. It returns
  the browser adapter for now. Leave a `TODO(chip 6)` comment where the Tauri branch goes,
  with the `'__TAURI_INTERNALS__' in window` test from spec 8.1.

### 2. P1.2 - `src/util/hasDigitalSignature.ts`

Per spec 12.4. Scan the `Uint8Array` directly for the ASCII bytes of `/ByteRange`. Do not
decode the file to a string. Tests per spec 15.1. Read the sample files with `node:fs` in
the test.

### 3. P1.3 - state, in `src/session/state.ts`

- The three schema types from spec 8.6, plus `ViewState` imported from `Viewer.ts`.
- `parseSession(value: unknown): SessionStateV1`, `parseHistory(...)`, `parseSettings(...)`.
  Each returns the default when the value is missing, not an object, has the wrong
  `version`, or has a wrongly shaped field. Each logs **one** `console.warn` in that case,
  except for `null` or `undefined`, which is a normal first run and logs nothing.
  Defaults: empty tabs and `activeTabId: null`; empty items; `restoreSession: true`,
  `keepBackup: false`.
- History helpers, all pure, all returning a **new** array:
  `touchHistory(items, ref, name, nowIso, sameFile)` moves or inserts to the front and trims
  to 100. It keeps the existing `view` when the file was already there.
  `setHistoryView(items, ref, view, sameFile)`. `viewFor(items, ref, sameFile): ViewState | null`.
  `recentItems(items)` returns the first 15.
- `createDebouncedSaver<T>(files, key, delayMs = 500)` returning `{ set(value: T): void;
  flush(): Promise<void> }`. `set` restarts the timer. `flush` writes the latest value at
  once and cancels the timer. It does nothing if there is nothing pending.

Tests per spec 15.3, plus: the history helpers (move to front, keep view, cap at 100, first
15), and the saver with `vi.useFakeTimers()` (one write after several quick `set` calls,
`flush` writes at once, `flush` with nothing pending writes nothing).

### 4. P1.4 - `src/session/decideSave.ts`

Copy the signature from spec 12.3. Order of checks, exactly:

1. `!dirty` gives `'nothing-to-save'`.
2. `mode === 'rewrite' && hasDigitalSignature && !rewriteAcknowledged` gives `'guard-signature'`.
3. `!saveConfirmed` gives `'ask-first-save'`.
4. Otherwise `'write'`.

Test the full truth table with `it.each`: every combination of the five inputs, 48 rows,
computed against those four rules written out independently in the test.

### 5. A quick harness check of the browser adapter

The browser adapter cannot be unit tested under Node, so check it through the spike. In
`src/app/App.tsx`, swap the file input for a button that calls `pickFiles()` then
`readFile()`. Add a **Write back** button that calls `writeFile(ref, exportedBytes, ...)`.
Store the ref with `saveState('spike-ref', ref)`. On start, if `loadState('spike-ref')` gives
a ref, `readFile` it and load it. Then check in a browser against `npm run dev`: open
`samples/form-basic.pdf`, fill a field, Export, Write back, reload the page. The file must
come back with the filled value. Record the result in `BUILD-NOTES.md`. Keep this small.
The spike is deleted in chip 5.

## Decision rules

- Tests run in Vitest's default `node` environment. Do not add `jsdom` or any dependency.
  `structuredClone`, `crypto.randomUUID` and `node:fs` are all available in Node 24.
- If strict TypeScript rejects spec code, make the smallest typing-only change and record
  it, as chip 2 did.
- `src/session` and `src/util` must import nothing from React, `src/app` or
  `PdfJsViewer.ts`. Importing **types** from `src/viewer/Viewer.ts` is fine.
- Delete `src/util/smoke.test.ts` once real tests exist.

## Out of scope

`DocumentSession`, `SessionManager`, dialogs, the app frame, tabs, shortcuts, spec 9.6, the
Tauri adapter, any Rust, phase 2. No new dependencies. Do not edit the spec or the concept.
Do not touch `PdfJsViewer.ts` except if a type it imports moves.

## Escalation

On a contradiction with the spec, or after three honest failed attempts at one item: stop
that item, write it under "Questions for the user" in `BUILD-NOTES.md`, and continue with
what does not depend on it.

## Acceptance - check each yourself and say how

1. `npm run check` passes, with tests for items 2, 3 and 4 above and for `FakeFileAdapter`
   (read returns a copy, `failNext` throws once, `sameFile` ignores case, close handler,
   state round trip).
2. `grep -rnE "from ['\"]react|PdfJsViewer" src/session src/util src/files` prints nothing.
3. `grep -rn "PDFViewerApplication" src` matches only `src/viewer/PdfJsViewer.ts`.
4. `git status --porcelain public/pdfjs` prints nothing.
5. The harness check in part 5 is recorded, marked "builder checked" or "USER check".
6. Plan boxes P1.1 to P1.4 are ticked. No other new box is ticked.

## Conventions

Follow the Git and Style sections of `CLAUDE.md`. One commit per plan item. Never push. No
em dashes under `src/`. End each commit with a `Co-Authored-By:` trailer naming the model
you are.

## Closing report

What you built, how you checked each acceptance item, the test count, every deviation and
question, and `git log --oneline` since chip 2. Claim nothing you did not run.
