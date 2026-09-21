# PDFluffer - concept

Status: draft 3. First written 2026-09-19. The user's rulings are recorded in section 10.
Nothing is built yet.

The build spec for the desktop app is `pdfluffer-spec.md`, with its checkbox plan in
`pdfluffer-plan.md`. Where this concept and the spec disagree, the spec wins.

## 1. Summary

PDFluffer is a personal PDF reader and light editor with no ads, no nag screens, no account
and no network calls. It reads several PDFs at once, copies text, fills forms and adds
signatures. It reopens the files you had open last time.

The recommendation in one paragraph:

- Build **one core** as a React and TypeScript web app.
- Use **PDF.js** as the PDF engine. PDF.js is the open-source engine inside Firefox. It
  already renders pages, selects text, fills forms, adds signatures and reorders pages.
  PDFluffer bundles it. You do not install Firefox.
- Use **pdf-lib** for the few jobs PDF.js does not do, such as merging files and flattening.
- Wrap the core in **shells**. A shell is the thin outer layer that opens and saves files
  for one platform. The first shell is a **Tauri 2** Windows desktop app. The second is
  one browser extension for **Chrome and Edge**.
- Build three **seams** into the core from the start (section 5.1). A seam is a planned
  joint where a part can be swapped or added later. These seams let text editing, XFA
  forms, certificate-based signatures and OCR arrive later without a refactor.

Most of the hard work is already done by PDF.js under a permissive licence. PDFluffer is
mostly a clean shell, a tab bar and a few tools around it. That keeps the project small.

The audit also found that you need far fewer features than Acrobat and UPDF sell. Almost
everything they charge for is an edge case for most people.

## 2. Goals and non-goals

### Goals

1. Read several PDFs at once, in tabs.
2. Select and copy text.
3. Fill PDF forms and save the result.
4. Add a signature, and keep saved signatures for reuse.
5. Reopen the files that were open last time, each at the page where you left it.
6. No ads, no upsell, no sign-in, no telemetry. The app never uses the network.
7. Windows first. Open a PDF by double-clicking it.
8. Files stay standard. Anything PDFluffer saves opens correctly in Acrobat, Chrome and Edge.
9. No new browser to install (section 8).

### Non-goals for version 1

1. Editing the existing text or images of a PDF. Section 3.6 explains why. The design
   keeps a place for it (section 5.2).
2. Converting PDFs to Word, Excel or PowerPoint.
3. Cloud storage, sharing, review workflows or "send for signature" services.
4. AI features.
5. Designing new forms.

## 3. Feature audit

### 3.1 Method and caveat

I compared the free tiers of Adobe Acrobat (Reader and the Chrome extension) and UPDF
against what each sells. Vendors change their free tiers often, so treat the "free" and
"paid" labels as a snapshot from September 2026. Sources are in section 11.

Two terms used below:

- **AcroForm** is the standard format for interactive PDF form fields: text boxes,
  checkboxes, radio buttons and dropdowns. Most fillable forms use it.
- A **flat form** is a PDF that only looks like a form. It has no fields. You fill it by
  placing text and tick marks on top of the page. These are very common, so the
  "add text anywhere" tool matters as much as AcroForm support.

### 3.2 Why the current tools annoy

- **Acrobat** puts paid tools in the same toolbar as free ones. Clicking one opens a
  purchase prompt. It also prompts for sign-in and promotes its AI assistant. Acrobat Pro
  is subscription-only, about USD 20 a month.
- **UPDF** lets you do most things in the free version but **adds a watermark when you
  save**. In practice the free version is a viewer. It also caps conversion at 2 a day and
  OCR at 5 uses. The paid version is about USD 40 a year or USD 70-80 once.

Neither product is bad. Both are built to convert free users to paid users, and the
friction you feel is that design working as intended.

### 3.3 Must have (version 1)

These cover the daily needs of most users.

