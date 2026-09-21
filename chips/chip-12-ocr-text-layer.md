# Chip 12 - OCR: the invisible text layer, the tool, and its smoke test

You are the builder for PDFluffer, in `C:\Users\nick2\Code\pdfluffer`. A separate
orchestrator session wrote the spec and reviews your work. This chip is your whole task.

## Where things stand

Chip 11 is done and reviewed. 357 npm tests and 23 cargo tests pass. `npm run smoke:prod`
passes 24 of 24. Chip 11's decisions 16 and 17 and deviation 29 are **ratified**. What it
proved, and what this chip stands on:

- `ocr_status` and `ocr_image` work over real IPC in the release build. This machine
  reports language `en-GB` and `MaxImageDimension` 10000. A page takes well under a second.
- **The skew rule** (decision 16): with y pointing down, `a` the reported `textAngle` in
  degrees and `(cx, cy)` the centre of the picture, a reported point `(x, y)` really sits at
  `cx + (x-cx)cos(a) - (y-cy)sin(a)`, `cy + (x-cx)sin(a) + (y-cy)cos(a)`. It put 100% of 151
  words within 6 pixels on both test pictures. `textAngle` is 0, not null, on a straight page.
- `OcrService`, `fakeOcrService`, `tauriOcrService` and `createOcrService()` exist. Nothing
  calls them yet.

This chip builds everything the user sees: render a page, read it, place invisible text
exactly over the words, and prove it in the release build.

## Read first

