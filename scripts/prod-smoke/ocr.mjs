// OCR smoke test (plan P4.9). Drives the REAL release build through its WebView2 debugging
// port, like run.mjs, and proves "Make text selectable (OCR)..." end to end, where the
// Windows OCR engine, the page drawing and the production CSP all apply:
//
//   1. With the Rust PATH set:  npm run tauri build
//   2.                          npm run smoke:ocr
//
// It opens samples/scan-three.pdf, three pages that are only pictures: straight, turned two
// degrees, and upright on a /Rotate 90 page. It runs the tool, then checks that the words
// are there as text and that each lands over the same word in the picture, by comparing
// against the true positions the fixtures script measured (samples/ocr/*.json). Then it
// saves, restarts, and checks the text survived and that a second run adds nothing.
//
// The fixture words are the only text it prints. It never prints what a real scan says.
//
// Safety, as run.mjs: it refuses to run while PDFluffer is open (single instance would
// hijack the launch), works on copies of samples/ in a temp folder, and backs up, clears
// and restores the user's state.json and window state.
import { execSync, spawn, spawnSync } from "node:child_process";
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

/** The fixture pictures are 1600 by 1200 on a 576 by 432 point page. */
const SCALE = 1600 / 576;
/** The chip's tolerances. Not to be loosened. */
const ACROSS = 14;
const COVERAGE = 0.9;
const TOOL = "Make text selectable (OCR)...";

// Page-side snippets. The viewer iframes are same-origin, so the parent page can reach them.
const VIS = `[...document.querySelectorAll('.viewer-host iframe')].find(f => getComputedStyle(f).visibility !== 'hidden')`;
const APP = `${VIS}.contentWindow.PDFViewerApplication`;
const pagesLoaded = (n) => `(() => { const a = ${VIS}?.contentWindow?.PDFViewerApplication; return !!a?.pdfDocument && a.pagesCount === ${n}; })()`;
const activeIs = (name) => `document.querySelector('.tab.active .tab-name')?.textContent === ${JSON.stringify(name)}`;
const openMenu = `(() => { const b = [...document.querySelectorAll('.tabbar button')].find(b => /menu/i.test(b.getAttribute('aria-label') || '')); if (!b) return false; b.click(); return true; })()`;
const menuHas = (label) => `[...document.querySelectorAll('.menu-list button')].some(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled)`;
const clickMenuItem = (label) =>
  `(() => { const b = [...document.querySelectorAll('.menu-list button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`;
const DIRTY = `!!document.querySelector('.tab.active .tab-dirty')`;
/** What is on screen, for a failure's detail: the tabs, and the menu's OCR item. */
const SCREEN = `JSON.stringify({
  tabs: [...document.querySelectorAll('.tab')].map(t => (t.classList.contains('active') ? '*' : '') + t.querySelector('.tab-name')?.textContent),
  tool: [...document.querySelectorAll('.menu-list button')].find(b => b.textContent.trim() === ${JSON.stringify(TOOL)})?.disabled ?? 'menu closed',
  dialog: document.querySelector('dialog[open] h2')?.textContent ?? null,
})`;
const SETTLED = `!document.querySelector('.tab.active .tab-dirty') && !document.querySelector('dialog[open]')`;
const PROGRESS = `(() => { const d = [...document.querySelectorAll('dialog[open]')].find(d => d.querySelector('#progress-dialog-title')); return d ? d.querySelector('.dialog-body')?.textContent : null; })()`;

/** Each page's real text, counted without spaces, the way the app counts it (O5). */
const TEXT_LENGTHS = `(async () => {
  const a = ${APP}; const out = [];
  for (let n = 1; n <= a.pagesCount; n++) {
    const t = await (await a.pdfDocument.getPage(n)).getTextContent();
    out.push(t.items.reduce((sum, i) => sum + (typeof i.str === 'string' ? i.str.replace(/\\s/g, '').length : 0), 0));
  }
  return JSON.stringify(out);
})()`;

/**
 * A page's text items, each with its origin sent through the page's own viewport into the
 * fixture's picture pixels. The viewport holds the page's /Rotate, so page 3 needs nothing
 * special. PDF.js merges neighbouring words into one item, so an item holds one or more.
 */
const itemsOf = (page) => `(async () => {
  const p = await ${APP}.pdfDocument.getPage(${page});
  const v = p.getViewport({ scale: ${SCALE} });
  const [a, b, c, d, e, f] = v.transform;
  const t = await p.getTextContent();
  return JSON.stringify(t.items.filter(i => typeof i.str === 'string' && i.str.trim()).map(i => {
    const [x0, y0] = [i.transform[4], i.transform[5]];
    return { str: i.str, x: a * x0 + c * y0 + e, y: b * x0 + d * y0 + f };
  }));
})()`;