| Feature | Acrobat free | UPDF free | How PDFluffer gets it |
|---|---|---|---|
| Open several PDFs in tabs | Yes | Yes | We build the tab bar. One PDF.js viewer per tab |
| Reopen last session's files on start | Yes | Yes | We build. Section 5.3 |
| Smooth scroll, zoom, fit width, fit page, rotate view | Yes | Yes | PDF.js |
| Page thumbnails and outline sidebar | Yes | Yes | PDF.js |
| Search text in the document | Yes | Yes | PDF.js |
| Select and copy text | Yes | Yes | PDF.js |
| Fill AcroForm fields and save | Yes (see note 1) | Watermark on save | PDF.js |
| Form calculations (totals in tax-style forms) | Yes | Yes | PDF.js runs form scripts in a sandbox |
| Add text anywhere (fills flat forms) | Yes | Watermark on save | PDF.js |
| Add a signature: draw, type or image | Yes | Watermark on save | PDF.js |
| Saved signatures for reuse | Yes, needs sign-in to sync | Watermark on save | PDF.js, stored locally only |
| Print | Yes | Yes | PDF.js and the shell |
| Open password-protected PDFs | Yes | Yes | PDF.js |
| Save and Save As | Yes | Watermark on save | The shell's file adapter |
| Open by double-click, drag and drop, recent files | Yes | Yes | The shell |
| Remember page and zoom per file, dark mode, keyboard shortcuts | Partly | Partly | We build. Small |
| Show a badge on a digitally signed PDF, and warn before an edit that would break the signature | Yes | Yes | We build. Small. Section 5.2 explains why this is in version 1 |
| Open XFA forms where PDF.js can, with a clear banner where it cannot | Yes | Partly | PDF.js switch plus a banner. Small. Section 5.2 |

Note 1: Adobe lists fill and sign as free. A UPDF review claims the Chrome extension cannot
fill interactive fields. UPDF is a competitor, so I give Adobe's own listing more weight.

### 3.4 Should have (soon after version 1)

Useful to many people, and cheap because the engine already does most of it.

| Feature | Acrobat free | UPDF free | How PDFluffer gets it |
|---|---|---|---|
| Highlight, freehand ink | Yes | Watermark on save | PDF.js |
| Underline, strikeout, sticky notes | Yes | Watermark on save | We build on the PDF.js annotation layer. Medium |
| Insert an image or stamp | Yes | Watermark on save | PDF.js |
| Quick marks: tick, cross, dot, today's date, initials | Yes | Watermark on save | We build as preset stamps. Small |
| Reorder, delete, copy and extract pages | **Paid** | Watermark on save | PDF.js (added in Firefox 150, April 2026) |
| Rotate pages permanently | **Paid** | Watermark on save | pdf-lib |
| Merge several PDFs into one | **Paid** | Watermark on save | pdf-lib. PDF.js support is expected soon |
| Flatten (see below) | **Paid** | Watermark on save | pdf-lib |
| Copy or save an image out of a PDF | Yes | Yes | PDF.js (Firefox 150) |

**Flatten** means baking form values, signatures and notes into the page so nobody can
edit them later. It also makes the file look the same in every viewer. People want this
before they email a signed form.

### 3.5 Could have (later, only if you miss them)

| Feature | Acrobat free | UPDF free | Notes |
|---|---|---|---|
| OCR for scanned PDFs | Paid | 5 uses | **Undecided (decision 5).** OCR (optical character recognition) turns a scanned picture into selectable text. Fully local options exist. Section 5.2 shows where it plugs in |
| Compress a PDF | Paid | Watermark on save | Hard to do well in the browser. Defer |
| Images to PDF, pages to PNG or JPG | Paid | 2 a day | Easy with pdf-lib and PDF.js |
| Add or remove a password | Paid | Watermark on save | Needs an engine check. See risk 6 |
| Redaction | Paid | Watermark on save | True redaction removes content, not just covers it. PDF.js and pdf-lib cannot do it safely. Needs a second engine through the engine adapter (section 5.1) |
| Crop pages, headers, footers, watermarks | Paid | Limited | pdf-lib can do these |
| Keep a draft of unsaved edits so a restart brings them back | Yes | No | Extends session restore (section 5.3) |

### 3.6 Skip for now

The first three rows are **deferred, not rejected**. Section 5.2 shows how each one folds
in later.

