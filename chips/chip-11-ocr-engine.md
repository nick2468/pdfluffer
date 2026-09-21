# Chip 11 - the OCR engine, and the truth about skewed pages

You are the builder for PDFluffer, in `C:\Users\nick2\Code\pdfluffer`. A separate
orchestrator session wrote the spec and reviews your work. This chip is your whole task.

## Where things stand

Desktop version 1 is finished, tested by the user, and has no open checks. 345 npm tests
and 17 cargo tests pass. `npm run smoke:prod` passes 24 of 24 and `backup.mjs` 14 of 14.
Chip 10's deviations 27 and 28 are **ratified**.

The user now wants **OCR**: a scanned PDF is only pictures, so its text cannot be selected
or copied. PDFluffer will add an invisible text layer over each scanned page, using the OCR
engine built into Windows. Phase 4 is two chips. **This one builds and proves the engine
side. It adds no UI and writes nothing into any PDF.** Chip 12 builds the rest, and what it
says depends on what you find here.

## Read first

1. `CLAUDE.md`. Note the new rule on which files may import `@tauri-apps`.
2. `BUILD-NOTES.md`, mainly the "Orchestrator checks" section and decision 15, which
   explains the headless-browser traps you will meet again.
3. `pdfluffer-spec.md` **section 20**, all of it. Also 10.3 for how commands are written.
4. `src-tauri/src/lib.rs` and `files.rs`, for the house style of commands and their tests.
5. `pdfluffer-plan.md`, phase 4. You do **P4.1 to P4.4**.

## Facts the orchestrator checked

- Microsoft's documentation, quoted in spec 20.2. The key one: on a skewed picture the
  engine reports `TextAngle` (clockwise, in degrees, about the picture's centre), and each
  word's `BoundingRect` is "calculated from the rotated image". So the rectangles describe
  a **straightened** picture. The documentation does not say which way to rotate them back.
- `src-tauri/Cargo.lock` already holds the `windows` crate at **0.61.3**, because Tauri
  depends on it. Use that version, so nothing new is downloaded or compiled twice.
- The user's real scans are 300 dpi, about 2500 by 3500 pixels, skewed about one degree.
  `OcrEngine.MaxImageDimension` is probably smaller than 3500. Read it at run time.

## The work

### 1. P4.1 - test pictures whose word positions are known

Write `scripts/make-ocr-fixtures.mjs`. It drives a **headless Edge with a throwaway
profile** over the DevTools protocol, the way chip 10's checks did (reuse
`scripts/prod-smoke/cdp.mjs` if it fits, and send `Page.bringToFront` first). It loads a
small local HTML page that it writes itself, takes a screenshot with
`Page.captureScreenshot`, and reads each word's true box from the page with
`getBoundingClientRect()`.

The page: white background, black Arial text at about 28 px, around ten lines, at 1600 by
1200 CSS pixels and device scale factor 1. Use plain words that OCR will not confuse, plus
one line of digits and one line in capitals. Give every word its own `<span>`.

Produce, in `samples/ocr/`:

| File | What it is |
|---|---|
| `straight.png` and `straight.json` | No rotation. The JSON lists each word's text and true box in picture pixels |
| `skew-cw2.png` and `.json` | The same page with the whole text block rotated **2 degrees clockwise** by CSS `transform: rotate(2deg)` about the picture's centre. The JSON holds each word's true **centre** in picture pixels after the rotation |
| `skew-ccw2.png` and `.json` | The same, rotated 2 degrees anticlockwise |
| `too-large.png` | A plain white picture 200 pixels wider than `MaxImageDimension`. Make it after step 2 tells you the limit. No JSON |

Commit the script and its output. The pictures are small. Delete the throwaway profile
afterwards. Never touch the user's own browser profile.

### 2. P4.2 - the Rust side, in `src-tauri/src/ocr.rs`

Add the `windows` crate at the locked version with only the features you need. Expect
`Media_Ocr`, `Graphics_Imaging`, `Storage_Streams`, `Foundation`,
`Foundation_Collections` and `Globalization`. Let the compiler tell you the rest.

- `pub fn status() -> OcrStatus` and
  `pub fn recognise(image: &[u8]) -> Result<OcrPageResult, String>`, as plain functions,
  with the two commands in `lib.rs` as thin wrappers. `ocr_image` is
  `#[tauri::command(async)]` and takes the picture as the raw request body, like `write_pdf`.
- The result shapes are in spec 20.3. Serialise with `serde`, camelCase field names.
- Decode with `BitmapDecoder` over an in-memory stream. Convert the `SoftwareBitmap` to a
  pixel format the engine accepts if it complains (`Bgra8`, premultiplied alpha, is the
  usual one). A picture wider or taller than `MaxImageDimension` returns
  `Err("ocr-too-large")` **without** calling the engine.
- Choose the engine as spec 20.3 says. No engine at all returns `Err("ocr-unavailable")`.
- The WinRT calls are asynchronous. Block on them with whatever the 0.61 crate offers
  (`.get()` or `.join()`). The command already runs off the main thread.

