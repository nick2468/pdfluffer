# Chip 4 - the session manager

You are the builder for PDFluffer, in `C:\Users\nick2\Code\pdfluffer`. A separate
orchestrator session wrote the spec and reviews your work. This chip is your whole task.

## Where things stand

Chips 1 to 3 are done and reviewed. Phase 0 is complete. You have, all tested (112 tests):
`src/files/` (`FileAdapter`, `FakeFileAdapter`, `BrowserFileAdapter`, `createFileAdapter`),
`src/util/hasDigitalSignature.ts`, `src/session/state.ts` (parsers, history helpers,
`createDebouncedSaver`), `src/session/decideSave.ts`, and `src/viewer/` (`Viewer`,
`PdfJsViewer`). `src/app/App.tsx` is still the throwaway spike. **Do not touch it.**

This chip builds the brain of the app: `DocumentSession` and `SessionManager`. It is plain
TypeScript with no React and no PDF.js, proven entirely by unit tests against fakes. Chip 5
puts the screen on top.

**One spec change to know:** spec 8.5 now has `setViewerHost(el)` instead of
`attachContainer(tabId, el)`, plus `handleShortcut`, `dismissXfaBanner`, settings, recent
and `clearHistory`. Read the new 8.5.

## Read first

1. `CLAUDE.md` and `BUILD-NOTES.md`.
2. `pdfluffer-spec.md` sections 8.3 to 8.6, 11.6, 11.7, **all of section 12**, and 15 items
   4 to 6.
3. `pdfluffer-plan.md` - you do **P1.5 to P1.8**.

## The work

### 1. `src/viewer/fakeViewer.ts` - a test double

`export class FakeViewer implements Viewer`. It records calls and lets a test drive it:
public `mounted`, `visible`, `destroyed`, `focusCount`, `printCount`, and
`loads: { bytes: Uint8Array; filename: string; view: ViewState | null }[]`. Setters:
`docInfo` (default `{ pageCount: 1, isXfa: false }`), `loadError: string | null`,
`nextExport: ExportResult | Error` (default `{ mode: 'none' }`), `viewState`. Methods
`setDirty(dirty)` (stores it, makes `hasChanges()` return it, emits `dirtychange`), and
`emit(event, ...args)`. A successful `exportBytes()` with a mode other than `none` calls
`setDirty(false)`, as the real viewer does. It ignores the container it is given.

### 2. `src/session/dialogTexts.ts`

Every dialog title, body and button as exported constants, so tests and the UI share them.
Use the exact wording in spec 12.3, 12.4, 12.5 and 12.8. Button ids, fixed:
`overwrite`, `saveAs`, `cancel`, `save`, `discard`, `continue`, `saveCopy`, `open`, `ok`.
Two messages the spec gives no dialog title for: use title "Could not save" for a failed
export or write, and "File is open elsewhere" for the Save As clash. Both have one `ok` button.

### 3. `src/session/DocumentSession.ts` and `SessionManager.ts` (P1.5 to P1.8)

Follow spec 8.4, 8.5 and section 12 closely. They are detailed on purpose. Extra rulings:

- **Constructor:** `new SessionManager(files, createViewer, dialogs, options?)` where
  `options` is `{ now?: () => string; newId?: () => string }`, defaulting to
  `new Date().toISOString()` and `crypto.randomUUID()`. Tests pass fixed values.
- **Snapshots.** `getSnapshot()` must return the **same object** until something changes,
  then a new one. `useSyncExternalStore` loops forever otherwise. Build the snapshot in one
  private `publish()` that also notifies listeners, updates the window title (spec 11.7),
  and feeds the debounced savers.
- **Viewer host.** Keep one `host: HTMLElement | null`. `activate` on an `unloaded` tab
  reads the file first, then mounts. If `host` is null, remember the tab as waiting and
  finish its load inside `setViewerHost`. Tests pass `{} as HTMLElement`.
- **Races.** `activate` is async. Keep one in-flight load promise per tab so a second
  `activate` of the same tab does not load twice. After every `await`, check the tab still
  exists. Only the tab that is active **at that moment** gets `setVisible(true)` and `focus()`.
- **Viewer events.** `dirtychange` updates the tab and publishes. `viewchange` stores the
  view and calls `setHistoryView`. `shortcut` calls `handleShortcut`. `externallink` runs
  the spec 12.8 dialog. `error` is logged.
