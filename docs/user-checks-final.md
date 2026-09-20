# PDFluffer - the final check list

The build is finished. These checks need a person at the real app, so they are yours.
Work through them in order. The most important ones come first, so a serious problem
shows up early.

For each check, write **pass**, or **fail** with what you saw. The table at the end is
there to fill in.

Plan items P1.20, P2.10 and P2.11 are ticked when these pass.

## Before you start

1. Open PowerShell in `C:\Users\nick2\Code\pdfluffer`.
2. Make a test folder and copy the sample files into it. These checks change files, so
   never use the originals in `samples\`, and never use `samples-private\`.

   ```powershell
   New-Item -ItemType Directory -Force "$env:USERPROFILE\Documents\pdfluffer-test"
   Copy-Item samples\*.pdf "$env:USERPROFILE\Documents\pdfluffer-test"
   ```

3. Wherever a check says "the test folder", it means `Documents\pdfluffer-test`.

**Starting the dev app.** Some checks say "start the dev app". Run this line. The first
start compiles Rust and can take a few minutes. Close the window to stop it.

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"; npm.cmd run tauri dev
```

**Rebuilding the installer**, if you ever need to:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"; npm.cmd run tauri build
```

**Developer tools.** In the dev app, press Ctrl+Shift+I, or right-click an empty part of
the tab bar and choose Inspect. The Console tab lists errors in red.

**The menu** is the three lines at the right of the tab bar.

---

## F1 - the installer runs, and the app starts

The builder already built it. It is at
`src-tauri\target\release\bundle\nsis\PDFluffer_0.1.0_x64-setup.exe`.

1. Close the dev app if it is running.
2. Double-click the installer and follow its steps.
3. Start PDFluffer from the Start menu.

**Expect:** it installs with no administrator (UAC) prompt, and the window opens.

Windows SmartScreen may warn that the app is unrecognised, because it is not code signed.
That is expected. Choose "More info", then "Run anyway".

**If it fails:** report the prompt or the error, and whether the app appears in the Start
menu at all. Everything below needs this check to pass.

## F2 - open, fill, save, reopen

This is the core of the app. **The builder ran this on 2026-09-21 in the dev app and it
passed.** Run it once more in the installed app, on your own files if you like.

1. Click **+**. The Windows Open dialog appears and shows only PDF files.
2. Open `form-basic.pdf` from the test folder.
3. Fill every field. Within about a second the tab shows an orange dot, and the window
   title ends in ` *`.
4. Press Ctrl+S. "Save changes to form-basic.pdf?" appears. Choose **Overwrite**. The dot
   clears.
5. Change a field and press Ctrl+S again. No dialog. The dot clears.
6. Close the tab, then open the same file again.

**Expect:** the file holds every value you typed.

**If it fails:** report the step number, and whether the file on disk was damaged.

## F3 - double-click a PDF, and only one window

1. Open Windows Settings, then Apps, then Default apps. Search for `.pdf` and choose
   **PDFluffer**.
2. Close PDFluffer. In Explorer, double-click `form-basic.pdf` in the test folder.
3. PDFluffer starts with that file open. Minimise it.
4. Double-click `three-pages.pdf` in Explorer.

**Expect:** after step 4 there is still only one PDFluffer window. It comes to the front,
un-minimised, with `three-pages.pdf` in a new, active tab.

**If it fails:** report whether a second window opened, whether the file opened at all,
and whether the window came forward.

To put your old PDF app back afterwards, repeat step 1 and choose it.

## F4 - the app reopens what you had

1. Open three files: `form-basic.pdf`, `flat-form.pdf` and `three-pages.pdf`.
2. Make `three-pages.pdf` active. Scroll to page 3 and zoom to 150%.
3. Close the window with the X button.
4. Start PDFluffer again.

**Expect:** the three tabs return in the same order. `three-pages.pdf` is active, on page
3, at 150%.

**If it fails:** report which part differed. If you would rather the app did not reopen
files, the Settings dialog has a switch for it.

## F5 - closing with unsaved changes

PDF.js must not add its own "Leave site?" prompt on top of PDFluffer's.

1. Open `form-basic.pdf` and change a field. Do not save.
2. Close the window with the X button. "Save changes to form-basic.pdf?" appears.
3. Choose **Cancel**. The window stays open and your change is still there.
4. Close it again and choose **Discard**.

**Expect:** the window closes at step 4. No "Leave site?" or "Changes you made may not be
saved" prompt appears at any point. Start the app again: the tab returns without the
discarded change.

5. Repeat steps 1 and 2 and choose **Save**, then **Overwrite**. The window closes and
   the file holds the change.

**If it fails:** report the exact words of any extra prompt.

## F6 - a half-typed note is not lost

PDF.js holds a text box that is still being typed outside its own change list, so the tab
shows no dot yet. PDFluffer commits that work before it acts on a close or a save.

1. Open `three-pages.pdf`.
2. Choose PDF.js's text tool (the **T** in the toolbar inside the page), click the page
   and type `Check six`. Do not click away. The tab shows no dot. That is expected.
3. Press Ctrl+W.

**Expect:** "Save changes to three-pages.pdf?" appears. Choose **Cancel**: the tab stays
open, your text is on the page, and the dot now shows.

4. Repeat with the draw tool: draw one stroke and press Ctrl+W without clicking anywhere
   else. The same dialog must appear.
5. Press Ctrl+W again and choose **Discard**.

**If it fails:** if the tab closed with no dialog, say so. That loses the text, and it is
the worst kind of failure.

## F7 - signatures

1. Open `flat-form.pdf`.
2. In the toolbar inside the page, choose the signature tool, then **Add new signature**.
3. Type a name on the **Type** tab, leave "Save signature" ticked, and choose **Add**.
4. Drag the signature where you want it, then click elsewhere to place it.
5. Press Ctrl+S and choose **Overwrite**.
6. Close the tab, open the file again, and place the saved signature a second time.
   Save again.

**Expect:** both signatures are in the file, in the right places, and the saved signature
is still offered the next time.

**If it fails:** report which step, and whether the signature moved or changed size.

## F8 - the saved file in other viewers

1. Open the `form-basic.pdf` you saved in F2, and the `flat-form.pdf` from F7, in Acrobat
   Reader, then in Chrome, then in Edge. To open one in a browser, drag it onto an empty
   browser tab.

**Expect:** all three show your filled values and your signatures.

**If it fails:** report which viewer, and which values or marks are wrong or missing.

## F9 - printing

1. Open `three-pages.pdf`.
2. Print it three ways: the menu's **Print...**, PDF.js's own print button inside the
   page, and Ctrl+P.

**Expect:** the Windows print dialog appears each time, and its preview shows the three
pages correctly. You do not need to print.

**If it fails:** report which of the three ways failed.

## F10 - reordering pages by dragging a thumbnail

1. Open `three-pages.pdf`.
2. Open PDF.js's sidebar, the button at the top left of the page area, to show the page
   thumbnails.
3. Drag the thumbnail of page 3 above page 1.

**Expect:** the page order changes and the tab shows the orange dot.

**If it fails:** report it, and do nothing else. The spec has a rule for this case: drag
and drop to open files (F11) gets turned off instead. That change is the builder's, not
yours.

## F11 - drag a PDF onto the window

1. Have at least one tab open.
2. Drag `flat-form.pdf` from the test folder in Explorer onto the PDFluffer window.
3. Drag a non-PDF file, a `.txt` for example, onto the window.

**Expect:** the PDF opens in a new tab, or its existing tab becomes active. The non-PDF
file does nothing.

**If it fails:** report what happened, including anything that looked like a crash.

## F12 - a file another program is holding

1. Open `form-basic.pdf` from the test folder in PDFluffer and change a field.
2. Open the same file in Acrobat Reader and leave it open.
3. In PDFluffer, press Ctrl+S, and choose Overwrite if asked.

**Expect:** "Could not save" appears, saying "Another program has this file open. Close it
there, or use Save As." The tab keeps its orange dot. Close Acrobat: the file still opens
correctly there.

Acrobat Reader does not always lock a file. If the save simply works, say so. That is not
a PDFluffer failure, but it is worth knowing.

**If it fails:** report the message you got, and whether the file was damaged.

## F13 - a file that moved, and Locate

1. Open `flat-form.pdf` from the test folder. Close the window.
2. In Explorer, rename `flat-form.pdf` to `flat-form-moved.pdf`.
3. Start PDFluffer and click the `flat-form.pdf` tab.

**Expect:** the tab shows "File not found" with the old path. Click **Locate...**, choose
`flat-form-moved.pdf`, and the file opens in that tab under its new name.

**If it fails:** report what the tab showed.

## F14 - copy and paste text

The builder's browser tool could not select text, so nobody has run this yet.

1. Open `three-pages.pdf`.
2. Click on the page. Press Ctrl+F, type `Page 2` and press Enter. The view moves to page
   2.
3. Drag across the words "Page 2" to select them. Press Ctrl+C.
4. Open Notepad and press Ctrl+V.

**Expect:** the search moves to page 2, and Notepad shows "Page 2".

**If it fails:** report what was pasted, or that nothing was.

## F15 - the Document tools

These are phase 2. The builder checked all of them in a browser on 2026-09-21. This check
is about the real app and real files.

1. Open `three-pages.pdf`. In the menu, under **Document**, choose **Insert PDF at
   end...** and pick `form-basic.pdf`. The document becomes four pages and the tab goes
   dirty.
2. Choose **Rotate all pages right**. Every page turns.
3. Go to page 2 and choose **Rotate this page right**. Only page 2 turns again.
4. Choose **Revert to saved** and confirm. The document goes back to three pages, upright,
   and the tab goes clean.
5. Open the Settings dialog from the menu and tick **Keep a backup of the original the
   first time I overwrite it**. Close it.
6. Repeat step 1, then press Ctrl+S and choose **Overwrite**.
7. Look in the test folder.

**Expect:** after step 6 the folder holds `three-pages.pdf` with four pages, and a new
`three-pages.backup.pdf` with the original three. The backup is made once only: save
again and it does not change.

**If it fails:** report which step, and whether the original file survived.

## F16 - flattening a signed form

1. Open `form-basic.pdf` from the test folder. Fill a field, add a note with the text
   tool, and place a signature as in F7. Do not save yet.
2. In the menu, under **Document**, choose **Flatten...**. Read the warning and choose
   **Flatten**.
3. Look at the page. Everything should sit exactly where it was, but nothing can be
   clicked, selected or edited any more.
4. Press Ctrl+S and choose **Overwrite**.
5. Open the saved file in Acrobat Reader, then Chrome, then Edge.

**Expect:** all three viewers show the same page you saw in step 3: the filled value, the
note and the signature, in the same places, at the same sizes, and no longer editable.

**If it fails:** report which viewer, and what moved, resized, vanished or is still
editable. A screenshot helps most here.

## F17 - no errors in the console

A CSP, or content security policy, is the rule set that stops the app loading anything
from outside. A CSP error means something tried.

1. Start the **dev app** (the command is at the top of this page), and open the developer
   tools on the Console tab.
2. Open `form-basic.pdf`, fill a field, place a signature, save, run one Document tool,
   revert, and open the print dialog, then cancel it.

**Expect:** no line containing "Content Security Policy" or "CSP", and no red error you
cannot explain.

Two warnings are known and harmless: `No available adapters.` from a WebGPU probe, and
lines about `Leave site?` during a reload.

**If it fails:** copy each unexpected line into your report.

## F18 - how it looks and feels

This one has no right answer. It is your app, so say what you think.

Spend ten minutes using it the way you normally read and fill PDFs, then answer:

- The **tab bar**: are the tabs the right size? Is the orange dot clear enough? Is the
  Signed chip clear?
- The **menu**: is anything in the wrong place, or missing? Is the Document list clear?
- The **dialogs**: is any wording confusing or alarming? Does any of them nag?
- **Dark mode**: switch Windows between light and dark. Does the app follow, and does the
  page area still look right?
- **Speed**: does anything feel slow? Opening a big file, switching tabs, saving?
- Anything that made you hesitate, or that you had to look twice at.

**Report:** a list, roughly in the order that bothers you most. Small wording changes are
cheap, so do not hold any back.

---

## Results

| Check | What it covers | Pass or fail | Notes |
|---|---|---|---|
| F1 | Installer and first start | | |
| F2 | Open, fill, save, reopen | | |
| F3 | Double-click and single window | | |
| F4 | Reopening your tabs | | |
| F5 | Closing with unsaved changes | | |
| F6 | A half-typed note is not lost | | |
| F7 | Signatures | | |
| F8 | Saved file in other viewers | | |
| F9 | Printing | | |
| F10 | Reordering pages by dragging | | |
| F11 | Dragging a PDF onto the window | | |
| F12 | A file another program holds | | |
| F13 | A file that moved, and Locate | | |
| F14 | Copy and paste text | | |
| F15 | The Document tools and the backup | | |
| F16 | Flattening a signed form | | |
| F17 | No errors in the console | | |
| F18 | How it looks and feels | | |
