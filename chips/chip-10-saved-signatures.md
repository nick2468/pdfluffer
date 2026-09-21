# Chip 10 - rename a saved signature, and a clearer Flatten dialog

You are the builder for PDFluffer, in `C:\Users\nick2\Code\pdfluffer`. A separate
orchestrator session wrote the spec and reviews your work. This chip is your whole task.

## Where things stand

The build is finished and the user has tested the installed app. 328 npm tests and 17 cargo
tests pass, and the orchestrator's production smoke test passes 24 of 24
(`npm run smoke:prod`, new since chip 9: read its header in `scripts/prod-smoke/run.mjs`
and the new line in `CLAUDE.md`). Chip 9's deviations 22 to 26 are **ratified**.

The user reported "All are working", with two points. This chip fixes both. It is small.
Read "The user's first test pass" in `BUILD-NOTES.md` for the full story.

## The two points

**1. A saved signature cannot be renamed.** The user added a signature from an image file
and kept the default description, the file name. Later they used PDF.js's **Edit
description** to change it to a person's name, and found the saved-signature button still
showed the file name. That is PDF.js's design: the description names the saved signature
only when it is created. Edit description changes the placed copy only. PDF.js's storage
has create and delete, and no rename. The user expects to rename one. The orchestrator
reproduced all of this.

**2. "Flatten" was jargon.** The user did not know the word. They ruled that the menu item
keeps its name, **Flatten...**, and that the dialog explains it in plain words.

## Read first

1. `CLAUDE.md`. Note the changed hard rule: `src/viewer/savedSignatures.ts` is the one
   named exception to "only `PdfJsViewer.ts` touches PDF.js".
2. `BUILD-NOTES.md`, the "Orchestrator checks" section.
3. `pdfluffer-spec.md` **section 11.8** (new), D7 in section 2, and the `flatten` row of 13.5.
4. `src/app/AppMenu.tsx`, `SettingsDialog.tsx`, `dialogService.ts` and
   `src/session/dialogTexts.ts`, so the new dialog matches what exists.
5. `pdfluffer-plan.md`, phase 3. You do **P3.1 to P3.4**.

## Facts the orchestrator verified at source (PDF.js 6.3.289)

- `localStorage["pdfjs.signature"]` holds a JSON **object**:
  `{ "<uuid>": { "description": "<text>", "signatureData": "<string>" }, ... }`.
  Insertion order is the order of PDF.js's signature menu. At most 5 entries.
  (`public/pdfjs/web/viewer.mjs`, the `generic_signature_storage.js` block near line 3086.)
- Each viewer adds a `storage` event listener the first time it reads the list. On a change
  to that key it clears its cache and dispatches `storedsignatureschanged`, and the
  signature manager removes its buttons and redraws them (`#signaturesChanged`, near line
  17311). **The browser fires `storage` in every same-origin document except the one that
  wrote.** The app frame and the viewer iframes are different documents of one origin, in
  the harness and in Tauri (`http://tauri.localhost`). So a write from the app frame makes
  every open viewer redraw its list, with no call into PDF.js at all.
- The placed copy of a signature keeps its own description. This chip never touches it.

## The work

### 1. P3.1 - `src/viewer/savedSignatures.ts`, test-first

Pure functions over the raw stored string, plus one thin class over a `Storage`. Nothing
here imports PDF.js, React or `src/app`.

```ts
export const SIGNATURE_STORAGE_KEY = "pdfjs.signature";
export const MAX_SIGNATURE_NAME = 120;

export interface SavedSignature { uuid: string; description: string; }

/** Null means "not the shape we know": show an error and never write. "" or null input is []. */
export function parseSavedSignatures(raw: string | null): SavedSignature[] | null;

/** The new raw string, or null when the uuid is missing, the shape is unknown, or the name is empty. */
export function renameSavedSignature(raw: string | null, uuid: string, name: string): string | null;

export class SavedSignatureStore {
  constructor(storage: Pick<Storage, "getItem" | "setItem">);
  list(): SavedSignature[] | null;
  /** Re-reads the storage, renames, writes. False when nothing was written. */
  rename(uuid: string, name: string): boolean;
}
```

Rules, each with a test:

- "The shape we know" means: valid JSON, a plain object (not an array, not null), and
  **every** value a plain object with a string `description` and a string `signatureData`.
  Anything else makes `parseSavedSignatures` return null.
- `renameSavedSignature` trims the name, refuses an empty one, and cuts it at
  `MAX_SIGNATURE_NAME` characters. It changes **only** that entry's `description`. Every
  other key, every `signatureData`, any extra field on an entry, and the entry order stay
  exactly as they were. Test the order with three entries, renaming the middle one.
- `rename` re-reads the storage just before it writes, so an entry added or deleted by a
  viewer in the meantime is kept. Test it: list, then change the stored string behind the
  store's back, then rename, and check the other change survived.
- A rename to the name it already has writes nothing and returns false.
- If `setItem` throws (quota, or storage blocked), `rename` returns false. It does not throw.

### 2. P3.2 - the dialog and the menu item

- A new component, `src/app/SavedSignaturesDialog.tsx`, built like `SettingsDialog.tsx`
  (its own `<dialog>` with `showModal()` and a Close button). It creates one
  `SavedSignatureStore(window.localStorage)`.