1. `CLAUDE.md` and `BUILD-NOTES.md` decisions 15, 16 and 17.
2. `pdfluffer-spec.md` **section 20**, and 13.1 to 13.5 for how tools and `runOp` work.
3. `src/engine/pdfLibAdapter.ts` and `placement.ts` (flatten's geometry), `src/tools/documentTools.ts`,
   `src/app/dialogService.ts`, `src/viewer/PdfJsViewer.ts`, `scripts/prod-smoke/run.mjs`.
4. `pdfluffer-plan.md`, phase 4. You do **P4.5 to P4.9**.

## The design, settled. Do not re-make it

**Let PDF.js do the page geometry.** A PDF.js viewport carries a six-number `transform`
that maps PDF user space to picture pixels. It already accounts for the page's `/Rotate`,
its crop box offset and the flip of the y axis. So this chip never reasons about page
rotation case by case. It **inverts that matrix**.

For each OCR line, and each word in it:

1. Work in picture pixels, on the engine's straightened frame. `size` = 1.1 times the
   median word height of the **line**. `base` = the median of the line's word bottoms
   (`y + h`) minus 0.12 times `size`. Using the line, not the word, keeps a line's text on
   one baseline, so a selection looks even.
2. The word's baseline runs from `P0 = (x, base)` to `P1 = (x + w, base)`. `P2 = (x, base - size)`
   is one text height above `P0`.
3. Apply the skew rule to `P0`, `P1` and `P2`.
4. Map all three through the **inverse** of the viewport transform, giving `Q0`, `Q1`, `Q2`
   in PDF points.
5. `fontSize = |Q2 - Q0|`. `u = (Q1 - Q0) / |Q1 - Q0|`. The text matrix is
   `[u.x, u.y, -u.y, u.x, Q0.x, Q0.y]`. The horizontal scale, as a percentage, is
   `100 * |Q1 - Q0| / widthOfTextAtSize(text, fontSize)`.

A word is skipped when its text is empty after filtering, or its width or `fontSize` is
not a positive finite number.

## The work

### 1. P4.5 - two new `Viewer` methods, in `PdfJsViewer.ts` only (D7)

```ts
interface PageImage {
  bytes: Uint8Array;                 // JPEG, quality 0.92
  width: number; height: number;     // pixels
  transform: [number, number, number, number, number, number];  // PDF points -> pixels
}
renderPageImage(page: number, maxDimension: number): Promise<PageImage>;
pageTextLength(page: number): Promise<number>;   // non-space characters of real text
```

- Scale: aim for 300 dpi (`300 / 72`), then shrink so the longer side fits inside
  `min(maxDimension, 4000)`. Use `pdfPage.getViewport({ scale })`, a canvas made in the
  **iframe's** document, `pdfPage.render(...)`, then `canvas.toBlob('image/jpeg', 0.92)`.
  Return `viewport.transform` as plain numbers. Release the canvas afterwards (set its
  width and height to 0).
- `pageTextLength` sums the non-space length of `getTextContent()` items.
- `FakeViewer` gets both, driven by settable fields.
- `SessionManager` gains thin pass-throughs for a `ready` tab: `pageCount(tabId)`,
  `renderPageImage(tabId, page, max)` and `pageTextLength(tabId, page)`. Test-first.

### 2. P4.6 - `src/ocr/placement.ts`, pure, test-first

`export function placeOcrPage(result: OcrPageResult, transform: number[], measure: (text: string, size: number) => number, encodable: (ch: string) => boolean): PlacedWord[]`
where `PlacedWord` is `{ text: string; matrix: number[]; fontSize: number; scalePercent: number }`.
Also export `unskew(point, angleDeg, centre)` and `invert(transform)`.

Tests, all with hand-checkable numbers:

- `unskew` reproduces **at least three rows of decision 16's tables** to within 6 pixels,
  for both pictures. This pins the sign for ever.
- An identity-like viewport (scale 2, y flipped, 600 by 800 point page): a word lands at the
  right point, upright, with the expected size and scale.
- The four page rotations, using the transforms PDF.js really produces. Get them once from
  the harness, `getViewport({ scale: 1, rotation: r }).transform` for a 600 by 800 page, and
  paste the numbers into the test with a comment saying where they came from.
- A crop box that does not start at 0,0.
- A line keeps one baseline: two words of different heights share `matrix[5]` on an
  upright page.
- A character `encodable` rejects is dropped, and a word that becomes empty is skipped.
- A null `textAngle` behaves as 0.

### 3. P4.7 - `ocr.addTextLayer` in `pdfLibAdapter.ts`, test-first

`EngineOp` gains `{ kind: 'ocr.addTextLayer'; pages: { pageIndex: number; words: PlacedWord[] }[] }`.
The adapter gains capability `'ocr'`. The op kind's capability is `'ocr'`: update whatever
maps op kinds to capabilities in `runOp`.

- Embed `StandardFonts.Helvetica` once per document. `measure` and `encodable` for
  `placeOcrPage` come from that font (`widthOfTextAtSize`, and its character set). Because
  the adapter owns the font, **the tool sends raw OCR results plus transforms, and the
  adapter calls `placeOcrPage`.** So make the op carry
  `{ pageIndex, result: OcrPageResult, transform }` instead of placed words if that is
  cleaner. Choose one, record it.
- Per page, one block: push graphics state, begin text, rendering mode **invisible** (3),
  then for each word set the font and size, the text matrix, the horizontal scale and show
  the text, then end text and pop graphics state. Read `@cantoo/pdf-lib`'s `operators.d.ts`
  for the real names. Do not guess.
- **The existing page content must not leak its graphics state into ours.** Many scanner
  PDFs set a scaling matrix and never restore it. Check how pdf-lib appends to a page
  (`PDFPageLeaf.normalize` and its wrapping of the old content streams in a save and
  restore pair). Prove it with a test: a page whose content is a bare `2 0 0 2 0 0 cm` with
  no save or restore, then the op, then assert our block comes after a restore.
- Tests: the page gains a `BT`, a `3 Tr` and the expected number of show-text operators;
  nothing visible changes (no new XObject, no fill or stroke operators in our block); a
  page index out of range is `EngineError('failed')`; an encrypted input is `'encrypted'`;
  an empty word list leaves that page's content untouched.

### 4. P4.8 - the tool, the progress dialog, the wording

- `DialogService` gains `progress(title: string, text: string)` returning
  `{ update(text: string): void; readonly cancelled: boolean; close(): void }`, shown as a
  modal `<dialog>` with one **Cancel** button. A modal dialog makes the viewers inert,
  which is wanted: the user cannot edit the document while it is being read. The `Dialogs`
  interface gains the method, and the test fake implements it.
- `ToolContext` gains `ocr: OcrService | null`. In `main.tsx`, create the service, await
  `status()` once at boot inside a `try`, and register the OCR tool **only when it is
  available**. So the tool is absent in the browser harness and on a PC with no OCR language.
- The tool `ocr`, label **Make text selectable (OCR)...**, needs `'ocr'`. Its flow is spec
  20.5, with these exact texts:
  - Nothing to do: title "Nothing to read", body "Every page already has selectable text."
  - Confirm: title "Make text selectable?", body "N of M pages have no selectable text.
    PDFluffer will read them and add an invisible text layer. The pages will look exactly
    the same. This can take a few seconds a page." Buttons **Make selectable** and **Cancel**.
    Use "1 of 1 page has" when that is the count.
  - Progress: title "Reading the pages", text "Reading page K of N...".
  - Done: title "Text added", body "Added W words to P pages, read as LANGUAGE. Select some
    text to check it, then save." With W of 0: title "No text found", body "PDFluffer found
    no printed text on those pages. Handwriting cannot be read." and no `runOp` at all.
  - A page counts as needing OCR when `pageTextLength` is 50 or less (O5).
  - Cancel during progress: stop after the current page, change nothing, no message.
  - A failure on one page (`OcrError`) stops the run with title "Could not read the page"
    and the code's plain meaning. Nothing is changed.
- One `runOp` for all pages at the end, so the signature guard asks at most once.
- Never log or record recognised text.

Unit tests for the tool with `FakeOcrService`, a fake session and fake dialogs: skips pages
with text, asks with the right counts, cancel at the confirm, cancel mid-run, zero words,
an `OcrError`, and the happy path making exactly one `runOp` with every needed page.

### 5. P4.9 - `scripts/prod-smoke/ocr.mjs`, in the release build

First extend `scripts/make-samples.ts` to write **`samples/scan-three.pdf`**: three pages,
each one full-page picture and nothing else, each page 576 by 432 points (the pictures are
1600 by 1200, so 200 dpi). Page 1 holds `samples/ocr/straight.png`. Page 2 holds
`skew-cw2.png`. Page 3 holds `straight.png` with `/Rotate 90`. It has no text at all.

`ocr.mjs` follows `run.mjs`'s safety rules exactly (refuse if PDFluffer runs, temp copies,
back up and restore the user's state, `Page.bringToFront`). It must show:

1. Before: every page's text length is 0 (read through PDF.js's `getTextContent`).
2. The tool is in the menu. Running it asks "3 of 3 pages", then finishes with "Text added".
3. After: on each page at least 90% of the fixture's words are present as text items.
4. **Position:** for page 1 and page 2, map five spread words' text-item origins through
   the page's viewport to picture pixels and compare with the true positions in the fixture
   JSON: within 14 pixels across and within one word height down. Page 3 proves rotation:
   the same check through its own viewport.