`cargo test`, reading the pictures from `samples/ocr/`:

1. `status()` reports available, a language, and a `max_image_dimension` above 1000.
2. `straight.png`: at least 90% of the expected words are found with exactly the right
   text, and each found word's box centre is within 12 pixels of the true centre.
   `text_angle` is null or within 0.3 of zero.
3. `too-large.png` gives `ocr-too-large`.
4. Bytes that are not a picture give an `ocr: ...` error, not a panic.
5. If this machine has no OCR language, tests 2 to 4 must **skip with a printed reason**,
   not fail, and you stop and report it. Do not try to install a language pack.

### 3. P4.3 - settle the skew question, with evidence

This is the point of the chip. For `skew-cw2.png` and `skew-ccw2.png`, record in
`BUILD-NOTES.md`, under a new decision, a small table: the `text_angle` the engine reports
for each picture (value **and sign**), and for five words spread across the page (corners
and centre) the reported box centre beside the true centre.

Then find the mapping. Try the four candidates: the reported centre rotated about the
picture's centre by `+text_angle`, by `-text_angle`, not rotated at all, and rotated about
the top-left corner. One of them should land every word within about 12 pixels of its true
centre, for **both** pictures. Write that rule down as one formula, with the y axis
pointing down, and say in plain words which way it turns.

Put the winning rule in a Rust test so it stays proven: for both skewed pictures, at least
90% of words land within 12 pixels after the mapping. **Do not apply the mapping inside
`recognise`.** The command returns exactly what the engine gave. Chip 12 applies the
mapping in TypeScript, where the page geometry lives.

If no candidate fits, or the engine returns a null angle for a 2 degree skew, stop this
item, record the full table, and say what you saw. That is a finding, not a failure.

### 4. P4.4 - the TypeScript service

- `src/ocr/OcrService.ts`: the interface and the two result types from spec 20.3 and 20.4.
- `src/ocr/fakeOcrService.ts`: for tests. It returns queued results, records the pictures
  it was given, and can be told to be unavailable or to fail.
- `src/ocr/tauriOcrService.ts`: `status()` calls `ocr_status`. `recognise(image)` calls
  `ocr_image` with the bytes as the raw body. Map a rejection to a small `OcrError` with
  codes `unavailable`, `too-large` and `failed`, through a pure exported function with unit
  tests, the way `toFileError` does it.
- `src/ocr/index.ts`: `createOcrService(): OcrService | null`, returning the Tauri one when
  `'__TAURI_INTERNALS__' in window`, else null. **Nothing calls it yet.**

## Decision rules

- The compiler is the authority on the `windows` crate's names and feature flags. Record
  what you ended up with under "Deviations" if it differs from this chip.
- If a WinRT call fails with an apartment or "CoInitialize has not been called" error,
  initialise a multithreaded apartment on that thread once, and record it.
- Do not add an image crate. Windows decodes the picture.
- The fixtures script is a development tool. It may use headless Edge. The app may not.
- Keep OCR text out of logs and notes beyond the fixture words. When you later test on a
  real scan, never print or record what it says.

## Out of scope

Everything in P4.5 to P4.10: rendering pages, placement maths, writing the text layer, the
tool, dialogs, progress, the smoke test. No UI. No change to any PDF. No Tesseract. No
language picker. No new npm dependency. Do not edit the spec or the concept. Never edit
`public/pdfjs/`.

## Escalation

On a contradiction, or after three honest failed attempts at one item: stop that item,
write it under "Questions for the user" in `BUILD-NOTES.md`, and continue elsewhere.

## Acceptance - check each yourself and say how

1. With the Rust PATH set, `cargo test` passes, with the new OCR tests, in under a minute.
2. `npm run check` passes with the new tests. `npm run build` succeeds.
3. `grep -rln "@tauri-apps" src` prints exactly `src/files/tauriFileAdapter.ts` and
   `src/ocr/tauriOcrService.ts`.
4. `git status --porcelain public/pdfjs` prints nothing. `package.json` dependencies are
   unchanged. `Cargo.toml` gained only the `windows` crate, at the locked version.
5. The skew table and the winning formula are in `BUILD-NOTES.md`.
6. With the Rust PATH set, `npm run tauri build` succeeds, and with PDFluffer closed,
   `npm run smoke:prod` still reports every check passed. If the user has the app open, do
   not close it. Say so and leave that step to the orchestrator.
7. Plan boxes P4.1 to P4.4 are ticked, P4.3 only if a rule was found. No other box.

## Conventions

Follow the Git and Style sections of `CLAUDE.md`. One commit per plan item where you can.
Never push. No em dashes under `src/` or `src-tauri/`. End each commit with a
`Co-Authored-By:` trailer naming the model you are.

## Closing report

What you built, how you checked each acceptance item, the language and
`MaxImageDimension` this machine reports, the skew table and the formula, the test counts,
every deviation and question, and `git log --oneline` since chip 10.