- **`handleShortcut`** maps spec 11.6. `nextTab` and `prevTab` wrap around. With no active
  tab, everything except `open` does nothing.
- **Persistence.** Two savers from `createDebouncedSaver`: `session` and `history`.
  Settings save at once. `confirmCloseAll` flushes both savers before it returns true.
  The saved session holds only the fields of `SessionStateV1`, never bytes or status.
- **`start()`** follows spec 12.6 step by step, including "subscribe before taking pending".
  With `restoreSession` false, it starts with no tabs but still honours pending files.
- **Save paths** follow spec 12.3 exactly, using `decideSave`. `dirty` passed to
  `decideSave` is the tab's dirty flag. `mode` is the export's mode, or `rewrite` when
  `pendingEngineChanges` is true. Save As works on a clean tab and then needs no dialog.
  After a `rewrite` save, call `viewer.load(bytes, name, currentView)` again. After an
  `append` save, do not.
- **`pendingEngineChanges` and `rewriteAcknowledged`** exist as private fields, false for
  now. Phase 2 sets them. Do not add `runOp` or `revert` yet. Leave `revert` out of the
  class for now.
- **Close.** Spec 12.5. Closing the active tab activates the right neighbour, else the left.
- **Errors never escape** a public method as a rejected promise, except from a programming
  bug. A failed read sets the tab status. A failed save shows a dialog and returns false.

### 4. Tests (spec 15 items 4, 5 and 6)

In `src/session/SessionManager.test.ts`, with `FakeFileAdapter`, `FakeViewer` and a small
`FakeDialogs` whose `ask` returns queued button ids and records what it was asked. A test
that reaches an `ask` with nothing queued must fail loudly. Cover every bullet of spec 15
items 4 to 6, and also:

- a snapshot is reference-stable when nothing changed, and new after a change;
- lazy loading: three restored tabs create exactly one viewer until another is activated;
- activating while the host is null loads once the host is set;
- a second `activate` of a loading tab does not read the file twice;
- the window title follows spec 11.7, including the ` *`;
- `viewchange` reaches `history`, and a reopened file loads with that view;
- after an `append` save the viewer is not reloaded, after a `rewrite` save it is;
- the signature guard: `rewrite` on a signed file asks, `continue` proceeds and does not
  ask twice, `saveCopy` goes to Save As, `cancel` writes nothing;
- `restoreSession: false` starts empty but opens pending files;
- `nextTab` and `prevTab` wrap, and `handleShortcut('save')` saves;
- the external link dialog: `open` calls `openExternal`, `cancel` does not;
- `confirmCloseAll` flushes the savers, checked with fake timers.

## Decision rules

- If spec 12 and this chip disagree, this chip wins, and you record the point.
- If spec 12 leaves a case open, choose the option that loses no user data, and record it
  under "Deviations" as a small choice, as chip 3 did.
- Keep `SessionManager.ts` readable. If it passes about 500 lines, move the save and close
  flows into `src/session/saveFlow.ts` and `closeFlow.ts` as plain functions.
- No timers in the manager other than the debounced savers.

## Out of scope

React, `useSession`, the app frame, tabs UI, `ChoiceDialog`, spec 9.6, `App.tsx`, the Tauri
adapter, Rust, `runOp`, `revert`, phase 2. No new dependencies. Do not edit the spec or the
concept. Do not change `PdfJsViewer.ts`.

## Escalation

On a contradiction, or after three honest failed attempts at one item: stop that item,
write it under "Questions for the user" in `BUILD-NOTES.md`, and continue elsewhere.

## Acceptance - check each yourself and say how

1. `npm run check` passes, with the new tests.
2. `grep -rnE "from ['\"]react|PdfJsViewer|src/app" src/session` prints nothing.
3. `git status --porcelain public/pdfjs src/app` prints nothing.
4. Every bullet in part 4 maps to a named test. List the mapping in your closing report.
5. Plan boxes P1.5 to P1.8 are ticked. No other new box is ticked.

## Conventions

Follow the Git and Style sections of `CLAUDE.md`. Small commits. Never push. No em dashes
under `src/`. End each commit with a `Co-Authored-By:` trailer naming the model you are.

## Closing report

What you built, how you checked each acceptance item, the test count, the bullet-to-test
mapping, every deviation and question, and `git log --oneline` since chip 3.
