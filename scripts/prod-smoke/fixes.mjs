// Release-build test for chip 16's three fixes (spec 22): PDF.js's rotate commands are saved,
// tabs reorder by dragging, and About shows the licence notices. Drives the REAL release
// build through its WebView2 debugging port, with real mouse and key input through CDP.
//
//   1. With the Rust PATH set:  npm run tauri build
//   2.                          npm run smoke:fixes
//
// It proves, in the production build:
//   - PDF.js's Rotate Clockwise button (a real click in its Tools menu) and the R key turn
//     every page as a page change, the tab becomes unsaved, and the view never turns;
//   - Save with Overwrite keeps the turn on disk, and a relaunch shows it with the view at 0;
//   - a real mouse drag moves the first of three tabs past the third, with nothing unsaved,
//     no viewer loaded and the active tab unchanged (the design: a drag never activates);
//   - a click with no movement only activates, and the order comes back after a relaunch;
//   - About, Licences shows the notices; no console error, CSP violation or exception.
//
// Safety, as run.mjs: it refuses to run while PDFluffer is open, works on copies of samples/
// in a temp folder, starts from an empty session, and backs up and restores the user's
// state.json and window state. It runs on the user's real desktop, so every connection
// brings the page to the front, and the app menu is chosen with the reopen pattern.
import { execSync, spawn, spawnSync } from "node:child_process";
import { cpSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, sleep, until, problems, TABS, DIALOG, clickButton } from "./cdp.mjs";

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
const rotations = `(async () => { const a = ${VIS}.contentWindow.PDFViewerApplication; const out = []; for (let i = 1; i <= a.pagesCount; i++) out.push((await a.pdfDocument.getPage(i)).rotate); return out.join(','); })()`;
const VIEW_ROTATION = `${VIS}.contentWindow.PDFViewerApplication.pdfViewer.pagesRotation`;
// Every view turn PDF.js reports from now on, kept on the parent window. The event bus is the
// same object across loads, so one listener covers the reloads after each rotate.
const WATCH_TURNS = `(() => { window.__turns = []; ${VIS}.contentWindow.PDFViewerApplication.eventBus.on('rotationchanging', e => window.__turns.push(e.pagesRotation)); return true; })()`;
const TURNS = `JSON.stringify(window.__turns)`;
const DIRTY = `!!document.querySelector('.tab.active .tab-dirty')`;
const ANY_DIRTY = `!!document.querySelector('.tab .tab-dirty')`;
const SETTLED = `!document.querySelector('.tab.active .tab-dirty') && !document.querySelector('dialog[open]')`;
const ORDER = `[...document.querySelectorAll('.tabs > .tab .tab-name')].map(n => n.textContent).join('|')`;
const ACTIVE = `document.querySelector('.tab.active .tab-name')?.textContent`;
const FRAMES = `document.querySelectorAll('.viewer-host iframe').length`;
/** The centre of an element inside the visible viewer iframe, in the page's coordinates. */
const centreInViewer = (selector) => `(() => { const f = ${VIS}; const el = f.contentDocument.querySelector(${JSON.stringify(selector)}); if (!el) return null; const a = f.getBoundingClientRect(); const b = el.getBoundingClientRect(); if (!b.width) return null; return JSON.stringify({ x: a.left + b.left + b.width / 2, y: a.top + b.top + b.height / 2 }); })()`;
/** The tab name's centre, so a press never lands on the close button. */
const tabCentre = (index) => `(() => { const t = document.querySelectorAll('.tabs > .tab')[${index}]; if (!t) return null; const n = t.querySelector('.tab-name').getBoundingClientRect(); return JSON.stringify({ x: n.left + Math.min(n.width / 2, 40), y: n.top + n.height / 2 }); })()`;
const openMenu = `(() => { const b = [...document.querySelectorAll('.tabbar button')].find(b => /menu/i.test(b.getAttribute('aria-label') || b.title || '')); if (!b) return false; b.click(); return true; })()`;
const clickMenuItem = (label) =>
  `(() => { const b = [...document.querySelectorAll('.menu-list button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)})); if (!b) return false; b.click(); return true; })()`;
const menuHas = (label) =>
  `[...document.querySelectorAll('.menu-list button')].some(b => b.textContent.trim().startsWith(${JSON.stringify(label)}) && !b.disabled)`;
const MENU_OPEN = `!!document.querySelector('.menu-list')`;
const LICENCES_TEXT = `document.querySelector('dialog.licences-dialog[open] pre')?.textContent ?? ''`;

/** As run.mjs: reopen the menu while waiting if it closed. A click that landed is never repeated. */
async function chooseMenuItem(c, label) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ready = await until(async () => {
      if (await c.ev(menuHas(label))) return true;
      if (!(await c.ev(MENU_OPEN))) await c.ev(openMenu);
      return false;
    }, 20000, 400);
    if (!ready) return false;
    if (await c.ev(clickMenuItem(label))) return true;
  }
  return false;
}