5. The tab is dirty. Save, restart the app, and the text is still there.
6. Run the tool again: "Nothing to read". No second layer.
7. On `three-pages.pdf`, which has real text: "Nothing to read".
8. No console error, no CSP violation, no native prompt.

Add an npm script `smoke:ocr`. Then, with the Rust PATH set, `npm run tauri build`, and with
PDFluffer closed run `npm run smoke:prod`, `node scripts/prod-smoke/backup.mjs` and
`npm run smoke:ocr`. If the user has the app open, do not close it. Say so and leave the
smoke runs to the orchestrator.

Last, write **`docs/user-checks-ocr.md`**, a new file, with one check (P4.10): in the
installed app open a real scan, run **Make text selectable (OCR)...**, select and copy a
paragraph into Notepad, search for a word with Ctrl+F, save, and open the saved file in
Chrome or Edge and select text there. Say in one plain sentence what OCR is. Say that
stamps, signatures and handwriting will not become text, and that this is expected. Do not
touch `docs/user-checks-final.md`: it is closed.

## Decision rules

- If a position check fails, print the numbers and look for the cause in this order: the
  `transform` is for a different scale than the picture, the matrix inverse, the skew sign
  (decision 16 is proven, so suspect your port of it, not the rule), then the baseline
  constants. The constants 1.1 and 0.12 may be tuned, within reason, to pass the vertical
  check. Record the final values. Do not loosen the tolerances.
- If a page cannot be rendered (no `requestAnimationFrame` in a hidden page, decision 15),
  that is a harness problem, not an app one. In the app the window is visible.
- No new dependencies. UI text in Australian English. No em dashes under `src/`.

## Out of scope

Tesseract, a language picker, straightening or cleaning the picture, handwriting, tables,
editing the recognised text, OCR of a chosen page range, anything in the browser harness
beyond hiding the tool, the extension. Do not edit the spec or the concept. Never edit
`public/pdfjs/`.

## Escalation

On a contradiction, or after three honest failed attempts at one item: stop that item,
write it under "Questions for the user" in `BUILD-NOTES.md`, and continue elsewhere.

## Acceptance - check each yourself and say how

1. `npm run check` passes with the new tests. `npm run build` succeeds. `cargo test` passes.
2. `grep -rln "@tauri-apps" src` prints exactly the two allowed files.
   `grep -rln "PDFViewerApplication\|contentWindow\|contentDocument" src` prints only
   `src/viewer/PdfJsViewer.ts`. `grep -rln "@cantoo/pdf-lib" src` prints only
   `src/engine/pdfLibAdapter.ts` and its test.
3. `git status --porcelain public/pdfjs` prints nothing. Dependencies are unchanged.
4. The three smoke scripts' results are recorded, or handed to the orchestrator with the reason.
5. The final baseline constants and the op's shape are recorded.
6. Plan boxes P4.5 to P4.8 are ticked, and P4.9 only if `smoke:ocr` passed in full.
   P4.10 stays unticked.

## Conventions

Follow the Git and Style sections of `CLAUDE.md`. One commit per plan item where you can.
Never push. End each commit with a `Co-Authored-By:` trailer naming the model you are.
Commands you hand to the user say `npm.cmd`.

## Closing report

What you built, how you checked each acceptance item, the `smoke:ocr` table with the
measured position errors, the test counts, the installer path and size, every deviation and
question, and `git log --oneline` since chip 11.
