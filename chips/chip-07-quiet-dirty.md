# Chip 7 - stop the false "unsaved changes"

You are the builder for PDFluffer, in `C:\Users\nick2\Code\pdfluffer`. A separate
orchestrator session wrote the spec and reviews your work. This chip is your whole task.

## Where things stand

Chips 1 to 6 are done and reviewed. 207 npm tests and 17 cargo tests pass. The installer
builds. The user is working through `docs/user-checks-phase-1.md` in the real app, so
**work in the browser harness only** (`npm run dev`). Do not start `tauri dev`: the app is
single-instance, and your launch would hand off to the user's window and quit. Chip 6's
deviations 15 and 16 are ratified.

## The problem (Known issue 4 in `BUILD-NOTES.md`, found by chip 5)

PDF.js sometimes marks a file changed when the user changed nothing:

1. **A radio group with a selected button.** Rendering it writes `{ value: false }` into
   the annotation storage for the sibling buttons, and `_annotationStorageModified`
   becomes true.
2. **Entering the signature tool** on a file that already carries saved annotations.

The tab then shows the dirty dot, and closing it asks Save, Discard, Cancel. No data is
lost, but PDFluffer exists to stop nagging, so this matters.

## The one rule that outranks everything

**A false "clean" loses the user's work. A false "dirty" only nags.** So any fix must be
provably unable to hide a real edit. If you cannot show that, do not ship the fix.
Approaches based on timing, on "was there a recent click", or on resetting the flag after
render are **ruled out**: a slow real edit would be absorbed and lost. Chip 5 was right to
refuse those.

## Facts the orchestrator checked in `public/pdfjs/build/pdf.mjs` (6.3.289)

- `AnnotationStorage.setValue(key, value)` (`:6926`) marks modified when any entry of the
  value differs from what is stored, **or when the key is new**. That is why a render that
  writes a first `{ value: false }` counts as a change.
- `get serializable()` (`:6969`) builds a `Map` of what would be saved. For an
  `AnnotationEditor` value it calls `val.serialize(false, context)` and **skips the entry
  when that returns nothing**. An untouched existing annotation may serialise to nothing.
  That may explain case 2, or fix it. Find out.
- `get modifiedIds()` (`:7071`) lists editors whose `serialize()` returns something.
- Form widgets write plain objects such as `{ value: ... }` (`:18613` to `:19494`, and
  `:19223`, `:19298` for checkboxes and radio buttons, which store a boolean).
- `pdfDocument.getFieldObjects()` returns the file's own field data, keyed by field name,
  each an array of objects with at least `id`, `type` and `value`. Confirm the exact shape
  for text, checkbox, radio button and dropdown by logging it for `samples/form-basic.pdf`.

## The direction to try: compare against the file, never against the clock

Replace the annotation half of `hasChanges()` with an **effective change** test:

> The annotation storage has an effective change when its `serializable` map holds at least
> one entry that is **not a proven no-op**.

