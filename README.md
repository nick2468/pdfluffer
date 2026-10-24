# PDFluffer

A PDF reader and editor for Windows with no ads, no account, no nag screens and no
network. Read several PDFs in tabs, fill in forms, sign them, tidy up pages, and make a
scanned PDF searchable.

I built it because every PDF app I tried wanted me to pay for the basics and reminded me
on every page. PDFluffer does what most people need from a PDF app and nothing else.

Screenshots: [nick2468.github.io/pdfluffer](https://nick2468.github.io/pdfluffer/).

## What it does

- Opens several PDFs in tabs, and reopens them where you left off.
- Searches, selects and copies text.
- Fills in forms, and adds text anywhere on a form that has no fields.
- Signs: draw, type or use a picture. Saved signatures come back next time, and you can
  rename them.
- Highlights, draws, adds notes and pictures.
- Reorders and deletes pages, inserts another PDF, rotates pages.
- **Flatten** makes the answers, notes and signatures a permanent part of the page before
  you send a form on.
- **Make text selectable (OCR)** reads a scanned PDF with the OCR built into Windows and
  adds an invisible text layer, so you can select, copy and search it. The picture is
  never changed, so stamps, logos and signatures stay exactly as scanned.
- Saves straight back to the file. The first overwrite of each file asks once. A backup of
  the original can be kept. Revert to saved undoes everything since the last save.
- Shows a badge on a digitally signed PDF, and warns before a change that would break
  the signature.
- Opens when you double-click a PDF, and uses one window for everything.

It never touches the network: no telemetry, no update checks, nothing uploaded.

## Install

Download the latest installer from
[Releases](https://github.com/nick2468/pdfluffer/releases/latest) and run it. It installs
for the current user and needs no administrator rights.

The installer is not signed with a code-signing certificate, so Windows SmartScreen will
say the publisher is unknown. Choose **More info**, then **Run anyway**. The warning says
nothing about the file beyond the fact that I have not bought a certificate. You can read
the source here, or build it yourself, rather than take my word for it.

To make PDFluffer your default PDF app: Windows Settings, Apps, Default apps, search for
`.pdf`, choose PDFluffer.

Needs Windows 10 or 11 with the WebView2 runtime, which Windows 11 includes. OCR needs a
Windows language pack with OCR, which the English packs have.

## Build it yourself

You need Node 24, the Rust toolchain (stable, MSVC) and the Visual Studio C++ build tools.

```
npm install
npm run check          # type check and unit tests
npm run dev            # the core in a browser tab, with an in-browser file store
npm run tauri dev      # the real desktop app
npm run tauri build    # the installer, in src-tauri/target/release/bundle/nsis/
```

`npm run smoke:prod`, `smoke:ocr` and `node scripts/prod-smoke/backup.mjs` drive the
built release through its own debugging port, with no one at the window, and check saving,
single instance, session restore, OCR placement and the backup file. Close PDFluffer first.

## How it is made

PDFluffer is a [Tauri 2](https://tauri.app) desktop app with a React and TypeScript core.
Each tab hosts the unmodified [PDF.js](https://mozilla.github.io/pdf.js/) viewer, the same
engine Firefox uses, inside an iframe. Reading, forms, signatures and notes are PDF.js's
own. PDFluffer adds the window, the tabs, file handling, the save rules, session restore
and the Document tools. Page operations use [pdf-lib](https://pdf-lib.js.org). OCR uses
`Windows.Media.Ocr` from the Rust side.

The design is written down before the code: `pdfluffer-concept.md` is the audit and the
plan, `pdfluffer-spec.md` the contract, `pdfluffer-plan.md` the checklist, and
`BUILD-NOTES.md` the record of what was found while building, including the few places
the spec was wrong. The code was built in twelve "chips" (`chips/`), each a
self-contained task given to an AI model, with every change reviewed against the spec.

## Known limits

- PDF.js is vendored unmodified in `public/pdfjs/`, so an upgrade is a folder swap. Its
  wording and toolbar are its own.
- Editing existing text and images is out of scope. Add text over the top, or go back
  to the source document.
- OCR reads print, not handwriting, and Latin alphabets only.
- Windows only.

## Licence

MIT. See `LICENSE`. PDF.js is Apache 2.0 and pdf-lib is MIT; their notices are in their
own folders under `public/pdfjs/` and `node_modules/`.