| Feature | Why skip for now |
|---|---|
| Edit existing text and images (deferred) | This is the headline paid feature of both products and the hardest problem in the field. A PDF stores positioned glyphs, not paragraphs. Editing means rebuilding layout and fonts. Most real needs are met by "add text" plus a white cover box. For real rewrites, go back to the source document |
| Certificate-based digital signatures (deferred) | A **digital signature** uses a cryptographic certificate to prove who signed and that the file is unchanged. That is different from an **electronic signature**, which is an image of your signature on the page and is what version 1 does. You meet requests for digital signatures occasionally, and there is no example file yet |
| Full XFA support (deferred) | XFA is an older Adobe-only form format that Adobe itself has deprecated. Some government forms still use it. PDF.js can render and fill many of them, and version 1 turns that on. Forms that PDF.js cannot handle wait for an example file |
| Convert to Word, Excel, PowerPoint | Large, low quality without a commercial engine, rarely needed |
| Form designer, batch processing, Bates numbering, PDF/A, accessibility tagging, compare, measure tools | Professional and legal niches |
| AI summaries, cloud sync, share for review, request signatures | These are the features that bring accounts, servers and nags with them |

## 4. Design principles

1. **Local only.** No account, no telemetry, no update pings, no remote fonts. A strict
   content security policy blocks all network access from the core.
2. **Never damage the original.** The first save of an edited file prompts for Save or
   Save As. An option keeps a backup copy.
3. **Standard files.** Notes, signatures and form values are written as standard PDF
   objects. Other viewers can read them and keep editing them.
4. **Treat every PDF as untrusted.** Scripts inside a PDF run only in the PDF.js sandbox.
   Links open in the system browser after a confirmation.
5. **Signatures are sensitive.** Saved signatures stay on the machine and never sync.
   The desktop shell can encrypt them with the Windows user account.
6. **Small and fast.** It should open a PDF faster than Acrobat does, even when it
   restores ten tabs.
7. **Swappable parts.** The core depends on small interfaces, not on PDF.js or pdf-lib
   directly. Section 5.1 names them.

## 5. Architecture: one core, several shells

```
  +------------------------------------------------------------------+
  |  PDFluffer core  (React + TypeScript + Vite)                     |
  |                                                                  |
  |  App frame       tab bar, toolbar, settings, signature store     |
  |  Tool registry   each tool lists the capabilities it needs       |
  |  Document session (one per tab)                                  |
  |      owns the file bytes, the unsaved flag and the view state    |
  |         |                                  |                     |
  |  Viewer (replaceable)            Engine adapter (replaceable)    |
  |  PDF.js: render, text, search,   bytes in -> bytes out           |
  |  forms, notes, signatures        v1: pdf-lib                     |
  |                                  later: PDFium or MuPDF          |
  +-------------------------------+----------------------------------+
                                  |
            file adapter: open, save, save as, file references,
            session store, "the OS asked us to open this file"
                                  |
        +-------------------------+--------------------------+
        |                         |                          |
  Tauri 2 desktop app      Chrome + Edge extension      Plain web build
  (chosen, first)          (Manifest V3, second)        (development harness)
```

The **file adapter** is a small TypeScript interface. Each shell implements it. The core
never knows which shell it runs in. This is what lets one codebase serve every shell.

### 5.1 The three seams

These cost little on day one. Skipping them is what would force a refactor later.

**Seam 1 - the document session owns the bytes.** A document session is the object behind
one tab. It holds the file's bytes, the unsaved flag and the view state. The viewer only
displays. Every change to the file is "bytes in, bytes out". After an operation, the
session hands the new bytes to the viewer. Before an operation, the session asks the
viewer to write any pending form values and notes into the bytes first. The viewer sits
behind its own small interface (load, export bytes, get and set view state, events), so
even PDF.js could be replaced.

**Seam 2 - the engine adapter, with capability flags.** An engine adapter is a wrapper
around one PDF library. It states what it can do, and it runs operations. A sketch:

```ts
type Capability =
  | 'pages.merge' | 'pages.rotate' | 'flatten'
  | 'text.edit' | 'redact' | 'ocr'
  | 'sign.verify' | 'sign.certificate';

interface EngineAdapter {
  capabilities(): Set<Capability>;
  run(op: EngineOp, bytes: Uint8Array): Promise<EngineResult>;
}

// EngineResult carries the new bytes and the save mode: 'append' or 'rewrite'.
```

Several adapters can be registered at once. The session picks the first one that has the
capability. Version 1 has one adapter, around pdf-lib. A later adapter can wrap PDFium or
MuPDF as WebAssembly. In the Tauri shell it can also call a native library through a Tauri
command, which is a function the Rust host exposes to the web core.

**Seam 3 - the tool registry.** A tool is a toolbar button, an interaction mode on the
page, and a list of the capabilities it needs. The toolbar shows a tool only when some
adapter has those capabilities. Adding a feature later means adding one tool and perhaps
one adapter. The app frame, the tabs and the save path do not change.

