# Chip 5 - the app frame

You are the builder for PDFluffer, in `C:\Users\nick2\Code\pdfluffer`. A separate
orchestrator session wrote the spec and reviews your work. This chip is your whole task.

## Where things stand

Chips 1 to 4 are done and reviewed. 180 tests pass. You have a working `SessionManager`
(tabs, lazy load, save, close, restore, shortcuts, settings, history), a working
`PdfJsViewer`, and a working `BrowserFileAdapter`. `src/app/App.tsx` is still the throwaway
spike. This chip replaces it with the real screen, running in the **browser harness**
(`npm run dev`). The Tauri side is chip 6.

Chip 4's deviation 11 (a tab stays dirty until its exported bytes reach disk) is **ratified**.
It was a real data-loss catch. Nothing to do about it.

**One spec change, answering chip 4's known issue 3:** `SessionSnapshot` now also carries
`recent` and `settings` (spec 8.5). Do that first: add both to the snapshot, make
`clearHistory`, `updateSettings` and every history change publish, and add tests that the
snapshot changes after each. Keep `getRecent()` and `getSettings()`. Then move known issue
3 in `BUILD-NOTES.md` to "Decisions taken under a named rule".

## Read first

1. `CLAUDE.md` and `BUILD-NOTES.md`.
2. `pdfluffer-spec.md` sections 9.6, **all of 11**, 12.4, 12.7, 12.8, 16 (H1 to H10), 19.
3. `src/session/SessionManager.ts` and `dialogTexts.ts`, so you use what exists.
4. `pdfluffer-plan.md` - you do **P1.9 to P1.14**.

## The work

### 1. P1.9 - finish `PdfJsViewer.ts`

Add the three capture-phase forwarders of spec 9.6 on the iframe's `window`: keydown
(emitting `shortcut`, and swallowing F5, Ctrl+R, Ctrl+Shift+R only when
`import.meta.env.PROD`), click (emitting `externallink`), and dragover plus drop (blocked
**only** when `dataTransfer.types` includes `"Files"`). Remove them in `destroy`. Put the
key-to-name mapping in a pure exported function, `shortcutFor(e: { key: string; ctrlKey:
boolean; shiftKey: boolean; altKey: boolean }): ShortcutName | null`, in
`src/viewer/shortcutFor.ts`, with unit tests. Alt held means no shortcut. Match `key`
case-insensitively. This stays the only file that touches the iframe (D7).

### 2. P1.10 - the frame, in `src/app/`

- `main.tsx` creates things once, outside React: `files = await createFileAdapter()`,
  a `dialogs` service, `manager = new SessionManager(files, () => new PdfJsViewer(), dialogs)`.
  It registers `files.onCloseRequested(() => manager.confirmCloseAll())`, renders `<App>`,
  then calls `manager.start()`. Pass `manager` and `dialogs` down by props or one context.
- `useSession(manager)` is `useSyncExternalStore(manager.subscribe, manager.getSnapshot)`.
  Bind or wrap the methods so `this` survives.
- `App.tsx`: the layout of spec 11.1. One `<div className="viewer-host">` whose ref goes to
  `manager.setViewerHost`. The host is **always rendered**, even when a panel covers it, so
  iframes are never unmounted by React. Panels (spec 11.4) sit on top of it.
- `TabBar.tsx` per spec 11.2. Middle-click closes: handle `onAuxClick` with `button === 1`,
  and `preventDefault` on `onMouseDown` for button 1 to stop the scroll cursor.
- `ChoiceDialog.tsx` and the `dialogs` service per spec 11.5: `ask()` returns a promise, the
  component shows one dialog at a time from a queue, Escape resolves `cancel` when that
  button exists and otherwise the last button. Use `<dialog>` with `showModal()`.
- `app.css` per spec 11.1: CSS variables, a `prefers-color-scheme: dark` block, system
  fonts, no web fonts, no icon fonts. Plain and tidy beats clever.
