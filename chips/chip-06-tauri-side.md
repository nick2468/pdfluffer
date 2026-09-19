# Chip 6 - the Tauri side

You are the builder for PDFluffer, in `C:\Users\nick2\Code\pdfluffer`. A separate
orchestrator session wrote the spec and reviews your work. This chip is your whole task.

## Where things stand

Chips 1 to 5 are done and reviewed. 198 tests pass. The whole app works in the browser
harness: tabs, save rules, close rules, session restore, menu, dialogs, shortcuts. H1 to H8
and H10 passed. H9 (copy and paste) is a USER check. What is missing is the real desktop
side: real files on disk, launch arguments, single instance, drag and drop, and the
installer. `src-tauri/src/lib.rs` registers five plugins and has **no commands yet**.

## Rulings on chip 5's questions

1. **False dirty (radio groups, entering the signature tool).** Not yours. A later chip
   investigates it. Move it in `BUILD-NOTES.md` to "Known issues" with the line "Ruled
   2026-09-19: chip 7 investigates. Do not change `hasChanges` before then."
2. **`SessionManager.print` and the chip 5 small choices** are ratified.
3. **PDF.js's own `beforeunload` prompt.** Ruled: when `confirmCloseAll()` is about to
   return true, the manager first **destroys every viewer**, so no modified PDF.js frame is
   alive when the window goes. Removing an iframe does not raise the prompt. Add this
   test-first (`confirmCloseAll` that returns true leaves every `FakeViewer` destroyed; one
   that returns false destroys none). Move the question to "Decisions taken under a named
   rule". U7 and U8 below show whether it is enough in the real window.

## Read first

1. `CLAUDE.md` and `BUILD-NOTES.md`. Note the Rust PATH rule. It applies to every `cargo`
   and `npm run tauri` command, and it does not survive between tool calls.
2. `pdfluffer-spec.md` sections 8.1, 8.2, **all of 10**, 12.6, 15 item 8, 16 (U1 to U11).
3. `src/files/FileAdapter.ts` and `browserFileAdapter.ts`, for the contract and the style.
4. `pdfluffer-plan.md` - you do **P1.15 to P1.19**.

## The work

### 1. P1.15 - `parse_pdf_args`, with `cargo test`

Per spec 10.4. Put the pure helpers in `src-tauri/src/paths.rs`: `normalise(path: &Path)
-> Option<String>` (the rule in spec 10.3, `dunce::canonicalize`, parent plus file name
when the file does not exist yet) and `parse_pdf_args(args: &[String], cwd: &Path) ->
Vec<String>`. Tests per spec 15 item 8. No `tempfile` crate: make a unique folder under
`std::env::temp_dir()` and remove it at the end of the test.

### 2. P1.16 - the four commands, in `src-tauri/src/lib.rs`

Exactly spec 10.3 and 10.4. Extra rulings:

- Put the write steps in a plain function, `write_atomic(target: &Path, bytes: &[u8],
  backup: bool) -> Result<(), String>` in `src-tauri/src/files.rs`, and unit test it:
  it replaces an existing file, it creates a new file, it makes `<stem>.backup.pdf` once
  and never overwrites an existing backup, it leaves no `.pdfluffer-tmp` behind, and it
  refuses a path that does not end in `.pdf`.
- "Locked" means `ErrorKind::PermissionDenied`, or a raw OS error of 32 or 33 (Windows
  sharing and lock violations). Return `Err("locked")`. Everything else is `"io: <detail>"`.
- Decode the `x-path` header with the `percent-encoding` crate as UTF-8. A missing or
  undecodable header is `Err("io: bad x-path header")`.
- The single-instance callback needs `use tauri::{Emitter, Manager};`. It emits
  `open-files` with the parsed paths **only when the list is not empty**, and it always
  un-minimises and focuses the `main` window.
- Register all four commands in `invoke_handler`. Keep single-instance as the first plugin.

### 3. P1.17 - `src/files/tauriFileAdapter.ts`

`export class TauriFileAdapter implements FileAdapter`, per spec 10.3 to 10.5.