One rule ties the seams together: **the save path has two modes.** Append mode adds an
incremental update to the end of the file and leaves the earlier bytes untouched. Rewrite
mode writes a whole new file. Every operation declares which mode it produces. This matters
for digitally signed files, as the next section shows.

### 5.2 How each deferred feature folds in

**Edit existing text.**
- What it needs: an engine that can read the text objects on a page and rewrite them.
  PDFium and MuPDF can. PDF.js and pdf-lib cannot.
- How it folds in: add an adapter with `text.edit`. Add an "Edit text" tool that asks the
  adapter for the text blocks on a page, overlays edit boxes, and sends the change back.
- What version 1 must do: seams 1 to 3. Nothing else.
- Helped by ruling 1: as a personal tool, MuPDF's AGPL licence is no obstacle.
- Honest limit: the seams remove the refactor cost, not the feature cost. Text editing
  stays a large feature. Fonts are the hard part. An embedded font often holds only the
  letters already used in the document, so new letters need a substitute font.

**XFA forms.**
- What it needs: PDF.js has an XFA switch. Version 1 turns it on.
- How it folds in: PDFluffer detects XFA when a file opens. It shows a banner that says
  support is partial. A form PDF.js cannot handle fails with a clear message, not a blank page.
- What version 1 must do: the switch, the detection and the banner. All small.
- When you meet a real XFA form, add it to the test files. Better support is then a
  viewer-side job. Nothing else moves.

**Certificate-based digital signatures.** There are two halves.
- Verify: read the signature, check the file hash and the certificate chain, show who
  signed and whether the file changed since. Capability `sign.verify`.
- Sign: add a signature field, compute the signature over the file's bytes with your
  certificate, and write it in append mode. Capability `sign.certificate`. The Tauri
  host can reach the Windows certificate store or a `.pfx` certificate file. JavaScript
  libraries for this also exist.
- What version 1 must do: two things, both small. First, the two-mode save path, because
  a digital signature must be the last write and must be append mode. Second, detect
  existing digital signatures on open, show a badge, and warn before any rewrite-mode
  operation, because a rewrite invalidates them. That is why the badge is in the Must list.

**OCR (undecided).**
- How it folds in: capability `ocr`. One adapter option is tesseract.js, which is OCR
  compiled to WebAssembly. Another is the OCR engine built into Windows, reached through
  a Tauri command. Either way the output is an invisible text layer over the scanned page.
- What version 1 must do: nothing.
- Suggested way to decide: use version 1 for a month and note each time a scanned PDF
  blocks you from copying text.

### 5.3 Session restore

Requirement ruled 2026-09-19: PDFluffer reopens the files that were open last time.

**What is stored.** The ordered list of tabs and the active tab. For each tab: a file
reference, the page, zoom, scroll position, rotation and sidebar state. Also the window
size and position.

**File reference** is the one new term. It is an opaque token that the file adapter can
turn back into a file. In the Tauri shell it is the full path. In the extension it is the
URL. In a plain web build it is a browser file handle kept in the browser's local database.

**Behaviour.**

1. PDFluffer writes the session after every change, with a short delay to batch writes.
   It does not wait for close. A crash or a forced shutdown loses nothing.
2. On start, the tab bar comes back at once. Only the active tab loads its document. Each
   other tab loads when you first click it. Start stays fast with many tabs.
3. If you double-click a PDF while PDFluffer is running, the file opens as a new tab in
   the running window. If it is already open, PDFluffer switches to that tab.
4. If a file has moved or been deleted, its tab stays and shows "File not found" with
   Locate and Close buttons. PDFluffer never drops a tab silently.
5. If a file changed on disk since last time, PDFluffer loads the new version and keeps
   your page if that page still exists.
6. PDFluffer never stores passwords. A protected file asks for its password again.
7. If a tab has unsaved edits when you close, version 1 asks Save, Discard or Cancel.
   Keeping a draft so that restart brings back unsaved work is on the Could list.
8. A setting turns session restore off. A "Clear history" command wipes the session and
   the recent files list. Both lists are local only.

**Per shell.** In Tauri, the session is a small JSON file in the app data folder, and
Tauri's single-instance and window-state plugins cover items 3 and the window geometry. In
the extension, PDFs open in browser tabs, so the browser's own "continue where you left
off" setting restores them. PDFluffer adds the page and zoom per URL.

