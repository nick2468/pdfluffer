# PDFluffer - rules for every session in this repo

PDFluffer is a personal, no-nag PDF reader and light editor for Windows. It is a Tauri 2
desktop app with a React and TypeScript core. It hosts the unmodified PDF.js viewer in an
iframe per tab.

## Read first

1. `pdfluffer-spec.md` - what to build. It makes the design decisions. Do not re-make them.
2. `pdfluffer-plan.md` - the order of work. Tick a box when the item is done and checked.
3. `BUILD-NOTES.md` - what earlier sessions found. Read it before you start. Keep it current.
4. `pdfluffer-concept.md` - background only.

## Hard rules

- **Never edit anything under `public/pdfjs/`.** It is vendored PDF.js. Customise it only
  from outside, as spec section 9 describes.
- **Only `src/viewer/PdfJsViewer.ts` may touch PDF.js objects** such as
  `PDFViewerApplication`, or reach inside the iframe.
- **No network.** No CDN links, web fonts, analytics, update checks or remote fetches.
- **No new dependencies** beyond spec section 5. Do not change a pinned version.
- **The builder installs no toolchain.** Rust 1.98 is at `%USERPROFILE%\.cargo\bin` and is
  **not on the shell PATH**. Put it there at the start of every command that needs `cargo`
  or `npm run tauri`. The setting does not survive between tool calls. PowerShell:
  `$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"`. Git Bash:
  `export PATH="$HOME/.cargo/bin:$PATH"`. If `rustc` is not there, stop and tell the user.
- **Node 24.** The machine runs the Node 24 line, and `.node-version` says `24.21.0`, the
  pin every sibling app uses. Keep Vitest at `^4.1.11` to match them.
- **`samples-private/` holds the user's real documents.** Never commit, quote, summarise or
  upload anything from it.
- Build nothing from spec section 3 (out of scope), even if it looks easy.

## When something does not fit

Stop that item after three honest attempts, or at once on a contradiction with the spec.
Write what you found under "Questions for the user" in `BUILD-NOTES.md`. Continue with
items that do not depend on it. Never invent a workaround that changes the design. Where
the spec names a fallback or a decision rule, use it and record that you did.

## Checks

- `npm run check` runs `tsc --noEmit` and `vitest run`. It must pass before every commit.
- `cargo test` in `src-tauri/` must pass before a commit that touches Rust.
- Never say something works unless you ran it and saw it. Say how you checked.
- Checks marked **USER check** in the spec need a person at the real app. List them with
  exact steps. Do not tick them.

## Commands

```bash
npm run dev
```

Runs the core in a browser tab on port 1420, with the browser development harness.

```bash
npm run tauri dev
```

Runs the real desktop app.

```bash
npm run tauri build
```

Builds the Windows installer.

## Git

- Work on `main`. No worktrees. No remote. **Never push.**
- The approved spec authorises local commits. Commit small, one plan item or a few.
- `git status` first. Stage explicit paths. Never `git add -A`. Never `git clean`.
- Subject line in the imperative, under 70 characters. End every message with a
  `Co-Authored-By:` trailer that names the model that actually did the work.
- If a PowerShell here-string mangles a message, write it to a scratch file and use
  `git commit -F`.

## Style

- Australian English in user-facing text and docs (colour, normalise, licence as a noun).
- No em dashes anywhere under `src/` or `src-tauri/`. Use a plain hyphen or a new sentence.
- Match the surrounding code. Plain CSS, plain React, plain TypeScript classes for logic.
- Logic lives in plain TypeScript (`src/session`, `src/util`, `src/engine`) so it can be
  unit tested without React or a browser.
