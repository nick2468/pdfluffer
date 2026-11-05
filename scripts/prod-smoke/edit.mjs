// Text editor smoke test (plan P6.8, chip 15). Drives the REAL release build through its
// WebView2 debugging port, like run.mjs, and proves the Edit text dialog end to end, by DOM
// clicks on the real UI. It never uses the test hook.
//
//   1. With the Rust PATH set:  npm run tauri build
//   2.                          npm run smoke:edit
//
// On a copy of samples/three-pages.pdf it proves: PDFium is not fetched at start; Edit text...
// opens the dialog and draws the page with a box named "Page 1"; a replace with "Page A" shows
// no font note; Insert text and a click on an empty area add "Added line"; Delete removes it,
// Undo brings it back and Redo removes it again; Cancel with edits asks "Discard these text
// edits?" and Keep editing keeps them; Done marks the tab unsaved and PDF.js reads "Page A";
// reopening continues the history (Undo is enabled), and Undo then Done brings "Added line"
// back; Save with Overwrite ends the history (Undo is disabled on reopening); a relaunch on the
// saved file reads both lines; a replace with a character outside Helvetica's encoding shows
// the font note, and Cancel then Discard leave the tab unchanged; and nothing logs a console
// error, a CSP violation or an exception.
//
// The menu closes whenever the window loses focus, and this test runs on the user's real
// desktop, so it reopens the menu while it waits (the pattern from ocr.mjs, commit b465fba).
//
// Safety, as run.mjs: it refuses to run while PDFluffer is open (single instance would hijack
// the launch), works on a copy of samples/ in a temp folder, and backs up, clears and restores
// the user's state.json and window state.
import { execSync, spawn } from "node:child_process";
import { cpSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, sleep, until, problems, DIALOG, clickButton } from "./cdp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const exe = join(root, "src-tauri", "target", "release", "pdfluffer.exe");
const stateDir = join(process.env.APPDATA ?? "", "com.pdfluffer.desktop");
const stateFiles = ["state.json", ".window-state.json"];
const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9223" };

const running = () => /pdfluffer\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq pdfluffer.exe" /NH', { encoding: "utf8" }));
const requestClose = () =>
  execSync('powershell -NoProfile -Command "(Get-Process pdfluffer | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1).CloseMainWindow() | Out-Null"');
const waitGone = async (ms = 10000) => {
  for (let t = 0; t < ms; t += 250) {
    if (!running()) return true;
    await sleep(250);
  }
  return !running();
};
const launch = (args) => spawn(exe, args, { env, stdio: "ignore", detached: false });

// Page-side snippets. The viewer iframes are same-origin, so the parent page can reach them.
const VIS = `[...document.querySelectorAll('.viewer-host iframe')].find(f => getComputedStyle(f).visibility !== 'hidden')`;
const pagesLoaded = (n) => `(() => { const a = ${VIS}?.contentWindow?.PDFViewerApplication; return !!a?.pdfDocument && a.pagesCount === ${n}; })()`;
const PAGE_ONE_TEXT = `(async () => {
  const t = await (await ${VIS}.contentWindow.PDFViewerApplication.pdfDocument.getPage(1)).getTextContent();
  return t.items.map(i => i.str ?? '').join(' ');
})()`;
const DIRTY = `!!document.querySelector('.tab.active .tab-dirty')`;
const SETTLED = `!document.querySelector('.tab.active .tab-dirty') && !document.querySelector('dialog[open]')`;
/** PDFium's chunk and .wasm among everything the page has fetched so far. */
const FETCHED = `JSON.stringify(performance.getEntriesByType('resource').map(e => e.name)
  .filter(n => /\\/assets\\/(index\\.browser-[^/]*\\.js|pdfium-[^/]*\\.wasm)$/.test(n)))`;

const EDIT_TEXT = "Edit text...";
const openMenu = `(() => { const b = [...document.querySelectorAll('.tabbar button')].find(b => /menu/i.test(b.getAttribute('aria-label') || '')); if (!b) return false; b.click(); return true; })()`;
const menuHas = (label) => `[...document.querySelectorAll('.menu-list button')].some(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled)`;
const clickMenuItem = (label) =>
  `(() => { const b = [...document.querySelectorAll('.menu-list button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`;
const MENU_OPEN = `!!document.querySelector('.menu-list')`;