"Remember page and zoom per file" from the Must list uses the same store, keyed by file
reference, so a file you closed and reopen later also returns to your page.

## 6. PDF engine options

The engine is the most important choice. It decides what is free to build and what is not.

| Option | What it is | Licence | Strengths | Weaknesses |
|---|---|---|---|---|
| **A. PDF.js + pdf-lib** (chosen for version 1) | PDF.js is Mozilla's engine, used by Firefox. pdf-lib is a pure JavaScript library that writes PDFs | Apache 2.0 and MIT. No conditions that matter | Covers every Must item today. Huge user base, so bugs get found. Signature and page tools already built | Two libraries write files, so save paths need care (risk 2). The original pdf-lib is unmaintained. Use the maintained fork `@cantoo/pdf-lib` |
| **B. PDFium via WebAssembly (EmbedPDF)** | PDFium is the engine inside Chrome. EmbedPDF wraps it for React | Apache 2.0 and MIT | Renders exactly like Chrome. Has true redaction. Can edit page text objects | Form filling and signatures are outside EmbedPDF's current scope. Version 3 is marked not production-ready |
| **C. MuPDF.js** | Artifex's engine compiled to WebAssembly | **AGPL** or a paid commercial licence | The most complete single engine: render, forms, notes, redaction, text editing, incremental save | AGPL means any version you distribute must be open source under AGPL. Ruling 1 (personal tool) removes this obstacle, as long as PDFluffer is never distributed |
| **D. Native libraries** | PDFium bindings for Rust or .NET, or Apache PDFBox for Java | Apache 2.0 | Reachable from the Tauri host through a Tauri command | As a whole-app engine they give rendering and a file model only. You would hand-build text selection, the form layer and the tools |

**Decision: option A for version 1.** It is the only option where the features you asked
for already exist. Options B, C and D are no longer rivals. Through the engine adapter
(section 5.1) they become **later additions** for the jobs option A cannot do: text
editing, true redaction and certificate signing.

## 7. Shell options

Effort is relative: S is days, M is a week or two, L is a month or more.

| Option | What it is | Effort | For | Against |
|---|---|---|---|---|
| **1. Tauri 2 desktop app** (**chosen**, ruling 2) | A small Rust host that shows the core in WebView2, the Edge engine that ships with Windows 11 | M | Installer of about 5-15 MB. True file association, single instance, native dialogs, built-in installer. Full file paths make session restore simple. The Rust host is a home for native engines later. Also builds for Mac and Linux | You need the Rust toolchain and the Microsoft C++ build tools installed. You write very little Rust, but it is one more language in the project |
| **2. Browser extension for Chrome and Edge** (**chosen**, ruling 6) | One Manifest V3 extension that opens PDFs in the core instead of the built-in viewer. Edge runs Chrome extensions, so one build covers both | S to M, after the core exists | Replaces the Acrobat extension directly. For personal use you load it unpacked, with no store listing | The user must tick "Allow access to file URLs" before an extension can open local files. It catches PDF links by redirecting them, so a few embedded or form-posted PDFs fall through to the built-in viewer. See also risk 8 |
| 3. Installable web app (PWA) | The core served as a static site and installed from Edge or Chrome | S | Zero extra code | No longer needed as a product. The plain web build stays as the development harness only. The browser hides file paths, so session restore needs a permission click each start |
| 4. WPF + WebView2 host | A small .NET window hosting the same core | M | All host code in C# | Not chosen. Windows only, and you would write the installer, file association and single-instance code yourself |
| 5. Electron | A desktop host that bundles its own copy of Chromium | M | All JavaScript | Not chosen. 100 MB or more per install and high memory use. It solves a cross-platform consistency problem you do not have |
| 6. Fully native WPF or Swing | No web view. Engine option D | L | One language | Not chosen. You rebuild what PDF.js gives you for free |

### Path

1. **Core and Tauri 2 together, from the first spike.** Draft 1 put a PWA first. With
   Tauri chosen, that step is wasted work. Day-to-day development still runs the core in
   a normal browser tab through the Vite development server, because that is the fastest
   edit-and-see loop.
2. **Extension for Chrome and Edge next.** It reuses the core and needs only its own
   file adapter.

## 8. No new browser needed

Ruled by the user 2026-09-19: no extra browser gets installed. Each browser brings its own
set of favourites, and that makes favourites hard to find. So this document never asks
for one.

