# PDFluffer - user checks for phase 1

These checks need a person at the real app. The builder could not do them. Work through
them in order. For each one, report **pass**, or **fail** with what you saw.

Plan item P1.20 is ticked only when all of them pass.

## Before you start

1. Open PowerShell in `C:\Users\nick2\Code\pdfluffer`.
2. Make a test folder and copy the sample files into it. The checks change files, so never
   use the originals in `samples\`, and never use `samples-private\`.

   ```powershell
   New-Item -ItemType Directory -Force "$env:USERPROFILE\Documents\pdfluffer-test"
   Copy-Item samples\*.pdf "$env:USERPROFILE\Documents\pdfluffer-test"
   ```

3. Every check below says "the test folder". It means
   `Documents\pdfluffer-test`.

**Starting the desktop app.** Several checks say "start the dev app". Run this line in
PowerShell. The first start compiles Rust and can take a few minutes. The window opens
when it is ready. Close the window to stop it.

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"; npm.cmd run tauri dev
```

**Developer tools.** In the dev app, press Ctrl+Shift+I, or right-click an empty part of
the tab bar and choose Inspect. The Console tab lists errors in red.

## H9 - copy and paste, in the browser harness

The builder checked search. Its browser tool could not select or copy text.

1. Run `npm.cmd run dev` and open `http://localhost:1420` in Chrome or Edge.
2. Click **+** and open `three-pages.pdf` from the test folder.
3. Click on the page. Press Ctrl+F, type `Page 2` and press Enter. The view moves to
   page 2.
4. Drag across the words "Page 2". Press Ctrl+C.
5. Open Notepad and press Ctrl+V.

**Expected:** Notepad shows "Page 2". **If not,** report what was pasted, or that
nothing was.

Stop the harness with Ctrl+C in PowerShell when you are done.

## U1 - the dev app works on real files

1. Start the dev app.
2. Click **+**. The Windows Open dialog appears and shows only PDF files.
3. Open `form-basic.pdf` from the test folder. Fill every field. The tab shows an orange
   dot within about a second, and the window title ends in ` *`.
4. Press Ctrl+S. "Save changes to form-basic.pdf?" appears. Choose **Overwrite**. The dot
   clears.
5. Change a field and press Ctrl+S again. No dialog appears. The dot clears.
6. Open `flat-form.pdf`. Add some text with PDF.js's text tool. Draw a signature with the
   signature tool, tick "Save signature", and place it. Press Ctrl+S and choose Overwrite.
7. Open `three-pages.pdf`. Press Ctrl+Tab and Ctrl+Shift+Tab: the tabs cycle and wrap.
8. Make an edit, then press Ctrl+W. Save, Discard and Cancel appear. Try Cancel first
   (the tab stays), then Discard (the tab closes).
9. With the page focused, press Ctrl+O. PDFluffer's Open dialog appears, not a browser
   one.
10. Open `fake-signed.pdf`. The tab shows a **Signed** chip.
11. Select and copy text as in H9, and paste it into Notepad.
12. Hover over a tab. The tooltip shows the file's full path.

**Expected:** each step behaves as written, and the saved files in the test folder hold
your edits when opened again. **If not,** report the step number and what happened.

## U2 - saved forms open in other viewers

1. Open the `form-basic.pdf` you saved in U1 in Acrobat Reader, then in Chrome, then in
   Edge. To open it in a browser, drag it onto an empty browser tab.

**Expected:** all three show your filled values. **If not,** report which viewer and
which fields are wrong.

## U3 - printing

1. In the dev app, open `three-pages.pdf`.
2. Open the menu (the three lines at the right of the tab bar) and choose **Print...**.
   Also try PDF.js's own print button inside the page, and Ctrl+P.

**Expected:** the Windows print dialog appears, and its preview shows the three pages
correctly. You do not need to print. **If not,** report which of the three ways failed.

## U4 - reordering pages by dragging a thumbnail

1. In the dev app, open `three-pages.pdf`.
2. Open PDF.js's sidebar (the button at the top left of the page area) to show the page
   thumbnails.
3. Drag the thumbnail of page 3 above page 1.

**Expected:** the page order changes, and the tab shows the orange dot. **If not,**
report it. The spec's rule then turns off drag and drop to open files (U5). The builder
makes that change. You do not.