/**
 * Every word's exact text origin, read from PDF.js's own operator list: each text matrix,
 * then the text it shows. PDF.js merges a line's words into one text item, which leaves
 * most words with no origin of their own, so this is how the right-hand side of a line gets
 * measured at all. It is still PDF.js reading the saved content, as any viewer does.
 */
const wordsOf = (page) => `(async () => {
  const OPS = ${VIS}.contentWindow.pdfjsLib.OPS;
  const p = await ${APP}.pdfDocument.getPage(${page});
  const v = p.getViewport({ scale: ${SCALE} });
  const [a, b, c, d, e, f] = v.transform;
  const list = await p.getOperatorList();
  const out = [];
  let origin = null;
  for (let i = 0; i < list.fnArray.length; i++) {
    const args = list.argsArray[i];
    // PDF.js 6 passes the six numbers as one Float32Array (pdf.worker.mjs, OPS.setTextMatrix).
    if (list.fnArray[i] === OPS.setTextMatrix) origin = [Number(args[0][4]), Number(args[0][5])];
    if (list.fnArray[i] === OPS.showText && origin) {
      const str = [...args[0]].map((g) => (g && typeof g === 'object' ? g.unicode ?? '' : '')).join('');
      out.push({ str, x: a * origin[0] + c * origin[1] + e, y: b * origin[0] + d * origin[1] + f });
      origin = null;
    }
  }
  return JSON.stringify(out);
})()`;

const fixture = (name) => JSON.parse(readFileSync(join(root, "samples", "ocr", name), "utf8"));

/** Words found as text: the share of the fixture's words present, counting repeats. */
function coverage(items, words) {
  const found = new Map();
  for (const item of items) {
    for (const w of item.str.split(/\s+/).filter(Boolean)) found.set(w, (found.get(w) ?? 0) + 1);
  }
  let hits = 0;
  for (const word of words) {
    const left = found.get(word.text) ?? 0;
    if (left > 0) {
      hits++;
      found.set(word.text, left - 1);
    }
  }
  return hits / words.length;
}

/**
 * Where each word that starts a text item landed, against where it really is. Only an item's
 * first word has an exact origin, so only those are measured. The true word is the nearest
 * fixture word with the same text. Across: the origin against the word's left edge. Down: the
 * origin, on the baseline, against the bottom of the word's box, allowed one word height.
 */
function placements(items, words) {
  const out = [];
  for (const item of items) {
    const first = item.str.trim().split(/\s+/)[0];
    const candidates = words.filter((w) => w.text === first);
    if (candidates.length === 0) continue;
    const truth = candidates.reduce((best, w) =>
      Math.hypot(w.x - item.x, w.y + w.h - item.y) < Math.hypot(best.x - item.x, best.y + best.h - item.y) ? w : best);
    out.push({
      text: first,
      truth,
      across: item.x - truth.x,
      down: item.y - (truth.y + truth.h),
      ok: Math.abs(item.x - truth.x) <= ACROSS && Math.abs(item.y - (truth.y + truth.h)) <= truth.h,
    });
  }
  return out;
}

function worstOf(measured) {
  const across = Math.max(...measured.map((m) => Math.abs(m.across)));
  const down = Math.max(...measured.map((m) => Math.abs(m.down)));
  return `${across.toFixed(1)} px across, ${down.toFixed(1)} px down`;
}

/** Five of them, spread: nearest each corner of the text block, and nearest its centre. */
function spread(measured) {
  const pick = (score) => measured.reduce((best, m) => (score(m.truth) > score(best.truth) ? m : best));
  const cx = (w) => w.x + w.w / 2;
  const cy = (w) => w.y + w.h / 2;
  return [
    ["top left", pick((w) => -(cx(w) + cy(w)))],
    ["top right", pick((w) => cx(w) - cy(w))],
    ["bottom left", pick((w) => cy(w) - cx(w))],
    ["bottom right", pick((w) => cx(w) + cy(w))],
    ["centre", pick((w) => -(Math.abs(cx(w) - 800) + Math.abs(cy(w) - 600)))],
  ];
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
};
const table = [];
const allProblems = [];

