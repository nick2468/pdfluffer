# Chip 14 - the text-editing engine

You are the builder for PDFluffer, in `C:\Users\nick2\Code\pdfluffer`. A separate
orchestrator session wrote the spec and reviews your work. This chip is your whole task.

**Run this after chip 13.** If `pdfluffer-plan.md` shows P5.1 to P5.4 unticked, stop and say so.

## Where things stand

PDFluffer is public, MIT licensed, and released as a signed 0.1.1. The user now wants to
**change, insert and delete text** in a PDF. Spec section 21 settles how. Phase 6 is two
chips. **This one builds the engine and proves it in the release build. It adds no UI.**
Chip 15 builds the editor dialog, and what it says depends on what you find here.

## Read first

1. `CLAUDE.md`. Note the new rule: only `src/engine/pdfiumAdapter.ts` and its test may
   import `@embedpdf/pdfium`.
2. `pdfluffer-spec.md` **section 21, all of it**, then 13.1 to 13.4 (the engine seam and
   `runOp`), 20.4 and decision 16 in `BUILD-NOTES.md` (how a page transform is used).
3. `src/engine/pdfLibAdapter.ts`, for the lazy-loading pattern and the error mapping.
4. `pdfluffer-plan.md`, phase 6. You do **P6.1 to P6.5**.

## Facts the orchestrator checked on 2026-11-04

- `@embedpdf/pdfium` 2.15.1 is MIT, ships `LICENSE` and `LICENSE.pdfium` (BSD-style),
  and a 4.6 MB `dist/pdfium.wasm`. It has `index.browser.js`, `index.js`, `index.cjs` and
  type definitions.
- It exports, through `init(moduleOverrides)` and a cwrap table: `FPDF_LoadMemDocument`,
  `FPDF_LoadPage`, `FPDFPage_CountObjects`, `FPDFPage_GetObject`, `FPDFPageObj_GetType`,
  `FPDFPageObj_GetBounds`, `FPDFPageObj_GetMatrix`, `FPDFPageObj_SetMatrix`,
  `FPDFPageObj_Transform`, `FPDFPageObj_GetFillColor`, `FPDFPageObj_SetFillColor`,
  `FPDFTextObj_GetText`, `FPDFTextObj_GetFont`, `FPDFTextObj_GetFontSize`,
  `FPDFTextObj_GetTextRenderMode`, `FPDFFont_GetBaseFontName`, `FPDFFont_GetFamilyName`,
  `FPDFFont_GetFlags`, `FPDFFont_GetIsEmbedded`, `FPDFFont_GetFontData`,
  `FPDFPageObj_CreateTextObj`, `FPDFPageObj_NewTextObj`, `FPDFText_SetText`,
  `FPDFText_LoadFont`, `FPDFText_LoadStandardFont`, `FPDFFont_Close`,
  `FPDFPage_InsertObject`, `FPDFPage_RemoveObject`, `FPDFPageObj_Destroy`,
  `FPDFPage_GenerateContent`, `FPDF_SaveAsCopy`, `FPDF_RenderPageBitmap`,
  `FPDFBitmap_CreateEx`, `FPDFBitmap_GetBuffer`, `FPDFBitmap_Destroy`, `FPDF_GetLastError`.
  `FPDFFont_GetFontName` is **not** exported. Use `FPDFFont_GetBaseFontName`.
- How the package finds its `.wasm` is **not** checked. Find out, and see the decision rules.

## The work

### 1. P6.1 - the dependency, loaded lazily

- `npm install @embedpdf/pdfium@2.15.1 --save-exact`. Record the lockfile change.
- `src/engine/pdfiumAdapter.ts` loads it with a dynamic `import()` inside its first call,
  caching the promise, exactly as `pdfLibAdapter.ts` does with pdf-lib. A failed load is not
  cached.
- The `.wasm` must be served from the app's own origin. Import its URL with Vite's `?url`
  suffix, fetch the bytes, and pass them to `init` as `wasmBinary`, unless the package
  already resolves it from `import.meta.url` in a way that survives `npm run build`. Check
  `npm run build` puts the `.wasm` in `dist/assets/` and that no chunk names a remote URL.