Nothing in the path needs a new browser:

- The desktop shell uses WebView2, the Edge engine that is already part of Windows 11.
  WebView2 is only a rendering engine. It has no favourites, no profile and no toolbar.
- The extension targets the Chrome and Edge you already have.

Firefox still matters in one way, as **evidence**. Its built-in PDF viewer is PDF.js with
Mozilla's toolbar. It fills forms, adds saved signatures and reorders pages. That shows the
engine can do the job. PDFluffer bundles the same engine, so you never install Firefox.

A stopgap that needs no install: remove the Acrobat extension. Chrome then falls back to
its own built-in viewer, which reads, copies text and fills standard form fields with no
nags. It has no saved-signature tool, and that gap is what PDFluffer closes.

Other free desktop tools, for reference only: SumatraPDF (very fast, read-only), Okular
(open source, forms and notes, has a Windows build), PDFgear (free today, closed source,
business model unclear).

## 9. Phases

| Phase | Content | Size |
|---|---|---|
| 0. Spike | Tauri 2 + React + the PDF.js viewer. Open a real form, fill it, sign it, save it, print it. Check the saved file in Acrobat, Chrome and Edge. Settle risks 1, 2 and 9 | S |
| 1. Must list, in Tauri | Document session (seam 1), file adapter, tabs, session restore, single instance, file association, installer, signed-file badge and guard, XFA switch and banner, recent files, per-file memory, dark mode, shortcuts | M |
| 2. Should list | Engine adapter (seam 2) around pdf-lib, tool registry (seam 3), two-mode save path, quick marks, extra note types, merge, rotate, flatten | M |
| 3. Extension | Manifest V3 wrapper for Chrome and Edge, with its own file adapter | S to M |
| 4. Later | Could list items you find you miss. Deferred features from section 5.2 when a real need or an example file turns up | Per item |

## 10. Decisions, risks and open questions

### Decisions ruled 2026-09-19

| # | Question | Ruling | What follows |
|---|---|---|---|
| 1 | Personal tool, or shared? | **Personal tool** | Any licence works, including AGPL engines, as long as PDFluffer is never distributed. No code-signing certificate. Windows SmartScreen may warn once when you run your own installer. No updater. The extension loads unpacked |
| 2 | Desktop shell | **Tauri 2** | Section 7. Needs the Rust toolchain and the Microsoft C++ build tools |
| 3 | Skip "edit existing text"? | **Yes, but the design must permit adding it later without much friction** | Seams 1 to 3 (section 5.1). Fold-in path in section 5.2 |
| 4 | XFA forms or certificate-based signatures? | **Occasionally. No example file yet. Must fold in later without a big refactor** | XFA switch and banner in version 1. Two-mode save path and signed-file guard in version 1. Fold-in paths in section 5.2 |
| 5 | Copy text from scanned PDFs (OCR)? | **Yes**, ruled 2026-09-21 after desktop version 1 was finished | Spec section 20, with Windows' built-in OCR. It plugs into the `ocr` capability as section 5.2 planned, with no refactor |
| 6 | Which browsers for the extension? | **Chrome and Edge** | One Manifest V3 build covers both |
| 7 | New requirement | **Persist the open files when the tool reopens** | Section 5.3. In the Must list |
| 8 | New constraint | **No new browser to install** | Section 8 |
| 9 | What does Ctrl+S do to the original? | **Ask once per file, then overwrite** | Spec 12.3. A backup-on-first-overwrite setting stays available |
| 10 | Toolbar look in version 1 | **Keep PDF.js's own toolbar**, with its Open and Download buttons hidden | Settles risk 1 as approach (a). A custom toolbar can come later behind the viewer interface |
| 11 | Spec scope | **Desktop app only** (phases 0 to 2). The extension gets its own spec later | `pdfluffer-spec.md` |
| 12 | Who installs the toolchain? | **The user**, never the builder | Corrected the same day after an audit of the code folder: nothing needs installing. Rust 1.98 is present at `%USERPROFILE%\.cargo\bin`, off the PATH by this machine's convention. Node 20.20.2 is enough once Vitest is held at 4.1, the version the sibling apps use. A machine-wide move to Node 24 LTS is safe and separate |

Two items from the Should list moved out of the first spec: quick marks, and underline,
strikeout and sticky notes. Both need deep PDF.js internals, which is where a less capable
builder would go wrong. They get their own spec once version 1 is in daily use.