if (!existsSync(exe)) {
  console.error(`No release build at ${exe}. Run "npm run tauri build" first, with the Rust PATH set.`);
  process.exit(2);
}
if (!existsSync(join(root, "samples", "scan-three.pdf"))) {
  console.error('No samples/scan-three.pdf. Run "npm run samples" first.');
  process.exit(2);
}
if (running()) {
  console.error("PDFluffer is running. Close it first: it is single-instance, so this test would hand off to your window.");
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), "pdfluffer-ocr-"));
const backup = join(work, "state-backup");
cpSync(join(root, "samples"), join(work, "files"), { recursive: true });
const had = Object.fromEntries(stateFiles.map((f) => [f, existsSync(join(stateDir, f))]));
for (const f of stateFiles) if (had[f]) cpSync(join(stateDir, f), join(backup, f));
// Start from an empty session, as run.mjs does. The finally block puts the user's back.
for (const f of stateFiles) rmSync(join(stateDir, f), { force: true });
const scan = join(work, "files", "scan-three.pdf");
const form = join(work, "files", "form-basic.pdf");
const three = join(work, "files", "three-pages.pdf");
const truths = [fixture("straight.json"), fixture("skew-cw2.json"), fixture("straight.json")];

/** Every page's words present, and five spread words in the right place. */
async function checkText(c, when) {
  for (let page = 1; page <= 3; page++) {
    const items = JSON.parse(await c.ev(itemsOf(page)));
    const words = truths[page - 1].words;
    const share = coverage(items, words);
    check(`${when}: page ${page} holds at least 90% of its words as text`, share >= COVERAGE,
      `${(share * 100).toFixed(1)}% of ${words.length}`);
    if (when !== "after reading") continue;

    // The chip's check, on text-item origins. Only an item's first word has one.
    const starts = placements(items, words);
    const good = starts.filter((m) => m.ok).length;
    check(`page ${page}: every word that starts a text item lands over its word in the picture`, good === starts.length,
      `${good} of ${starts.length}, worst ${worstOf(starts)}`);

    // Every word, from the operator list, so the whole width of the page is measured.
    const all = placements(JSON.parse(await c.ev(wordsOf(page))), words);
    const allGood = all.filter((m) => m.ok).length;
    // Strict on place, and as tolerant as the coverage check on count: a word the engine
    // read as two, or two as one, is a reading matter, not a placement one.
    check(`page ${page}: every word it wrote lands over the same word in the picture`,
      all.length >= COVERAGE * words.length && allGood === all.length, `${allGood} of ${all.length}, worst ${worstOf(all)}`);
    const five = spread(all);
    for (const [where, m] of five) {
      table.push({ page, where, text: m.text, across: m.across, down: m.down, height: m.truth.h, ok: m.ok });
    }
    check(`page ${page}: five spread words, corners and centre, land right`, five.every(([, m]) => m.ok),
      five.map(([where, m]) => `${where} ${m.text}`).join(", "));
  }
}

/** Opens the menu and runs the OCR tool. The first dialog it shows, or null. */
async function runTool(c) {
  await c.ev(openMenu);
  await sleep(400);
  // The item is disabled until the tab is ready, and a click on it then does nothing. A tab
  // opened by a second launch can take a moment, so wait for it rather than click blind.
  if (!(await until(() => c.ev(menuHas(TOOL)), 20000))) return null;
  await c.ev(clickMenuItem(TOOL));
  const shown = await until(() => c.ev(DIALOG), 20000);
  return shown ? JSON.parse(shown) : null;
}