- Title: **Saved signatures**. Intro text, exactly:
  "Each name appears on its button in the signature tool. Renaming one does not change a
  signature already placed in a document. The list is in the same order as the signature
  tool."
- One row per saved signature: its position ("1", "2", ...), a text box holding the name
  (`maxLength` `MAX_SIGNATURE_NAME`), and a **Rename** button. Rename is disabled while the
  trimmed text is empty or unchanged. Enter in the text box does the same as the button.
  After a successful rename the row shows the new name and the button disables again.
- Empty list: "No saved signatures yet. Create one with the signature tool inside a PDF, and
  leave Save signature ticked."
- Unknown shape (`list()` is null): "PDFluffer cannot read the saved signatures, so it has
  changed nothing." No rows.
- A rename that returns false for any other reason shows, under that row: "That name could
  not be saved."
- The list is read when the dialog opens. It is fine that it does not live-update while open.
- `AppMenu.tsx` gains **Saved signatures...**, placed just above **Settings...**, always
  enabled. Open it the way Settings is opened.
- Plain CSS in `app.css`, matching the Settings dialog. No previews of the signatures:
  `signatureData` is a PDF.js-private compressed format, and decoding it is out of scope.

### 3. P3.3 - the Flatten dialog wording

In `src/session/dialogTexts.ts`, `FLATTEN_DIALOG.body` becomes, exactly:

"Flatten makes every filled-in answer, note and signature a permanent part of the page.
Afterwards nobody can edit, move or remove them, including you. Use it before you send a
signed form to someone. You can still use Revert to saved until you save."

The title, the buttons and the menu name stay as they are. Update any test that pins the
old text.

### 4. P3.4 - checks, a fresh installer, and the smoke test

Harness checks, in a browser against `npm run dev`. Record each as "builder checked" with
what you saw, or "USER check" with exact steps. **Use a harness browser profile only. Never
read, print or change the saved signatures of the user's installed app.**

1. Create and save a signature in a PDF, with some description. Open **Saved
   signatures...**: it lists that description.
2. Rename it. **Without reloading**, open the signature tool in the already-open tab: the
   button shows the new name. This proves the `storage` event path.
3. With two tabs open, both having used the signature tool, rename once: **both** tabs show
   the new name.
4. Reload the page: the new name is still there.
5. A signature placed before the rename still carries its own, old description (its Edit
   description dialog shows it). That is intended.
6. With no saved signatures the dialog shows the empty text. With
   `localStorage["pdfjs.signature"]` set by hand to `"[1,2]"` it shows the cannot-read text,
   and the stored value is unchanged afterwards. Remove the hand-made value when done.
7. **Flatten...** shows the new wording. Cancel still changes nothing.
8. Regression: H1 and H2 from spec 16 still pass.

Then:

- `npm run check` passes. With the Rust PATH set, `cargo test` passes.
- With the Rust PATH set, `npm run tauri build`, after your last code commit.
- `npm run smoke:prod`. **PDFluffer must be closed first**, and it must report every check
  passed. If the user has the app open, do not close it. Say so in your report and leave
  this step for the orchestrator. The smoke test does not touch saved signatures.

## Decision rules

- The manager is not involved. This feature is a dialog over one storage key.
- If any fact under "Facts the orchestrator verified" does not hold when you try it, stop
  and record what you saw. Do not reach into the iframe or PDF.js to force a refresh.
- No new dependencies. UI text in Australian English. No em dashes under `src/`.

## Out of scope

Deleting or reordering saved signatures (PDF.js's own bin button deletes), signature
previews, changing a placed signature's description, changing PDF.js's own wording
("Edit description" belongs to the vendored viewer), renaming the Flatten menu item,
anything in `src-tauri/`, anything in spec section 3. Do not edit the spec or the concept.
Never edit `public/pdfjs/`.

## Escalation

On a contradiction, or after three honest failed attempts at one item: stop that item,
write it under "Questions for the user" in `BUILD-NOTES.md`, and continue elsewhere.

## Acceptance - check each yourself and say how

1. `npm run check` passes with the new tests. `npm run build` succeeds.
2. `grep -rn "pdfjs.signature" src` matches only `src/viewer/savedSignatures.ts` and its test.
3. `grep -rln "PDFViewerApplication\|contentWindow\|contentDocument" src` prints only
   `src/viewer/PdfJsViewer.ts`.
4. `git status --porcelain public/pdfjs` prints nothing. `package.json` dependencies are
   unchanged.
5. The eight harness checks are recorded.
6. The installer build and the smoke test result are recorded, or the smoke test is handed
   to the orchestrator with the reason.
7. Plan boxes P3.1 to P3.3 are ticked, and P3.4 only if everything in part 4 passed.
   P3.5, P2.10 and P2.11 stay unticked.
8. Append to `docs/user-checks-final.md` a short section, **"After chip 10 - two checks"**:
   (a) rename a saved signature in the **installed** app and see the new name in the
   signature tool, and after a restart; (b) F16, pointing at its existing steps, with one
   added line saying what flatten means in plain words.

## Conventions

Follow the Git and Style sections of `CLAUDE.md`. One commit per plan item where you can.
Never push. End each commit with a `Co-Authored-By:` trailer naming the model you are.
Commands you hand to the user say `npm.cmd`.

## Closing report

What you built, how you checked each acceptance item, the harness table, the test counts,
the installer path and size, the smoke test result, every deviation and question, and
`git log --oneline` since chip 9.
