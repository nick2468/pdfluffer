# PDFluffer - the final check list

> **STATUS, 2026-09-21: every check in this file has passed. Nothing here is open.**
> The user ran F1, F3, F7 to F11, F14, F15 (insert), F16, F18, F19 and F20 in the installed
> app. Automation proved F2, F4, F5, F15 (rotate, revert, backup) and F17 in the production
> build. F6, F12 and F13 are covered by tests and the builder's browser checks. The
> **Results table at the end is the record.** The "What is left for you" column below, and
> notes such as "nobody has run this yet", describe the day the list was written. Do not
> raise them again. New checks for later phases go in their own file.

The build is finished. On 2026-09-21 the orchestrator ran an automated test against the
**production build** (the same program the installer ships) and 24 of 24 checks passed.
That removed about half of this list. What is left needs a person at the real app.

**Do every check in the installed app**, not the dev app, unless a check says otherwise.
The installed app is the one with the production security rules switched on.

For each check, write **pass**, or **fail** with what you saw. The table at the end is
there to fill in. Plan items P1.20, P2.10 and P2.11 are ticked when these pass.

## What is already proven, and what is yours

| Check | Status | What is left for you |
|---|---|---|
| F1 Installer and first start | Part proven: the app starts from its built-in files | **Yours:** run the installer |
| F2 Open, fill, save, reopen | **Proven** in the production build. You also ran it in the dev app on 2026-09-21 | Nothing. Skip it |
| F3 Double-click and single window | Part proven: a PDF passed at launch opens, a second launch joins the running window, an already-open file switches to its tab | **Yours:** the Windows default-app setting, and the window coming to the front |
| F4 Reopening your tabs | **Proven**: tabs, active tab, page and zoom, and tabs load only when clicked | Nothing. Skip it |
| F5 Closing with unsaved changes | **Proven**: Cancel keeps the window, Discard closes it, no "Leave site?" prompt | Nothing. Skip it |
| F6 A half-typed note is not lost | Proven by the builder with real typing in a browser. The logic is the same in the app | Optional |
| F7 Signatures | Not proven in the app | **Yours.** A core feature |
| F8 Saved file in other viewers | Cannot be automated | **Yours** |
| F9 Printing | Cannot be automated | **Yours** |
| F10 Reordering pages by dragging | Cannot be automated | **Yours** |
| F11 Dragging a PDF onto the window | Cannot be automated | **Yours** |
| F12 A file another program holds | Proven in Rust tests with a really locked file | Optional |
| F13 A file that moved, and Locate | Proven in unit tests and in a browser | Optional |
| F14 Copy and paste text | **Nobody has run this yet** | **Yours.** A core feature |
| F15 Document tools and backup | **Proven**: Rotate, Revert and the backup setting in the production build, and inserting a PDF by the user in the installed app, 2026-09-21 | Nothing. Done |
| F16 Flattening a signed form | The builder compared before and after in PDF.js. Other viewers cannot be automated | **Yours** |
| F17 No security-policy errors | **Proven** in the production build: none, across open, fill, save, tools, revert and close | Nothing, if F7 and F9 pass in the installed app |
| F18 How it looks and feels | Only you can judge | **Yours.** The most useful one |
| F19 Renaming a saved signature | New on 2026-09-21. The builder ran it in a browser | **Yours** in the installed app |
| F20 Flattening, with the word explained | Same as F16 | **Yours** |

**The short list, about 25 minutes: F1, F3, F7, F8, F9, F10, F11, F14, F16, F18.**

**Since your first pass, two more: F19 and F20, near the end. About five minutes.**

To rerun the automated test yourself at any time, close PDFluffer and run
`npm.cmd run smoke:prod`. It takes about a minute, opens and closes the app a few times,
and puts your saved tabs and recent list back exactly as they were.

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

This is the core of the app. **Already proven, so you can skip it.** You ran it in the dev
app on 2026-09-21, and the automated test ran it in the production build the same day. The
steps stay here in case you want to try it on your own files.

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

*Part proven by the automated test: a PDF passed at launch opens, and a second launch joins the running window. What only you can check is that Windows hands the file to PDFluffer on a double-click, and that the window comes to the front.*

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

*Already proven in the production build, so you can skip it. The steps stay for reference.*

1. Open three files: `form-basic.pdf`, `flat-form.pdf` and `three-pages.pdf`.
2. Make `three-pages.pdf` active. Scroll to page 3 and zoom to 150%.
3. Close the window with the X button.
4. Start PDFluffer again.