let c;
try {
  launch([scan]);
  c = await connect();
  await c.send("Page.bringToFront");
  check("the scan opens", await until(() => c.ev(pagesLoaded(3)), 40000));

  // 1. Before: pictures only.
  await sleep(1000);
  const before = await c.ev(TEXT_LENGTHS);
  check("before: no page has any text", before === "[0,0,0]", before);

  // 2. The tool is in the menu, asks about all three pages, reads them, and says so.
  await c.ev(openMenu);
  await sleep(400);
  check("the OCR tool is in the Document menu, and enabled", await c.ev(menuHas(TOOL)));
  await c.ev(`document.querySelector('.menu-button').click()`);
  await sleep(300);
  const asked = await runTool(c);
  check("it asks about 3 of 3 pages", asked?.title === "Make text selectable?" && /^3 of 3 pages have no selectable text\./.test(asked?.body ?? ""),
    asked?.body?.slice(0, 60));
  await c.ev(clickButton("Make selectable"));
  let sawProgress = null;
  const done = await until(async () => {
    sawProgress ??= await c.ev(PROGRESS);
    const d = await c.ev(DIALOG);
    const title = d ? JSON.parse(d).title : null;
    return title && title !== "Make text selectable?" && title !== "Reading the pages" ? JSON.parse(d) : null;
  }, 120000, 100);
  check("a progress dialog shows while it reads", sawProgress !== null, sawProgress ?? "never seen");
  check("it finishes with \"Text added\"", done?.title === "Text added", done ? `${done.title}: ${done.body}` : "no dialog");
  await c.ev(clickButton("OK"));
  await until(() => c.ev(`${VIS}?.contentWindow?.PDFViewerApplication?.pdfDocument && !document.querySelector('dialog[open]')`), 15000);
  await sleep(1500);

  // 3 and 4. The words are text now, and they sit over the words in the picture.
  const after = JSON.parse(await c.ev(TEXT_LENGTHS));
  check("after: every page has text", after.every((n) => n > 50), JSON.stringify(after));
  await checkText(c, "after reading");

  // 5. Unsaved until saved. Save, restart, and the text is still there.
  check("the tab is dirty", await c.ev(DIRTY));
  for (const type of ["rawKeyDown", "keyUp"]) {
    await c.send("Input.dispatchKeyEvent", { type, modifiers: 2, key: "s", code: "KeyS", windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83 });
  }
  const first = await until(() => c.ev(DIALOG), 8000);
  await c.ev(clickButton("Overwrite"));
  check("Save and Overwrite clear the dot", first && (await until(() => c.ev(SETTLED), 20000)));
  allProblems.push(...problems(c.events));
  try { c.close(); } catch { /* ignore */ }
  requestClose();
  check("the saved window closes without asking", await waitGone());

  launch([]);
  c = await connect();
  await c.send("Page.bringToFront");
  await until(() => c.ev(pagesLoaded(3)), 40000);
  await sleep(1500);
  const reopened = JSON.parse(await c.ev(TEXT_LENGTHS));
  check("after a restart every page still has its text", reopened.every((n, i) => n === after[i]), JSON.stringify(reopened));
  await checkText(c, "after a restart");

  // 6. A second run finds nothing to do, and adds no second layer.
  const again = await runTool(c);
  check("running it again says \"Nothing to read\"", again?.title === "Nothing to read", again?.title);
  await c.ev(clickButton("OK"));
  await sleep(800);
  check("and adds nothing", (await c.ev(TEXT_LENGTHS)) === JSON.stringify(after) && !(await c.ev(DIRTY)));

  // 7. A file with real text: nothing to read.
  spawnSync(exe, [form], { env, timeout: 20000 });
  await until(() => c.ev(activeIs("form-basic.pdf")), 15000);
  await until(() => c.ev(pagesLoaded(1)), 20000);
  await sleep(1000);
  const typed = await runTool(c);
  check("form-basic.pdf, which has real text, says \"Nothing to read\"", typed?.title === "Nothing to read", typed?.title ?? await c.ev(SCREEN));
  await c.ev(clickButton("OK"));
  await sleep(500);

  // Spec O5 as it stands: three-pages.pdf holds only "Page 1", 5 characters a page, which
  // is under the 50 that O5 counts as a scan. So it is offered, and Cancel leaves it alone.
  spawnSync(exe, [three], { env, timeout: 20000 });
  await until(() => c.ev(activeIs("three-pages.pdf")), 15000);
  await until(() => c.ev(pagesLoaded(3)), 20000);
  await sleep(1000);
  const sparse = await runTool(c);
  check("three-pages.pdf, 5 characters a page, is offered for reading, as O5 says", /^3 of 3 pages/.test(sparse?.body ?? ""), sparse?.body?.slice(0, 40));
  await c.ev(clickButton("Cancel"));
  await sleep(500);
  check("and Cancel leaves it untouched", !(await c.ev(DIRTY)) && !(await c.ev(`!!document.querySelector('dialog[open]')`)));

  // 8. Nothing went wrong anywhere.
  allProblems.push(...problems(c.events));
  try { c.close(); } catch { /* ignore */ }
  requestClose();
  check("a clean window closes without asking", await waitGone());
  const noise = allProblems.filter((p) => !/No available adapters/.test(p));
  check("no console error, CSP violation or native prompt anywhere", noise.length === 0, noise.join(" ; ").slice(0, 400));
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

if (table.length) {
  console.log("\nWhere five spread words landed, in picture pixels (+ is right, and down):");
  console.log("page  where          word         across    down   word height");
  for (const r of table) {
    console.log(`${String(r.page).padEnd(6)}${r.where.padEnd(15)}${r.text.padEnd(13)}${r.across.toFixed(1).padStart(6)}  ${r.down.toFixed(1).padStart(6)}  ${String(r.height).padStart(6)}  ${r.ok ? "ok" : "OUT"}`);
  }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} passed. The user's saved state was restored.`);
process.exit(failed.length ? 1 : 0);