An entry is a proven no-op **only** in cases you can show from the file's own data, for
example: a plain object whose only key is `value`, for a widget id found in
`getFieldObjects()`, where the stored value equals what the file already holds for that
widget (a radio or checkbox `false` where the file has it off, `true` where the file has
it on, a text value equal to the file's). **Everything else counts as a change**: unknown
shapes, extra keys, ids not found, every serialised editor, every value you are unsure of.

Put the rule in a **pure function** in `src/viewer/effectiveChange.ts`, for example
`isNoOpEntry(entry: unknown, field: FieldInfo | undefined): boolean` and
`hasEffectiveChange(entries: Iterable<[string, unknown]>, fields: Map<string, FieldInfo>)`.
Unit test it hard: each no-op case, and at least ten "must count as a change" cases,
including a changed text value, a newly checked box, a newly selected radio, an unchecked
box that the file has checked, an unknown id, an extra key, a non-object, and an editor-like
object. `PdfJsViewer.ts` stays the only file that touches PDF.js (D7): it gathers the
entries and the field map and calls the pure function.

Things to settle while you investigate, and to record:

1. The real shape of `getFieldObjects()` for the four field types, and how a radio
   button's own on-value is named there (`exportValues` or otherwise).
2. Whether `getFieldObjects()` reflects the **loaded file**, so that after Save and a
   reopen the saved state is the new baseline. It must. Prove it.
3. What exactly is in the storage in case 2, and whether `serializable` already leaves it
   out. If entering the signature tool stores something that serialises, find out what.
4. Cost. `serializable` may be expensive with large images, and the dirty poll runs every
   second. Compute the effective test **only while `_annotationStorageModified` is true**,
   and cache the result against something cheap that changes when the storage changes. If
   you find no safe cheap key, accept the cost and say so. Do not invent a cache that could
   go stale.
5. `exportBytes()` must agree with `hasChanges()`: with only no-op entries it returns
   `{ mode: 'none' }`, as today's add-then-delete case does. Structural and merged changes
   are untouched by this chip.
6. After an `append` save the storage keeps its entries (chip 2 finding) while the file on
   disk now holds them. The viewer is **not** reloaded, so `getFieldObjects()` still
   describes the old file. Today that works because `_annotationStorageModified` is cleared
   by the save. Keep that gate first, so this case cannot regress. Test it in the harness.

## Stop rule

If after honest investigation you cannot make a fix that is provably free of false
"clean" for **case 1**, stop. Revert your changes to `hasChanges`, keep any investigation
notes, and write the finding under "Questions for the user". The orchestrator will then
list it in spec 19 as an accepted limit. The same applies separately to **case 2**: fix it
only if it falls out safely. A chip that fixes case 1 and documents case 2 is a success.

## Harness checks, in a browser against `npm run dev`

Record each as "builder checked" with what you saw, or "USER check" with exact steps.

1. Open `samples/form-basic.pdf`, choose a radio option, save, close the tab, reopen it.
   Wait ten seconds. The tab must stay clean. Closing it must not ask.
2. On that reopened file: change the radio choice. Dirty within about a second. Save works.
3. Tick then untick the checkbox, back to the file's state. Clean or dirty are both
   acceptable. Record which. It must never be clean while the file differs.
4. Type in a text field, then restore the exact original text. Record the result.
5. Change a field, save (append mode, no reload), then change it back to the pre-save
   value. It **must** be dirty: the disk now holds the saved value. This is the trap in
   point 6 above.
6. Case 2: on a file with saved annotations, enter and leave the signature tool without
   placing anything. Record the result.
7. Add a text annotation, move it, delete it. Dirty while it exists, clean after.
8. Regression: H1, H2 and H8 from spec 16 still pass.

## Out of scope

Everything else. No Tauri work, no UI changes, no phase 2, no new dependencies. Do not edit
the spec or the concept. Never edit `public/pdfjs/`.

## Acceptance - check each yourself and say how

1. `npm run check` passes, with the new pure-function tests.
2. `grep -rn "PDFViewerApplication\|getFieldObjects\|annotationStorage" src` matches only
   `src/viewer/PdfJsViewer.ts` (the pure function takes plain data).
3. `git status --porcelain public/pdfjs` prints nothing.
4. The six investigation points and the eight harness checks are recorded.
5. Known issue 4 in `BUILD-NOTES.md` is updated: fixed, part fixed, or stopped, with why.
6. No plan box changes. This chip has no plan item.

## Conventions

Follow the Git and Style sections of `CLAUDE.md`. Small commits. Never push. No em dashes
under `src/`. End each commit with a `Co-Authored-By:` trailer naming the model you are.

## Closing report

What you found on each of the six points, what you shipped or why you stopped, the argument
that no real edit can be hidden, the harness table, the test count, and
`git log --oneline` since chip 6.