- In `index.html`, add `<link rel="icon" href="data:,">` to stop the favicon 404, and set
  the title to `PDFluffer`.

### 3. P1.11 - menu, Recent, Settings, Clear history, About

Per spec 11.3 and 11.5. The app menu is a button with a simple popup list, closed by
Escape, by an outside click, and by choosing an item. Recent is a nested list inside it, not
a hover submenu. Leave out the **Document** submenu and **Revert to saved** entirely; they
are phase 2. Hide the `keepBackup` checkbox (phase 2). Clear history asks first, with
buttons `ok` and `cancel`. About shows the app version from `package.json`, "PDF.js
6.3.289", and "No ads. No account. No network.".

### 4. P1.12 - shortcuts and title

A `keydown` listener on the parent `window` uses the same `shortcutFor` and calls
`manager.handleShortcut`. The manager already sets the window title. In the browser harness
`setWindowTitle` should set `document.title`; check that it does.

### 5. P1.13 - banner, chip, guard, links

The XFA banner of spec 12.7 above the host, with Dismiss calling `dismissXfaBanner`. The
`Signed` chip and its tooltip per spec 11.2. The signature guard and the external link
dialog already run inside the manager; check they appear through `ChoiceDialog`.

### 6. P1.14 - remove the spike, then run H1 to H10

Delete every trace of the spike, including the `spike-ref` state key usage. Then run
harness checks **H1 to H10** from spec 16 in a browser against `npm run dev`. Record each
in `BUILD-NOTES.md` as "builder checked" with what you saw, or "USER check" with exact
steps if your browser tool cannot do it (native file dialogs, real key presses inside the
iframe). Do not claim what you did not see. For H8, deleting a page needs the thumbnail
sidebar's page tools; if you cannot find a delete control, say what is there.

## Decision rules

- The manager owns behaviour. Components call its methods and render its snapshot. Put no
  save, close or restore logic in React.
- Never render an `<iframe>` from React. `PdfJsViewer` creates them inside the host.
- A modal `<dialog>` makes the iframes inert. That is wanted. After it closes, call
  `manager`'s active viewer focus only if that is easy; otherwise leave focus alone.
- If a harness check fails because of a manager bug, fix the manager **with a test first**.
- No CSS framework, no UI kit, no icon package, no state library. Inline SVG or text.
- UI text in Australian English. No em dashes under `src/`.

## Out of scope

The Tauri adapter, any Rust, drag-and-drop to open (chip 6), phase 2 (`runOp`, `revert`,
Document tools, backup), tab drag reordering, a theme switch, a custom toolbar. No new
dependencies. Do not edit the spec or the concept. Never edit `public/pdfjs/`.

## Escalation

On a contradiction, or after three honest failed attempts at one item: stop that item,
write it under "Questions for the user" in `BUILD-NOTES.md`, and continue elsewhere.

## Acceptance - check each yourself and say how

1. `npm run check` passes, with new tests for `shortcutFor` and the snapshot change.
2. `npm run build` succeeds.
3. `grep -rn "PDFViewerApplication\|contentWindow\|contentDocument" src` matches only
   `src/viewer/PdfJsViewer.ts`. `grep -rn "<iframe" src/app` prints nothing.
4. `grep -rni "spike" src` prints nothing.
5. `git status --porcelain public/pdfjs` prints nothing. `package.json` dependencies are
   unchanged.
6. H1 to H10 are each recorded, marked "builder checked" or "USER check".
7. Plan boxes P1.9 to P1.13 are ticked. Tick P1.14 only if every one of H1 to H10 is
   "builder checked" and passed. Otherwise leave it and say which remain.

## Conventions

Follow the Git and Style sections of `CLAUDE.md`. One commit per plan item where you can.
Never push. End each commit with a `Co-Authored-By:` trailer naming the model you are.
Commands you hand to the user say `npm.cmd`, not `npm`.

## Closing report

What you built, how you checked each acceptance item, the H1 to H10 table, the test count,
every deviation and question, and `git log --oneline` since chip 4.