// The editor.
const EDITOR = `document.querySelector('dialog.text-editor[open]')`;
const EDITOR_OPEN = `!!${EDITOR}`;
const DRAWN = `(() => { const d = ${EDITOR}; const c = d?.querySelector('canvas'); return !!c && c.width > 0 && !d.querySelector('.text-editor-message'); })()`;
const BOXES = `JSON.stringify([...(${EDITOR}?.querySelectorAll('.text-run') ?? [])].map(b => b.getAttribute('aria-label')))`;
const NOTES = `${EDITOR}?.querySelector('.text-editor-notes')?.innerText ?? ''`;
const clickBox = (name) =>
  `(() => { const b = [...(${EDITOR}?.querySelectorAll('.text-run') ?? [])].find(b => b.getAttribute('aria-label') === ${JSON.stringify(name)}); if (!b) return false; b.click(); return true; })()`;
const toolbar = (label) => `[...(${EDITOR}?.querySelectorAll('.text-editor-toolbar button') ?? [])].find(b => b.textContent === ${JSON.stringify(label)})`;
const clickTool = (label) => `(() => { const b = ${toolbar(label)}; if (!b || b.disabled) return false; b.click(); return true; })()`;
const toolEnabled = (label) => `(() => { const b = ${toolbar(label)}; return !!b && !b.disabled; })()`;
const INPUT_OPEN = `!!${EDITOR}?.querySelector('.text-input')`;
/** Types into the open input box the way React sees typing, then presses Enter in it. */
const typeAndEnter = (text) => `(() => {
  const i = ${EDITOR}?.querySelector('.text-input'); if (!i) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(text)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  return true;
})()`;
const ESCAPE_INPUT = `(() => { const i = ${EDITOR}?.querySelector('.text-input'); if (!i) return false;
  i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return true; })()`;
/** A click on an empty part of the page: below "Page A", which sits in the middle. */
const CLICK_EMPTY = `(() => { const o = ${EDITOR}?.querySelector('.text-editor-overlay'); if (!o) return false;
  const r = o.getBoundingClientRect();
  o.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + r.width * 0.25, clientY: r.top + r.height * 0.75 }));
  return true; })()`;
