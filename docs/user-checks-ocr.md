# PDFluffer - one check for OCR

OCR, short for optical character recognition, is software reading the words in a picture of
a page. A scanned PDF is only pictures, so you cannot select, copy or search its text.
PDFluffer's new tool reads each scanned page with the OCR built into Windows and lays an
invisible copy of the words exactly over the picture. The page looks the same as before.
Now you can select, copy and search it.

This is plan item P4.10. It is the only check left for OCR. The automated test has already
run the tool in the installed program, on three test pages: straight, slightly crooked, and
turned sideways. It found every word, placed within 3 pixels of the word in the picture, and
the text survived a save and a restart. What it cannot judge is a real scan of yours, and
how selecting and copying feel. That part is yours.

## What to expect, and what not to

- **Printed text becomes text.** Typed letters, forms and printed invoices should all work.
- **Stamps, signatures and handwriting will not become text,** or only as a few stray
  characters. That is expected. The picture is never changed, so the stamp and the
  signature still look exactly as they did.
- **A wrong word is invisible.** Overlapping stamps or single digits in ruled boxes can read
  wrongly. You only see it when you copy or search.
- **Latin text only.** A letter outside Western European text is left out.

## Before you start

1. Install the new build: run
   `C:\Users\nick2\Code\pdfluffer\src-tauri\target\release\bundle\nsis\PDFluffer_0.1.0_x64-setup.exe`.
2. Pick a real scanned PDF of your own, one with printed text.
3. **Copy it first**, and do this check on the copy. The check ends with a save, and a save
   overwrites the file.

## U-OCR - make a real scan selectable

1. Open the copy of your scan in PDFluffer.
2. Try to select some text with the mouse. On a scan nothing selects. That shows the page
   has no text yet.
3. Open the menu (the three lines at the top right). Under **Document**, choose
   **Make text selectable (OCR)...**.
4. It says how many pages have no selectable text. Choose **Make selectable**.
5. A small window says "Reading page 1 of N...". Wait. Each page takes a second or two.
6. It ends with **Text added**, saying how many words it added and in which language.
   Choose **OK**. The tab now shows the orange dot: the change is not saved yet.
7. Select a whole paragraph by dragging over it. Press **Ctrl+C**.
8. Open Notepad and press **Ctrl+V**. The paragraph's words should appear.
9. Back in PDFluffer, press **Ctrl+F** and search for a word you can see on the page. It
   should be found and highlighted where the word is.
10. Press **Ctrl+S** and choose **Overwrite**. The dot goes away.
11. Open the saved file in **Chrome or Edge**. Select some text there, and copy it into
    Notepad as well.

**Expect:**

- In step 4 the count matches the scanned pages you expect.
- In step 7 the highlight covers the words you dragged over, not the space above or below.
- In steps 8 and 11 the pasted words are the words on the page, in order, with spaces
  between them. A few wrong characters are normal for a scan.
- In step 9 the highlight lands on the word itself.
- The pages look exactly as they did before, in PDFluffer and in the other browser.

**If you change your mind before saving:** choose **Revert to saved** in the menu, and the
text layer goes away.

**If it fails, report:**

- which step, and what you saw instead;
- whether the highlight was off to one side, above, or below the words, and roughly how far;
- if the pasted text is mostly wrong, whether the scan is printed or handwritten, and
  whether the page is crooked or upside down;
- if the tool is missing from the menu, say so. It only appears when Windows has a
  language with OCR installed.

Please do not send the text of the document itself. A description of the problem is enough.

## Result

| Check | What it covers | Pass or fail | Notes |
|---|---|---|---|
| U-OCR | OCR a real scan, copy, search, save, and select it in Chrome or Edge | | |