## U5 - drag a PDF from Explorer to open it

1. In the dev app, have at least one tab open.
2. Drag `flat-form.pdf` from the test folder in Explorer onto the PDFluffer window.
3. Drag a non-PDF file, for example a `.txt` file, onto the window.

**Expected:** the PDF opens in a new tab, or its existing tab becomes active. The
non-PDF file does nothing. **If not,** report what happened.

## U6 - the installer

The builder already ran `npm run tauri build`. The installer is at
`src-tauri\target\release\bundle\nsis\PDFluffer_0.1.0_x64-setup.exe`. To rebuild it:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"; npm.cmd run tauri build
```

1. Close the dev app if it is running.
2. Double-click the installer and follow its steps.

**Expected:** it installs with no administrator (UAC) prompt, and PDFluffer appears in
the Start menu. **If not,** report the prompt or error you saw. Windows SmartScreen may
warn that the app is unrecognised, because it is not code signed. That is expected.
Choose "More info", then "Run anyway".

## U7 - default PDF app and single instance

Use the installed app from U6 for this check.

1. Open Windows Settings, then Apps, then Default apps. Search for `.pdf` and choose
   **PDFluffer**.
2. Close PDFluffer if it is open. In Explorer, double-click `form-basic.pdf` in the test
   folder. PDFluffer starts with that file open.
3. Minimise PDFluffer.
4. Double-click `three-pages.pdf` in Explorer.

**Expected:** after step 4 there is still only one PDFluffer window. It comes to the
front, un-minimised, with `three-pages.pdf` in a new, active tab. **If not,** report
whether a second window opened, whether the file opened, and whether the window came
forward.

To put your old PDF app back afterwards, repeat step 1 and choose it.

## U8 - session restore

1. Open three files: `form-basic.pdf`, `flat-form.pdf` and `three-pages.pdf`.
2. Make `three-pages.pdf` active, and scroll to page 3. Zoom to 150%.
3. Close the window with the X button.
4. Start PDFluffer again.

**Expected:** the three tabs return in the same order. `three-pages.pdf` is active, on
page 3, at 150%. **If not,** report which part differed.

## U9 - a file that moved

1. Open `flat-form.pdf` from the test folder. Close the window.
2. In Explorer, rename `flat-form.pdf` to `flat-form-moved.pdf`.
3. Start PDFluffer and click the `flat-form.pdf` tab.

**Expected:** the tab shows "File not found" with the old path. Click **Locate...**,
choose `flat-form-moved.pdf`, and the file opens in that tab, now named
`flat-form-moved.pdf`. **If not,** report what the tab showed.

## U10 - saving a file another program holds open

1. Open `form-basic.pdf` from the test folder in PDFluffer. Change a field.
2. Open the same file in Acrobat Reader and leave it open.
3. In PDFluffer, press Ctrl+S (choose Overwrite if asked).

**Expected:** "Could not save" appears with "Another program has this file open. Close
it there, or use Save As." The tab keeps its orange dot. Close Acrobat, and the file
still opens correctly in it. **If not,** report the message, and whether the file was
damaged.

Acrobat Reader does not always lock a file. If the save simply works, report that. It
is not a PDFluffer failure, but the builder needs to know.

## U11 - no CSP errors

A CSP (content security policy) is the rule set that stops the app loading anything from
outside. A CSP error means something tried.

1. Start the dev app and open the developer tools on the Console tab.
2. Open `form-basic.pdf`, fill a field, draw and place a signature, save, and open the
   print dialog, then cancel it.

**Expected:** the console shows no line containing "Content Security Policy" or "CSP".
**If not,** copy each such line into your report.

## U12 - closing with unsaved changes

This checks decision 8 in `BUILD-NOTES.md`: PDF.js must not add its own "Leave site?"
prompt when the window closes.

1. Start the dev app, open `form-basic.pdf` and change a field. Do not save.
2. Close the window with the X button. "Save changes to form-basic.pdf?" appears.
3. Choose **Discard**.

**Expected:** the window closes. No "Leave site?" or "Changes you made may not be saved"
prompt appears. Start the app again: the tab returns, and the field does not hold the
discarded change. **If not,** report the prompt's exact words.

Also try step 2 with **Cancel**. The window must stay open with the change still there.