const QUESTION = `(() => { const d = document.querySelector('dialog.choice-dialog[open]'); return d ? JSON.stringify({ title: d.querySelector('h2')?.textContent, buttons: [...d.querySelectorAll('button')].map(b => b.textContent) }) : null; })()`;
const answer = (label) => `(() => { const b = [...document.querySelectorAll('dialog.choice-dialog[open] button')].find(b => b.textContent === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
};
const allProblems = [];

if (!existsSync(exe)) {
  console.error(`No release build at ${exe}. Run "npm run tauri build" first, with the Rust PATH set.`);
  process.exit(2);
}
if (running()) {
  console.error("PDFluffer is running. Close it first: it is single-instance, so this test would hand off to your window.");
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), "pdfluffer-edit-"));
const backup = join(work, "state-backup");
cpSync(join(root, "samples"), join(work, "files"), { recursive: true });
const had = Object.fromEntries(stateFiles.map((f) => [f, existsSync(join(stateDir, f))]));
for (const f of stateFiles) if (had[f]) cpSync(join(stateDir, f), join(backup, f));
for (const f of stateFiles) rmSync(join(stateDir, f), { force: true });
const three = join(work, "files", "three-pages.pdf");
const original = readFileSync(three);

/** Opens the editor from the menu, reopening the menu if the window's focus closed it. */
async function openEditor(c) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ready = await until(async () => {
      if (await c.ev(menuHas(EDIT_TEXT))) return true;
      if (!(await c.ev(MENU_OPEN))) await c.ev(openMenu);
      return false;
    }, 20000, 400);
    if (!ready) return false;
    if (!(await c.ev(clickMenuItem(EDIT_TEXT)))) continue;
    return !!(await until(() => c.ev(DRAWN), 30000));
  }
  return false;
}

/** Waits until the editor's boxes are exactly these, and returns what they were. */
async function boxesBecome(c, names, ms = 15000) {
  const want = JSON.stringify(names);
  const seen = await until(async () => ((await c.ev(BOXES)) === want ? want : null), ms, 200);
  return seen ?? (await c.ev(BOXES));
}

/** Clicks a run's box, waits for its input box, then types and presses Enter. */
async function replaceBox(c, name, text) {
  if (!(await c.ev(clickBox(name)))) return false;
  if (!(await until(() => c.ev(INPUT_OPEN), 5000, 100))) return false;
  return c.ev(typeAndEnter(text));
}

async function pageOneText(c) {
  return until(async () => {
    const t = await c.ev(PAGE_ONE_TEXT);
    return typeof t === "string" ? t : null;
  }, 20000);
}

let c;
try {
  launch([three]);
  c = await connect();
  await c.send("Page.bringToFront");
  check("three-pages.pdf opens in the release build", await until(() => c.ev(pagesLoaded(3)), 40000));
  await sleep(1500);

  // 1. PDFium waits for the editor. The editor opens and draws page 1 with its box.
  check("PDFium's chunk and .wasm are not fetched at start", (await c.ev(FETCHED)) === "[]", await c.ev(FETCHED));
  check("Edit text... opens the dialog and the page is drawn", await openEditor(c));
  check("a box named \"Page 1\" exists", (await boxesBecome(c, ["Page 1"])) === JSON.stringify(["Page 1"]), await c.ev(BOXES));
  const fetched = JSON.parse(await c.ev(FETCHED));
  check("opening the editor fetched PDFium from the app's own origin",
    fetched.length === 2 && fetched.every((u) => u.startsWith("http://tauri.localhost/assets/")), fetched.join(", "));

  // 2. Replace.
  check("\"Page 1\" can be replaced by typing", await replaceBox(c, "Page 1", "Page A"));
  const afterReplace = await boxesBecome(c, ["Page A"]);
  check("the box \"Page A\" appears", afterReplace === JSON.stringify(["Page A"]), afterReplace);
  check("no font note shows", !/font/i.test(await c.ev(NOTES)), JSON.stringify(await c.ev(NOTES)));

  // 3. Insert.
  await c.ev(clickTool("Insert text"));
  await c.ev(CLICK_EMPTY);
  const insertOpened = await until(() => c.ev(INPUT_OPEN), 5000, 100);
  await c.ev(typeAndEnter("Added line"));
  const afterInsert = await boxesBecome(c, ["Page A", "Added line"]);
  check("Insert text and a click on an empty area add \"Added line\"", insertOpened && afterInsert === JSON.stringify(["Page A", "Added line"]), afterInsert);

  // 4. Delete, Undo, Redo.
  await c.ev(clickBox("Added line"));
  await until(() => c.ev(INPUT_OPEN), 5000, 100);
  await c.ev(ESCAPE_INPUT);   // closes the box with no edit; the run stays selected
  await until(() => c.ev(toolEnabled("Delete")), 5000, 100);
  await c.ev(clickTool("Delete"));
  const afterDelete = await boxesBecome(c, ["Page A"]);
  check("Delete removes \"Added line\"", afterDelete === JSON.stringify(["Page A"]), afterDelete);
  await c.ev(clickTool("Undo"));
  const afterUndo = await boxesBecome(c, ["Page A", "Added line"]);
  check("Undo brings it back", afterUndo === JSON.stringify(["Page A", "Added line"]), afterUndo);
  await c.ev(clickTool("Redo"));
  const afterRedo = await boxesBecome(c, ["Page A"]);
  check("Redo removes it again", afterRedo === JSON.stringify(["Page A"]), afterRedo);

  // 5. Cancel asks first; Keep editing keeps the edits.
  await c.ev(clickTool("Cancel"));
  const asked = await until(() => c.ev(QUESTION), 5000);
  check("Cancel with edits asks \"Discard these text edits?\"",
    asked && JSON.parse(asked).title === "Discard these text edits?", asked ?? "no question");
  await c.ev(answer("Keep editing"));
  await sleep(500);
  check("Keep editing keeps the editor open with its edits",
    (await c.ev(EDITOR_OPEN)) && (await c.ev(BOXES)) === JSON.stringify(["Page A"]) && (await c.ev(toolEnabled("Undo"))));

  // 6. Done.
  await c.ev(clickTool("Done"));
  check("Done closes the editor and marks the tab unsaved",
    (await until(async () => !(await c.ev(EDITOR_OPEN)) && (await c.ev(DIRTY)), 20000)) === true);
  await until(() => c.ev(pagesLoaded(3)), 20000);
  const doneText = await until(async () => {
    const t = await c.ev(PAGE_ONE_TEXT);
    return typeof t === "string" && t.includes("Page A") ? t : null;
  }, 20000);
  check("PDF.js in the tab reads \"Page A\" on page 1", !!doneText && !doneText.includes("Page 1") && !doneText.includes("Added line"),
    JSON.stringify(doneText ?? (await c.ev(PAGE_ONE_TEXT))));

  // 7. Reopen: the history continues. Undo once brings back "Added line".
  check("reopening the editor draws the page", await openEditor(c));
  check("Undo is enabled: the history continued", await until(() => c.ev(toolEnabled("Undo")), 5000));
  await c.ev(clickTool("Undo"));
  const reopenedUndo = await boxesBecome(c, ["Page A", "Added line"]);
  check("Undo once in the reopened editor brings back \"Added line\"", reopenedUndo === JSON.stringify(["Page A", "Added line"]), reopenedUndo);
  await c.ev(clickTool("Done"));
  await until(async () => !(await c.ev(EDITOR_OPEN)), 20000);
  await until(() => c.ev(pagesLoaded(3)), 20000);
  const undoneText = await until(async () => {
    const t = await c.ev(PAGE_ONE_TEXT);
    return typeof t === "string" && t.includes("Added line") ? t : null;
  }, 20000);
  check("after Done, PDF.js reads \"Added line\" again", !!undoneText && undoneText.includes("Page A"), JSON.stringify(undoneText ?? (await c.ev(PAGE_ONE_TEXT))));

  // 8. Save with Overwrite ends the history.
  for (const type of ["rawKeyDown", "keyUp"]) {
    await c.send("Input.dispatchKeyEvent", { type, modifiers: 2, key: "s", code: "KeyS", windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83 });
  }
  const firstSave = await until(() => c.ev(DIALOG), 8000);
  await c.ev(clickButton("Overwrite"));
  check("Save and Overwrite clear the dot", firstSave && (await until(() => c.ev(SETTLED), 20000)), firstSave ?? "no save dialog");
  check("the file on disk changed", !readFileSync(three).equals(original));
  check("reopening after the save draws the page", await openEditor(c));
  await sleep(300);
  check("Undo is disabled: a save ends the history", (await c.ev(`!!${toolbar("Undo")} && ${toolbar("Undo")}.disabled`)) === true);
  await c.ev(clickTool("Cancel"));
  check("Cancel with no edits closes without asking",
    (await until(async () => !(await c.ev(EDITOR_OPEN)), 5000)) === true && !(await c.ev(QUESTION)));

  // 9. Relaunch on the saved file.
  allProblems.push(...problems(c.events));
  try { c.close(); } catch { /* ignore */ }
  requestClose();
  check("the saved window closes without asking", await waitGone());
  launch([three]);
  c = await connect();
  await c.send("Page.bringToFront");
  await until(() => c.ev(pagesLoaded(3)), 40000);
  await sleep(1000);
  const relaunched = await pageOneText(c);
  check("after a relaunch PDF.js reads \"Page A\" and \"Added line\"",
    !!relaunched && relaunched.includes("Page A") && relaunched.includes("Added line") && !relaunched.includes("Page 1"), JSON.stringify(relaunched));

  // 10. A character outside Helvetica's encoding: the font note. Cancel, Discard: unchanged.
  check("the editor opens on the saved file", await openEditor(c));
  await replaceBox(c, "Page A", "Page Ω");
  const noted = await until(async () => {
    const n = await c.ev(NOTES);
    return /own font lacks some of these letters, so it now uses/.test(n) ? n : null;
  }, 15000, 200);
  check("a replace with \"Ω\" shows the font note", !!noted, JSON.stringify(noted ?? (await c.ev(NOTES))));
  check("and the box \"Page Ω\" appears", (await boxesBecome(c, ["Page Ω", "Added line"])) === JSON.stringify(["Page Ω", "Added line"]), await c.ev(BOXES));
  await c.ev(clickTool("Cancel"));
  await until(() => c.ev(QUESTION), 5000);
  await c.ev(answer("Discard"));
  check("Cancel and Discard close the editor", (await until(async () => !(await c.ev(EDITOR_OPEN)), 5000)) === true);
  await sleep(500);
  const untouched = await pageOneText(c);
  check("the tab is unchanged: still saved, still \"Page A\"",
    !(await c.ev(DIRTY)) && !!untouched && untouched.includes("Page A") && !untouched.includes("Ω"), JSON.stringify(untouched));

  // 11. Nothing went wrong anywhere.
  allProblems.push(...problems(c.events));
  try { c.close(); } catch { /* ignore */ }
  requestClose();
  check("a clean window closes without asking", await waitGone());
  const noise = allProblems.filter((p) => !/No available adapters/.test(p));
  check("no console error, CSP violation or exception anywhere", noise.length === 0, noise.join(" ; ").slice(0, 600));
} catch (err) {
  check("the run completed", false, String(err?.stack ?? err).slice(0, 400));
} finally {
  try { c?.close(); } catch { /* the app has gone */ }
  if (running()) {
    try { execSync("taskkill /IM pdfluffer.exe /F", { stdio: "ignore" }); } catch { /* already gone */ }
    await sleep(800);
  }
  for (const f of stateFiles) {
    if (had[f]) copyFileSync(join(backup, f), join(stateDir, f));
    else rmSync(join(stateDir, f), { force: true });
  }
  rmSync(work, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} passed. The user's saved state was restored.`);
process.exit(failed.length ? 1 : 0);