- Register the adapter in `main.tsx` beside `PdfLibAdapter`. Register **no tool**.

### 2. P6.2 - reading runs, and drawing a page

`listRuns(bytes, pageIndex)` and `renderPage(bytes, pageIndex, maxDimension)` per spec 21.2.

- Group text objects into runs per spec 21 (same baseline within 0.3 times the font size,
  same font, size and fill colour, gaps no wider than 1.5 times the font size, in the order
  the page draws them). Record which objects each run holds, inside the adapter only.
- Mark a run not editable, with a reason, for every case in E9. Text inside a form XObject
  is not a page-level text object, so it never appears; record that.
- `renderPage` returns RGBA bytes and the points-to-pixels transform. Draw at a scale that
  fits `maxDimension` on the longer side, white background, annotations and form fields
  drawn (`FPDF_ANNOT` flag), as the user sees them.
- Free every page, bitmap, font and document you open. Unit test for leaks the cheap way:
  open, list and close the same document 200 times and check the module's heap does not
  grow without bound.

### 3. P6.3 - replace, delete, insert

`applyEdits(bytes, edits)` per spec 21.2 and 21.3. Loads the bytes once, replays every edit
in order, generates content for each changed page, saves once with `FPDF_SaveAsCopy`.

- The locator rule is exact: one run on that page with the same text and a box within 1
  point. None or several fails with `EngineError('failed', 'The page changed under this edit.')`.
- **Squeeze (E4):** after creating the new object, measure its box. If wider than the old
  run, scale along the text direction by `oldWidth / newWidth`, but not below 0.85. If 0.85
  is not enough, keep 0.85 and add the note `runs-past-end`.
- The text direction comes from the first object's matrix, so a rotated run stays rotated.
- `run({ kind: 'text.edits', edits }, bytes)` calls `applyEdits` and returns mode `rewrite`.
- An encrypted file maps to `EngineError('encrypted')`, like pdf-lib.

### 4. P6.4 - fonts

- **Coverage (E3):** build, per document, the set of characters each font object has already
  drawn. The run's own font is kept only if every character of the new text is in that set.
  A space is always allowed if the set holds one.
