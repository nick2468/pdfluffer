# PDFluffer - build plan, desktop app version 1

The builder ticks a box when the item is done **and checked**. Section numbers point into
`pdfluffer-spec.md`. Build in order. A box marked **USER** is ticked by the user only.

## Phase 0 - spike and foundations

- [x] P0.1 Run the three version commands, with `.cargo\bin` put on the PATH first. Stop if `rustc` is not found there or Node is older than 24 (spec 4)
- [x] P0.2 `git init -b main`. Add `.gitignore` (spec 6.3). First commit holds the existing `.md` files
- [x] P0.3 Create `BUILD-NOTES.md` with its headings. Record the environment (spec 18)
- [x] P0.4 Scaffold Tauri 2 + React + TypeScript. Remove the demo code. Vite on port 1420 (spec 10.1)
- [x] P0.5 Add the npm scripts `dev`, `build`, `check`, `samples`, `tauri`. Install Vitest
- [x] P0.6 Vendor PDF.js 6.3.289 into `public/pdfjs/` unchanged. Write `VENDOR-PDFJS.md` (spec 6.2)
- [ ] P0.7 Write `scripts/make-samples.ts`. Generate the four sample PDFs (spec 14)
- [ ] P0.8 Re-check facts F1 to F10 against the vendored files. Record each (spec 7)
- [ ] P0.9 Write `Viewer.ts` and a first `PdfJsViewer.ts`: mount, options, load, `hasChanges`, `exportBytes` (spec 8.3, 9.1-9.5)
- [ ] P0.10 Throwaway spike page: one viewer, open `form-basic.pdf` from bytes, the signature tool is visible, fill a field, `exportBytes()` differs from the original
- [ ] P0.11 Answer the dirty-signal question. Record whether fallback B applies (spec 9.5)
- [x] P0.12 Set `tauri.conf.json` and `capabilities/default.json` (spec 10.2, 10.5)
- [ ] P0.13 **USER** `npm run tauri dev` shows the spike page. The console shows no CSP errors (U11)
- [ ] P0.14 Phase 0 acceptance criteria met (spec 17). Commit

## Phase 1 - the Must list

- [ ] P1.1 `FileAdapter.ts`, `fakeFileAdapter.ts`, `browserFileAdapter.ts`, `createFileAdapter()` (spec 8.1, 8.2)
- [ ] P1.2 `hasDigitalSignature` with tests (spec 12.4, 15.1)
- [ ] P1.3 State schemas with load, default and debounce rules, with tests (spec 8.6, 15.3)
- [ ] P1.4 `decideSave` with its truth-table tests (spec 12.3, 15.2)
- [ ] P1.5 `DocumentSession` and `SessionManager`: open, activate, lazy load, history (spec 8.4, 8.5, 12.1, 12.2)
- [ ] P1.6 Save and Save As flows, with tests (spec 12.3, 15.5)
- [ ] P1.7 Close tab and close window flows, with tests (spec 12.5, 15.6)
- [ ] P1.8 Start and session restore, not-found and Locate, with tests (spec 12.6, 15.4)
- [ ] P1.9 Finish `PdfJsViewer.ts`: view state, injected CSS, event forwarders, print, focus (spec 9.3, 9.4, 9.6)
- [ ] P1.10 App frame: layout, tab bar, panels, `ChoiceDialog`, `useSession()` (spec 11.1, 11.2, 11.4, 11.5)
- [ ] P1.11 App menu, Recent list, Settings, Clear history, About (spec 11.3, 11.5)
- [ ] P1.12 Keyboard shortcuts from both the parent window and the iframe. Window title (spec 11.6, 11.7)
- [ ] P1.13 XFA banner, Signed chip, signature guard dialog, external link dialog (spec 12.4, 12.7, 12.8)
- [ ] P1.14 Remove the spike page. Harness checks H1 to H10 pass (spec 16)
- [ ] P1.15 Rust: `parse_pdf_args` with `cargo test` (spec 10.4, 15.8)
- [ ] P1.16 Rust: the four commands, the atomic write, single instance, pending files (spec 10.3, 10.4)
- [ ] P1.17 `tauriFileAdapter.ts`: dialogs, read, write, state, open requests, drag and drop, close request, title, external links (spec 10.3-10.5)
- [ ] P1.18 `npm run check` and `cargo test` pass. Commit
- [ ] P1.19 Give the user the USER checks U1 to U11 with exact steps (spec 16)
- [ ] P1.20 **USER** U1 to U11 pass. Apply the U4 decision rule if needed
- [ ] P1.21 Phase 1 acceptance criteria met (spec 17)

## Phase 2 - engine adapter and document tools

- [ ] P2.1 `EngineAdapter.ts`, `engineRegistry.ts`, `toolRegistry.ts` (spec 13.1, 13.2)
- [ ] P2.2 `SessionManager.runOp` with the signature guard and `pendingEngineChanges` (spec 13.3)
- [ ] P2.3 `pdfLibAdapter`: insert PDF, with tests (spec 13.4, 15.7)
- [ ] P2.4 `pdfLibAdapter`: rotate, with tests
- [ ] P2.5 `pdfLibAdapter`: flatten form fields, with tests
- [ ] P2.6 `pdfLibAdapter`: flatten annotations, with tests. Apply the stop rule if needed (spec 13.4)
- [ ] P2.7 The four tools and the Document submenu (spec 13.5)
- [ ] P2.8 Revert to saved. The backup setting, end to end (spec 13.6)
- [ ] P2.9 Harness check H11 passes. `npm run check` passes. Commit
- [ ] P2.10 **USER** A flattened, signed form looks right in Acrobat, Chrome and Edge
- [ ] P2.11 Phase 2 acceptance criteria met (spec 17)