// Real input through CDP. Coordinates are CSS pixels of the main page.
const mouse = (c, type, x, y, buttons, extra = {}) =>
  c.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, ...extra });
async function click(c, x, y) {
  await mouse(c, "mouseMoved", x, y, 0);
  await mouse(c, "mousePressed", x, y, 1, { clickCount: 1 });
  await mouse(c, "mouseReleased", x, y, 0, { clickCount: 1 });
}
async function drag(c, from, to, steps = 12) {
  await mouse(c, "mouseMoved", from.x, from.y, 0);
  await mouse(c, "mousePressed", from.x, from.y, 1, { clickCount: 1 });
  for (let i = 1; i <= steps; i++) {
    await mouse(c, "mouseMoved", from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, 1);
    await sleep(30);
  }
  await mouse(c, "mouseReleased", to.x, to.y, 0, { clickCount: 1 });
}
async function key(c, k, code, vk, modifiers = 0) {
  await c.send("Input.dispatchKeyEvent", { type: "keyDown", modifiers, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: modifiers ? undefined : k });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", modifiers, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}
async function saveWithCtrlS(c) {
  for (const type of ["rawKeyDown", "keyUp"]) {
    await c.send("Input.dispatchKeyEvent", { type, modifiers: 2, key: "s", code: "KeyS", windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83 });
  }
}

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

const work = mkdtempSync(join(tmpdir(), "pdfluffer-fixes-"));
const backup = join(work, "state-backup");
cpSync(join(root, "samples"), join(work, "files"), { recursive: true });
const had = Object.fromEntries(stateFiles.map((f) => [f, existsSync(join(stateDir, f))]));
for (const f of stateFiles) if (had[f]) cpSync(join(stateDir, f), join(backup, f));
for (const f of stateFiles) rmSync(join(stateDir, f), { force: true });
const three = join(work, "files", "three-pages.pdf");
const form = join(work, "files", "form-basic.pdf");
const flat = join(work, "files", "flat-form.pdf");

try {
  // 1. PDF.js's own Rotate Clockwise, a real click in its Tools menu.
  launch([three]);
  let c = await connect();
  await c.send("Page.bringToFront");
  check("three-pages.pdf opens", await until(() => c.ev(pagesLoaded(3)), 40000));
  await sleep(1000);
  await c.ev(WATCH_TURNS);
  const toggle = JSON.parse((await until(() => c.ev(centreInViewer("#secondaryToolbarToggleButton")), 10000)) ?? "null");
  if (toggle) await click(c, toggle.x, toggle.y);
  const cw = JSON.parse((await until(() => c.ev(centreInViewer("#pageRotateCw")), 5000)) ?? "null");
  check("PDF.js's Tools menu shows Rotate Clockwise", !!cw);
  if (cw) await click(c, cw.x, cw.y);
  check("the click marks the tab unsaved", await until(() => c.ev(DIRTY), 20000));
  await until(async () => (await c.ev(rotations)) === "90,90,90", 10000);
  check("every page's /Rotate reads 90", (await c.ev(rotations)) === "90,90,90", await c.ev(rotations));
  check("the view rotation is 0", (await c.ev(VIEW_ROTATION)) === 0, String(await c.ev(VIEW_ROTATION)));
  // Close PDF.js's Tools menu, so the next click lands on the page.
  await key(c, "Escape", "Escape", 27);
  await sleep(500);

  // 2. The R key, with the page focused and no field in focus.
  const page = JSON.parse((await until(() => c.ev(centreInViewer(".page")), 10000)) ?? "null");
  if (page) await click(c, page.x, page.y);
  await sleep(300);
  const focus = await c.ev(`${VIS}.contentDocument.activeElement?.tagName`);
  await key(c, "r", "KeyR", 82);
  await until(async () => (await c.ev(rotations)) === "180,180,180", 15000);
  check("pressing R turns every page to 180", (await c.ev(rotations)) === "180,180,180", `${await c.ev(rotations)}, focus on ${focus}`);
  check("the view rotation is still 0", (await c.ev(VIEW_ROTATION)) === 0, String(await c.ev(VIEW_ROTATION)));
  check("PDF.js never turned the view (both paths caught first)", (await c.ev(TURNS)) === "[]", await c.ev(TURNS));

  // 3. Save with Overwrite, close, relaunch on the file.
  await saveWithCtrlS(c);
  const first = await until(() => c.ev(DIALOG), 8000);
  await c.ev(clickButton("Overwrite"));
  check("Save with Overwrite clears the dot", first && (await until(() => c.ev(SETTLED), 15000)), first ?? "no dialog");
  check("the file on disk carries /Rotate 180", /\/Rotate 180/.test(readFileSync(three, "latin1")));
  allProblems.push(...problems(c.events));
  try { c.close(); } catch { /* ignore */ }
  requestClose();
  check("the clean window closes without asking", await waitGone());

  launch([three]);
  c = await connect();
  await c.send("Page.bringToFront");
  await until(() => c.ev(pagesLoaded(3)), 40000);
  await sleep(1500);
  check("after a relaunch the pages still read 180", (await c.ev(rotations)) === "180,180,180", await c.ev(rotations));
  check("and the restored view rotation is 0", (await c.ev(VIEW_ROTATION)) === 0, String(await c.ev(VIEW_ROTATION)));
  check("the reopened tab is clean", !(await c.ev(DIRTY)));

  // 4. Three tabs, then a real mouse drag of the first past the third.
  spawnSync(exe, [form], { env, timeout: 20000 });
  spawnSync(exe, [flat], { env, timeout: 20000 });
  const three3 = await until(async () => (await c.ev(ORDER)) === "three-pages.pdf|form-basic.pdf|flat-form.pdf", 15000);
  check("three tabs are open", three3, await c.ev(ORDER));
  await until(() => c.ev(pagesLoaded(1)), 15000);
  await sleep(1000);
  const activeBefore = await c.ev(ACTIVE);
  const framesBefore = await c.ev(FRAMES);
  const from = JSON.parse(await c.ev(tabCentre(0)));
  const past = JSON.parse(await c.ev(`(() => { const r = document.querySelectorAll('.tabs > .tab')[2].getBoundingClientRect(); return JSON.stringify({ x: r.right - 4, y: r.top + r.height / 2 }); })()`));
  await drag(c, from, past);
  await sleep(800);
  check("dragging the first tab past the third reorders the tabs",
    (await c.ev(ORDER)) === "form-basic.pdf|flat-form.pdf|three-pages.pdf", await c.ev(ORDER));
  check("the active tab is unchanged by the drag", (await c.ev(ACTIVE)) === activeBefore, `${activeBefore} -> ${await c.ev(ACTIVE)}`);
  check("nothing is unsaved and no viewer loaded",
    !(await c.ev(ANY_DIRTY)) && (await c.ev(FRAMES)) === framesBefore, `frames ${framesBefore} -> ${await c.ev(FRAMES)}`);

  // 5. A click with no movement only activates.
  const formTab = JSON.parse(await c.ev(tabCentre(0)));
  await click(c, formTab.x, formTab.y);
  await until(async () => (await c.ev(ACTIVE)) === "form-basic.pdf", 10000);
  check("a click with no movement activates the tab", (await c.ev(ACTIVE)) === "form-basic.pdf", await c.ev(ACTIVE));
  check("and leaves the order alone", (await c.ev(ORDER)) === "form-basic.pdf|flat-form.pdf|three-pages.pdf", await c.ev(ORDER));
  await until(() => c.ev(pagesLoaded(1)), 15000);
  await sleep(1500);

  // 6. Close and relaunch: the tabs come back in the new order.
  allProblems.push(...problems(c.events));
  try { c.close(); } catch { /* ignore */ }
  requestClose();
  check("the window closes without asking", await waitGone(), "a dialog would mean a tab was unsaved");
  launch([]);
  c = await connect();
  await c.send("Page.bringToFront");
  await until(() => c.ev(`document.querySelectorAll('.tabs > .tab').length === 3`), 20000);
  check("after a relaunch the tabs come back in the new order",
    (await c.ev(ORDER)) === "form-basic.pdf|flat-form.pdf|three-pages.pdf", await c.ev(ORDER));
  check("with the last active tab active", (await c.ev(ACTIVE)) === "form-basic.pdf", await c.ev(ACTIVE));
  await until(() => c.ev(pagesLoaded(1)), 20000);
  await sleep(1000);

  // 7. About, Licences.
  check("About PDFluffer is chosen from the menu", await chooseMenuItem(c, "About PDFluffer"));
  const about = await until(() => c.ev(DIALOG), 8000);
  check("About offers Licences beside OK", about && JSON.parse(about).buttons.join("|") === "Licences|OK", about ?? "no dialog");
  await c.ev(clickButton("Licences"));
  const text = String(await until(async () => { const t = await c.ev(LICENCES_TEXT); return t.length > 1000 ? t : null; }, 10000) ?? "");
  // Package names are matched without case: React's own licence text never says "React",
  // and the notices list it by its package name, react.
  const words = [["MIT License", /MIT License/], ["PDFium", /PDFium/], ["pdf-lib", /pdf-lib/], ["React", /\breact\b/i], ["tauri", /\btauri\b/i]];
  const missing = words.filter(([, re]) => !re.test(text)).map(([w]) => w);
  check("the Licences dialog shows the notices", missing.length === 0, `${text.length} characters${missing.length ? `, missing ${missing.join(", ")}` : ""}`);
  await c.ev(clickButton("Close"));
  check("Close closes it", await until(() => c.ev(`!document.querySelector('dialog[open]')`), 5000));

  allProblems.push(...problems(c.events));
  try { c.close(); } catch { /* ignore */ }
  requestClose();
  check("the clean window closes without asking", await waitGone());
  // 8.
  check("no console error, CSP violation or exception anywhere", allProblems.length === 0, allProblems.join(" ; ").slice(0, 400));
} catch (err) {
  check("the run completed", false, String(err?.stack ?? err).slice(0, 400));
} finally {
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