- `readFile`: `invoke<ArrayBuffer>('read_pdf', { path })`, wrapped in `new Uint8Array(...)`.
  The name is the last path segment, split on `\` or `/`.
- `writeFile`: the raw-body `invoke` call shown in spec 10.3.
- Map a rejected `invoke` to `FileError`: the rejection is the Rust string. `not-found`,
  `not-pdf` and `locked` map to those codes. Anything else maps to `io` with the text.
  Put that mapping in a pure exported function, `toFileError(reason: unknown): FileError`,
  and unit test it.
- `sameFile` compares lower-cased strings. `describe` returns the path.
- `loadState` and `saveState`: `@tauri-apps/plugin-store`, file `state.json`. Load the store
  once. `saveState` calls `set` then `save`.
- `onOpenRequest`: the `open-files` event **and** `getCurrentWebview().onDragDropEvent`,
  per spec 10.4. Both `listen` calls return promises of unlisten functions. The returned
  cleanup must handle that.
- `onCloseRequested`: `getCurrentWindow().onCloseRequested`, with `event.preventDefault()`
  when the handler resolves false.
- `setWindowTitle`, `openExternal` (`openUrl` from `@tauri-apps/plugin-opener`).
- In `src/files/index.ts`, replace the `TODO(chip 6)` with the real branch.

### 4. P1.18 and P1.19 - green bar, a real build, and the USER list

- `npm run check` passes. With the PATH set, `cargo test` and `cargo check` pass.
- With the PATH set, run `npm run tauri build` once. It takes several minutes. Record the
  installer's path and size, or the full error. **Do not run the installer.**
- If your tools allow it, start `npm run tauri dev` and check the log for Rust panics and
  permission errors. You probably cannot drive the window. Say plainly what you could not see.
- Write **`docs/user-checks-phase-1.md`**: U1 to U11 from spec 16 as a numbered list the
  user can follow cold, with exact commands (using `npm.cmd` and the PowerShell PATH line),
  which sample file to use, what they should see, and what to report back if not. Include
  H9 (copy and paste) as the first item. Include one extra check, **U12**: with an unsaved
  edit, close the window and choose Discard. No "Leave site?" prompt should appear, and
  the window should close.

## Decision rules

- A rejected Tauri permission or a missing API name: the compiler or the runtime error
  names the right one. Use it and record the change under "Deviations".
- `@tauri-apps/api` must only be imported by `tauriFileAdapter.ts`. Nothing else in `src/`
  may know Tauri exists.
- Do not add the `fs` plugin or any crate outside spec 5.
- If `npm run tauri build` fails on something outside the code (NSIS download, antivirus,
  a locked file), record it as a question. Do not work around it.
- Do not change `tauri.conf.json` values from spec 10.2, except as a recorded fix for a
  real build error.

## Out of scope

Phase 2 (`runOp`, `revert`, Document tools, the backup checkbox in the UI), the false-dirty
issue, a custom icon, an updater, code signing, Mac and Linux. Do not edit the spec or the
concept. Never edit `public/pdfjs/`.

## Escalation

On a contradiction, or after three honest failed attempts at one item: stop that item,
write it under "Questions for the user" in `BUILD-NOTES.md`, and continue elsewhere.

## Acceptance - check each yourself and say how

1. `npm run check` passes, with tests for `toFileError` and the destroy-on-close ruling.
2. `cargo test` passes, with tests for `parse_pdf_args`, `normalise` and `write_atomic`.
3. `grep -rln "@tauri-apps" src` prints only `src/files/tauriFileAdapter.ts`.
4. `grep -rn "PDFViewerApplication" src` matches only `src/viewer/PdfJsViewer.ts`.
5. `git status --porcelain public/pdfjs` prints nothing. No new npm or Rust dependency.
6. The installer build result is recorded.
7. `docs/user-checks-phase-1.md` exists and covers H9 and U1 to U12.
8. Plan boxes P1.15 to P1.19 are ticked. P1.14, P1.20 and P1.21 stay unticked.

## Conventions

Follow the Git and Style sections of `CLAUDE.md`. One commit per plan item where you can.
Never push. No em dashes under `src/` or `src-tauri/`. End each commit with a
`Co-Authored-By:` trailer naming the model you are.

## Closing report

What you built, how you checked each acceptance item, the test counts (npm and cargo), the
installer path and size, every deviation and question, and `git log --oneline` since chip 5.
