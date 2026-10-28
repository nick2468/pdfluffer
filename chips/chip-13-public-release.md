# Chip 13 - the public release

You are the builder for PDFluffer, in `C:\Users\nick2\Code\pdfluffer`. A separate
orchestrator session wrote the spec and reviews your work. This chip is your whole task.

## Where things stand

Chip 12 (OCR) is done and reviewed: 421 npm tests and 23 cargo tests pass, `smoke:ocr` 33 of
33, `smoke:prod` 24 of 24, `backup.mjs` 14 of 14. Chip 12's deviation 30 is **ratified**, and
its two questions are **ruled** (spec 20.1 O5 and the new spec 20.5a). Both land here.

On 2026-10-24 the user ruled that **PDFluffer is open source under MIT, in a public GitHub
repo, with the installer on GitHub Releases.** `LICENSE` and `README.md` exist. The repo
`nick2468/pdfluffer` is `origin`. **You still never push.** The orchestrator pushes, tags
and publishes the release after reviewing you.

## Read first

1. `CLAUDE.md`. Two new rules: the repo is public, and the app icon is no longer out of scope.
2. `BUILD-NOTES.md`, decision 18 and questions 1 and 2 under chip 12.
3. `pdfluffer-spec.md` 20.1 (O5, revised), 20.5a (new), and 13.3 for `runOp`.
4. `pdfluffer-plan.md`, phase 5. You do **P5.1 to P5.4**.

## The work

### 1. P5.1 - O5: skip any page with real text

`pageTextLength(page) > 0` means skip. Update the OCR tool, its unit tests, the confirm
count, and `scripts/prod-smoke/ocr.mjs` check 7, which must now use `three-pages.pdf`
("Page 1" is real text, so "Nothing to read") and keep `form-basic.pdf` as a second case.
Move chip 12's question 1 to "Decisions taken under a named rule" with the ruling.

### 2. P5.2 - the "Save first" guard (spec 20.5a)

- `Viewer.hasStructuralChanges(): boolean`, in `PdfJsViewer.ts` (D7), from
  `pdfThumbnailViewer?.hasStructuralChanges?.() === true`. `FakeViewer` gets a settable flag.
- `SessionManager.hasStructuralChanges(tabId)`, a thin pass-through.
- In the OCR tool and the four Document tools, before any dialog: if true, show title
  "Save first", body "You have moved or deleted pages. Save the file, then run this again.",
  one `ok` button, and return. Put the text in `dialogTexts.ts`. Unit test each tool.
- Move chip 12's question 2 to "Decisions taken under a named rule".

### 3. P5.3 - an icon of PDFluffer's own

The installer still ships the Tauri scaffold's icon. Draw one as an SVG,
`src-tauri/icons/app-icon.svg`, 1024 by 1024: a plain page with a folded corner and a
soft, rounded "fluff" shape or a single bold **P**, in two flat colours, readable at 32
pixels. No gradients, no text smaller than a third of the canvas. Then, with the Rust PATH
set, run `npx tauri icon src-tauri/icons/app-icon.svg` to regenerate every file in
`src-tauri/icons/`. Check `tauri.conf.json` still lists the same icon files. Record what you
drew in `BUILD-NOTES.md`. Add `<link rel="icon" href="icons/32x32.png">` only if
`index.html` currently points at `data:,` **and** the file is served in production; otherwise
leave the favicon as it is.

### 4. P5.4 - version 0.1.2, installer, smoke tests

- **Bump the version to `0.1.2`** in `package.json`, `src-tauri/tauri.conf.json` and
  `src-tauri/Cargo.toml` (and `Cargo.lock` follows). v0.1.0 was released on 2026-10-24 from
  the 2026-09-21 installer; v0.1.1 (signed, publisher set) on 2026-10-28; this chip's installer is 0.1.2.
- Grep the tracked files for anything personal before the release: real names from the
  user's documents, real file names, secrets. Fixture names like "Alex Example" are fine.
  Report what you found; change nothing without recording it.
- With the Rust PATH set, `npm run tauri build` after your last code commit (unsigned; the
  orchestrator makes the signed one with `npm run build:signed`). Record the installer's
  path, size and SHA-256. **Never change `bundle.publisher`.**
- With PDFluffer closed: `npm run smoke:prod`, `npm run smoke:ocr`,
  `node scripts/prod-smoke/backup.mjs`. All green. If the user has the app open, do not
  close it: say so and leave them to the orchestrator.

## Decision rules

- Spec 20.5a names the guard's wording. Use it exactly.
- If `npx tauri icon` rejects the SVG, rasterise it to a 1024 PNG with the headless Edge
  technique from chip 11's fixtures script and feed it that. No image library.
- No new dependencies. No em dashes under `src/` or `src-tauri/`. UI text in Australian English.

## Out of scope

Tagging, releasing, pushing, the showcase site, the README beyond fixing a wrong fact,
code signing, an updater, anything in spec section 3 other than item 14.

## Escalation

On a contradiction, or after three honest failed attempts at one item: stop that item,
write it under "Questions for the user" in `BUILD-NOTES.md`, and continue elsewhere.

## Acceptance - check each yourself and say how

1. `npm run check` passes with the new tests. `cargo test` passes. `npm run build` succeeds.
2. `grep -rln "@tauri-apps" src` prints exactly the two allowed files;
   `grep -rln "PDFViewerApplication\|contentWindow\|contentDocument" src` only `PdfJsViewer.ts`.
3. `git status --porcelain public/pdfjs` prints nothing. Dependencies unchanged.
4. The installer and its SHA-256 are recorded, and the three smoke runs are green or handed over.
5. Plan boxes P5.1 to P5.4 are ticked. P5.5 and P5.6 stay unticked.

## Conventions

Follow the Git and Style sections of `CLAUDE.md`. One commit per plan item. Never push.
End each commit with a `Co-Authored-By:` trailer naming the model you are.

## Closing report

What you built, how you checked each acceptance item, the icon you drew, the installer path,
size and SHA-256, the smoke results, every deviation and question, and `git log --oneline`
since chip 12.