**Expect:** the three tabs return in the same order. `three-pages.pdf` is active, on page
3, at 150%.

**If it fails:** report which part differed. If you would rather the app did not reopen
files, the Settings dialog has a switch for it.

## F5 - closing with unsaved changes

*Already proven in the production build, so you can skip it. The steps stay for reference.*

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

*Optional. The builder proved it with real typing in a browser, and the app uses the same code.*

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

*Optional. The Rust tests prove it against a really locked file.*

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

*Optional. Proven in unit tests and in a browser.*

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

*Done. Nothing is left here. Rotate, Revert and the whole backup setting are proven in the
production build, and the user ran **Insert PDF at end...** in the installed app on
2026-09-21 and it passed. The steps stay for reference.*

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

## F17 - no security-policy errors

A CSP, or content security policy, is the rule set that stops the app loading anything
from outside. A CSP error means something tried, or that the rules block part of the app.

**Already proven, so there is nothing to do here.** The production rules apply only in the
built app, not in the dev app, so the dev app's console cannot answer this. The automated
test watched the production build's console through open, fill, save, a Document tool,
revert and close, and saw no CSP error and no other error.

Two things it did not exercise are placing a signature and printing. If **F7** and **F9**
pass in the **installed** app, those are covered too, because a blocked feature shows up
as a feature that does not work.

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

## After chip 10 - two checks

Two small things changed on 2026-09-21, after your first pass. Please check both in the
**installed** app.

### F19 - rename a saved signature

PDF.js names a saved signature when you create it and never again. Its own **Edit
description** changes only the copy sitting in the document, which is what you found. The
menu now has a way to rename the saved one.

1. Open any PDF. Use the signature tool to create a signature, leave "Save signature"
   ticked, and place it.
2. Open the menu and choose **Saved signatures...**. Your signature is listed by its name.
3. Type a new name in the box and choose **Rename**, or press Enter. Close the dialog.
4. Open the signature tool again in the **same** tab, without restarting anything. The
   button should show the new name.
5. Close PDFluffer, start it again, open a PDF, and look at the signature tool once more.

**Expect:** the new name in step 4 and again in step 5. The signature you already placed
in step 1 keeps its own old text, and that is meant to happen: renaming the saved one
never reaches into a document you have already signed.

**If it fails:** say which step, what the button said, and what you typed.

### F20 - flattening a signed form, now that the word is explained

Flatten means: make everything you have filled in, written or signed a permanent part of
the page, so nobody can edit, move or remove it afterwards, including you. It is what you
do to a signed form before you send it. The dialog now says this in the app.

Run **F16** above, exactly as it is written. Its steps have not changed.

**Expect:** what F16 says to expect.

**If it fails:** what F16 says to report.

## Results

| Check | What it covers | Pass or fail | Notes |
|---|---|---|---|
| F1 | Installer and first start | pass | User, 2026-09-21 |
| F2 | Open, fill, save, reopen | pass | Proven by automation, 2026-09-21 |
| F3 | Double-click and single window | pass | User, 2026-09-21 |
| F4 | Reopening your tabs | pass | Proven by automation, 2026-09-21 |
| F5 | Closing with unsaved changes | pass | Proven by automation, 2026-09-21 |
| F6 | A half-typed note is not lost | | |
| F7 | Signatures | pass | User, 2026-09-21. One request: a saved signature cannot be renamed. Fix chip 10 |
| F8 | Saved file in other viewers | pass | User, 2026-09-21 |
| F9 | Printing | pass | User, 2026-09-21 |
| F10 | Reordering pages by dragging | pass | User, 2026-09-21. So `dragDropEnabled` stays true and the U4 decision rule is not needed |
| F11 | Dragging a PDF onto the window | pass | User, 2026-09-21 |
| F12 | A file another program holds | | |
| F13 | A file that moved, and Locate | | |
| F14 | Copy and paste text | pass | User, 2026-09-21 |
| F15 | The Document tools and the backup | pass | Backup proven by automation. Inserting a PDF passed in the installed app: user, 2026-09-21 |
| F16 | Flattening a signed form | pass | User, 2026-09-21, as F20 after the wording was explained |
| F17 | No security-policy errors | pass | Proven by automation, 2026-09-21 |
| F18 | How it looks and feels | no issues raised | User, 2026-09-21: "All are working" |
| F19 | Renaming a saved signature | pass | User, 2026-09-21 |
| F20 | Flattening, with the word explained | pass | User, 2026-09-21. Same steps as F16 |