### Risks

1. **How to reuse the PDF.js viewer.** Mozilla ships two things. The first is a set of
   viewer components on npm (`pdfjs-dist`). The second is the full viewer app with its
   toolbars, including the signature dialog. The toolbars live in the app, not in the
   components. So there are two approaches. (a) Host the full viewer app, one per tab, and
   restyle it. This is fast and gets every tool on day one. (b) Build our own React
   toolbars on the components. This gives full control and costs more. The spike should
   try (a) first. The cost of (a) is merge work each time PDF.js is upgraded. Either way
   the viewer sits behind the viewer interface from seam 1, so the choice can change later.
2. **Two libraries write files.** PDF.js saves form values and notes in append mode.
   pdf-lib saves in rewrite mode. Rule: one writer per operation. PDF.js writes fills,
   notes and signatures. pdf-lib writes page jobs and flatten. The two-mode save path in
   section 5.1 makes this rule explicit in code.
3. **Filled values must show in every viewer.** That needs correct appearance streams,
   which are the drawing instructions stored beside a field's value. Text outside Latin
   scripts also needs an embedded font. The spike's round-trip check covers this.
4. **Default app on Windows.** Windows does not let an app make itself the default. You
   choose PDFluffer once in Settings.
5. **Extension limits.** See option 2 in section 7. Also note the official PDF.js Chrome
   extension sends a small telemetry ping. PDFluffer's extension would not.
6. **Password-protected files and pdf-lib.** PDF.js opens them. The original pdf-lib
   cannot load them. I could not confirm whether the `@cantoo/pdf-lib` fork can. Check in
   the spike before promising page jobs on protected files.
7. **Upstream change.** PDF.js moves quickly. Pin the version and upgrade on purpose.
8. **Unpacked extensions may nag.** Chrome and Edge can show a developer-mode warning at
   start-up when an unpacked extension is loaded. That would be an ironic result for this
   project. Check it in phase 3. The fallback is an unlisted store listing. Chrome charges
   a small one-off developer fee. Edge charges nothing.
9. **Printing and WebAssembly inside WebView2.** PDF.js prints through the browser's
   print dialog, and it uses WebAssembly for some image formats and for its script
   sandbox. Both should work in WebView2 because it is the Edge engine. The spike confirms
   both, and sets the content security policy to allow WebAssembly and nothing remote.
10. **Personal files in the test set.** Your real forms make the best test files, and they
    hold personal data. Keep them in a folder that git ignores, so they never reach a
    remote repository.

### Still open

1. **OCR (decision 5).** Suggested: decide after a month of daily use.
2. **Example files.** When you next meet an XFA form or a request for a certificate-based
   signature, keep a copy. That file starts the fold-in work in section 5.2.

## 11. Sources

- Adobe Acrobat Chrome extension listing: https://chromewebstore.google.com/detail/adobe-acrobat-pdf-edit-co/efaidnbmnnnibpcajpcglclefindmkaj
- Adobe help, Acrobat Chrome extension: https://helpx.adobe.com/acrobat/kb/get-acrobat-reader-extension-for-chrome-a.html
- UPDF's review of the Acrobat extension (competitor source): https://updf.com/knowledge/adobe-acrobat-chrome-extension/
- UPDF pricing: https://updf.com/pricing/
- UPDF FAQ, free version limits: https://updf.com/updf-faqs/
- Firefox Help, view and edit PDFs: https://support.mozilla.org/en-US/kb/view-pdf-files-firefox-or-choose-another-viewer
- PCWorld, Firefox 150 PDF page editing: https://www.pcworld.com/article/3121683/firefox-150-turns-its-pdf-viewer-into-a-real-pdf-editor.html
- Nutrient, the PDF.js annotation editor layer: https://www.nutrient.io/blog/pdfjs-annotation-editor-layer/
- PDF.js Chrome extension wiki: https://github.com/mozilla/pdf.js/wiki/PDF-Viewer-(Chrome-extension)
- `@cantoo/pdf-lib`: https://www.npmjs.com/package/@cantoo/pdf-lib
- EmbedPDF: https://github.com/embedpdf/embed-pdf-viewer
- MuPDF.js and its licence: https://github.com/ArtifexSoftware/mupdf.js/
- Tauri and Electron compared: https://www.pkgpulse.com/guides/electron-vs-tauri-2026