- **Rust:** `read_system_font(file_name: String) -> Result<tauri::ipc::Response, String>`,
  `#[tauri::command(async)]`, reading from `%WINDIR%\Fonts` only names on this allowlist:
  `arial.ttf arialbd.ttf ariali.ttf arialbi.ttf times.ttf timesbd.ttf timesi.ttf timesbi.ttf
  cour.ttf courbd.ttf couri.ttf courbi.ttf calibri.ttf calibrib.ttf calibrii.ttf calibriz.ttf`.
  Anything else is `Err("not-allowed")`. A missing file is `Err("not-found")`. Cargo test the
  allowlist, including `..\` tricks and absolute paths.
- **TypeScript:** `FileAdapter.readSystemFont(fileName)`. Tauri calls the command.
  `FakeFileAdapter` serves queued bytes. `BrowserFileAdapter` returns null.
- The adapter takes a font source in its constructor, `(fileName) => Promise<Uint8Array | null>`,
  wired in `main.tsx` to `files.readSystemFont`, so the engine never imports a file adapter.
- **Matching** per spec 21.4, as a pure exported function with a table-driven test.
- **Embedding licence:** parse the font's OS/2 table `fsType` and refuse bit 0x0002 with
  `EngineError('failed', ...)`. Unit test with a hand-made minimal font header, not a
  Windows font: Windows fonts are never committed.
- A null from the font source falls back to `FPDFText_LoadStandardFont` (Helvetica, Times,
  Courier families) and adds a note. A test pins that with a non-null source the standard
  fonts are never used.

### 5. Tests

Unit tests run in Node. If the package's `index.cjs` or `index.js` loads in Vitest with the
`.wasm` read from `node_modules`, use it. Build every test PDF in the test with pdf-lib,
using its standard fonts. Cover, at least:

1. `listRuns` on a page with three lines, one with a bold word inside it (two runs on that
   line), one rotated 90 degrees, one in white (still listed), and invisible text (listed as
   not editable).
2. Replace keeps the position: the new run's box starts within 0.5 point of the old one.
3. Replace with text only using characters already drawn keeps the font. A new character
   substitutes, with the note.
4. The squeeze: slightly longer text ends within 0.5 point of the old right edge; much
   longer text gets `runs-past-end`.
5. Delete removes the run and leaves every other run's text and box unchanged.
6. Insert with `styleFrom` copies font, size and colour; with null, Arial 11 point black
   (the standard-font fallback in Node, since there is no font source there).
7. Replay of three edits in a row, the second targeting a run the first created.
8. A stale locator fails with the message above and changes nothing.
9. pdf-lib can reload every saved result, and PDF.js's text extraction is not needed here.

### 6. P6.5 - prove it in the release build

`scripts/prod-smoke/edit-probe.mjs`, following `run.mjs`'s safety rules exactly (refuse if
PDFluffer runs, temp copies, back up and restore the user's state, `Page.bringToFront`). With
no UI to click, it calls the registered engine from the page through a **test hook**: expose
`window.__pdfluffer_test__ = { engines }` **only** when `import.meta.env.MODE !== 'production'`
or a `PDFLUFFER_TEST_HOOK` launch argument is present. Check the Rust side passes that
argument through to the page, or pick the smallest safe alternative and record it. It must:

1. Open `samples/three-pages.pdf`. Call `listRuns` on page 1 and find "Page 1".
2. `applyEdits` replacing "Page 1" with "Page one", read the font notes.
3. Load the result in the tab and read it back with PDF.js: "Page one" is there, "Page 1" is not.
4. Call `readSystemFont('arial.ttf')` through the engine's source: non-null in the release build.
5. No console error, no CSP violation, no exception.

## Decision rules

- If the `.wasm` cannot load under the production CSP, report the exact violation. The CSP
  already allows `'wasm-unsafe-eval'`. Do not loosen anything else without recording why.
- If PDFium cannot keep a rotated run's direction, or `GenerateContent` changes runs you did
  not touch, stop that item and record what you saw, with numbers.
- If the package's own wrapper differs from the raw function names above, use the wrapper and
  record the mapping. Do not vendor or patch the package.
- No em dashes under `src/` or `src-tauri/`. Never commit a Windows font or a real document.

## Out of scope

The editor dialog, undo, the Document menu item, any React, the 0.2.0 release, chip 13's work,
images, reflow. Do not edit the spec or the concept. Never edit `public/pdfjs/`.

## Escalation

On a contradiction, or after three honest failed attempts at one item: stop that item, write
it under "Questions for the user" in `BUILD-NOTES.md`, and continue elsewhere.

## Acceptance - check each yourself and say how

1. `npm run check`, `cargo test` and `npm run build` pass.
2. `grep -rln "@embedpdf/pdfium" src` prints only `src/engine/pdfiumAdapter.ts` and its test.
   `grep -rln "@tauri-apps" src` prints exactly the two allowed files.
3. The app starts without fetching the PDFium chunk or the `.wasm` (network panel), and
   fetches both at the first engine call.
4. `edit-probe.mjs` passes against a fresh `npm run tauri build`, and `smoke:prod`,
   `smoke:ocr` and `backup.mjs` stay green. If the user has the app open, hand these over.
5. `git status --porcelain public/pdfjs` prints nothing.
6. Plan boxes P6.1 to P6.5 are ticked, each only if its tests pass.

## Conventions

Follow the Git and Style sections of `CLAUDE.md`. One commit per plan item. Never push. End
each commit with a `Co-Authored-By:` trailer naming the model you are.

## Closing report

What you built, how the `.wasm` loads, how runs group on the samples (a table), the font
notes the tests saw, the release probe result, the installer size change, every deviation and
question, and `git log --oneline` since chip 13.
