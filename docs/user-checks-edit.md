# PDFluffer - one check for editing text

PDFluffer 0.2.0 can change, add and delete the text in a PDF. A PDF does not store
paragraphs. It stores short pieces of text, each drawn at one spot on the page in one font.
PDFluffer edits those pieces one line at a time: a changed line stays where it was, and the
lines after it do not move up or down.

This is plan item P6.11. It is the only check left for editing text. The automated test has
already run the editor in the installed program on a test file: it changed a line, added a
line, deleted it, undid and redid that, saved, and opened the file again. What it cannot
judge is a real PDF of yours, and how the result looks in other programs. That part is yours.

## What a font note means

Each piece of text has its own font. When you type a letter that the text's own font cannot
draw, PDFluffer draws that one line in the closest Windows font instead (Arial, Times New
Roman, Courier New or Calibri) and says so under the toolbar:

> This text's own font lacks some of these letters, so it now uses Arial.

The line will look slightly different from its neighbours, and the file grows by about half
a megabyte to a megabyte, because the whole Windows font goes into it. That is expected.
Typing only letters the line already used, or plain English letters in most PDFs, usually
gives no note.

A second note can appear when the new text is much longer than the old:

> The new text is longer than the old, so it may overlap the text after it.

PDFluffer first narrows the letters slightly to make them fit. If that is not enough, the
line runs on past where the old one ended.

## Before you start

1. Install the latest release: download `PDFluffer_<version>_x64-setup.exe` from
   https://github.com/nick2468/pdfluffer/releases/latest and run it. It is signed by
   "Open Source Developer Nicholas Walker". SmartScreen may still warn about a new file.
2. Pick a real PDF of your own with typed text, such as a letter or an invoice. A scanned
   PDF will not work: its pages are pictures, with no text to edit.
3. **Copy it first**, and do this check on the copy. The check ends with a save, and a save
   overwrites the file.

## U-EDIT - edit text in a real PDF

1. Open the copy in PDFluffer.
2. Open the menu (the three lines at the top right). Under **Document**, choose
   **Edit text...**. The editor fills the window and shows the page you were on. The first
   time, it says "Loading the text editor..." for a moment. Each line you can edit has a
   thin blue box round it.
3. **Change a word.** Click a line. A white box opens holding its text. Change one word and
   press **Enter**. The page redraws with the new text.
4. **Add a line.** Choose **Insert text**, then click an empty spot on the page. A box opens
   where you clicked. Type a short line and press **Enter**. It appears in the font and size
   of the nearest line.
5. **Delete a line.** Click the line you just added, press **Escape** to close its box (the
   line stays selected), then choose **Delete**. It disappears.
6. **Undo and redo.** Choose **Undo**: the deleted line comes back. Choose **Redo**: it goes
   again. **Ctrl+Z** and **Ctrl+Y** do the same when no white box is open.
7. Choose **Done**. The editor closes, and the tab shows the orange dot: the change is not
   saved yet.
8. Press **Ctrl+S** and choose **Overwrite**. The dot goes away.
9. Open the saved file in **Adobe Acrobat Reader**, then in **Chrome**, then in **Edge**.

**Expect:**

- In step 3 the changed line starts exactly where the old one started, in the same font,
  size and colour, unless a font note appeared.
- In step 4 the new line matches the text near it.
- In steps 5 and 6 the page shows exactly what the step says.
- In step 9 all three programs show the changed word, without the deleted line, and the
  rest of the page as it was. The changed line looks the same in each program.
- You can select and copy the changed word in each program, and it pastes as typed.

**If you change your mind:** in the editor, **Cancel** asks "Discard these text edits?".
After Done, **Revert to saved** in the menu throws away everything since the last save.

**If it fails, report:**

- which step, and what you saw instead;
- whether a font note appeared, and which font it named;
- in step 9, which program looks wrong and how: the wrong letters, a gap, overlapping text,
  or the text in a different place;
- if a line you wanted to change has no blue box, say so. Text in form fields, notes and
  pictures cannot be edited.

Please do not send the document or its text. A description of the problem is enough.

## Result

| Check | What it covers | Pass or fail | Notes |
|---|---|---|---|
| U-EDIT | Change, insert and delete text in a real PDF, undo, save, and check it in Acrobat, Chrome and Edge | | |
