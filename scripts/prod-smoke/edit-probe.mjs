// Text-editing engine probe (plan P6.5, chip 14). Drives the REAL release build through its
// WebView2 debugging port, like run.mjs, and proves the PDFium engine where the production
// CSP, the app's own asset serving and the Rust font command all apply:
//
//   1. With the Rust PATH set:  npm run tauri build
//   2.                          node scripts/prod-smoke/edit-probe.mjs
//
// There is no editor UI yet (chip 15), so it calls the registered engine from the page through
// the test hook, `window.__pdfluffer_test__`, which the app sets up only in a development build
// or when it is launched with the PDFLUFFER_TEST_HOOK argument (BUILD-NOTES decision 26).
//
// It proves: the app starts without fetching PDFium's chunk or its .wasm, and fetches both from
// its own origin at the first engine call; listRuns finds "Page 1" in samples/three-pages.pdf;
// a replace of it with "Page one" runs, with its font notes; that edit, run through
// SessionManager.runOp, loads into the tab, where PDF.js reads "Page one" and not "Page 1";
// the new text is drawn in a real Windows font, not a PDFium standard font; renderPage draws;
// readSystemFont('arial.ttf') answers through the engine's own font source; and nothing logs a
// console error, a CSP violation or an exception.
//
// Safety, as run.mjs: it refuses to run while PDFluffer is open (single instance would hijack
// the launch), works on a copy of samples/ in a temp folder, backs up, clears and restores the
// user's state.json and window state, and closes the window with Discard, so no file changes.
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
const TEST_HOOK = "PDFLUFFER_TEST_HOOK";

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
const APP = `${VIS}.contentWindow.PDFViewerApplication`;
const pagesLoaded = (n) => `(() => { const a = ${VIS}?.contentWindow?.PDFViewerApplication; return !!a?.pdfDocument && a.pagesCount === ${n}; })()`;
const DIRTY = `!!document.querySelector('.tab.active .tab-dirty')`;
const HOOK = `window.__pdfluffer_test__`;
const ENGINE = `${HOOK}.engines.findAdapter('text.edit')`;
/** PDFium's chunk and .wasm among everything the page has fetched so far. */
const FETCHED = `JSON.stringify(performance.getEntriesByType('resource').map(e => e.name)
  .filter(n => /\\/assets\\/(index\\.browser-[^/]*\\.js|pdfium-[^/]*\\.wasm)$/.test(n)))`;
/** Page 1's text as PDF.js reads it. */
const PAGE_ONE_TEXT = `(async () => {
  const t = await (await ${APP}.pdfDocument.getPage(1)).getTextContent();
  return t.items.map(i => i.str ?? '').join(' ');
})()`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
};

if (!existsSync(exe)) {
  console.error(`No release build at ${exe}. Run "npm run tauri build" first, with the Rust PATH set.`);
  process.exit(2);
}
if (running()) {
  console.error("PDFluffer is running. Close it first: it is single-instance, so this probe would hand off to your window.");
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), "pdfluffer-edit-probe-"));
const backup = join(work, "state-backup");
cpSync(join(root, "samples"), join(work, "files"), { recursive: true });
const had = Object.fromEntries(stateFiles.map((f) => [f, existsSync(join(stateDir, f))]));
for (const f of stateFiles) if (had[f]) cpSync(join(stateDir, f), join(backup, f));
for (const f of stateFiles) rmSync(join(stateDir, f), { force: true });
const three = join(work, "files", "three-pages.pdf");
const original = readFileSync(three);
const BYTES = `Uint8Array.from(atob(${JSON.stringify(original.toString("base64"))}), ch => ch.charCodeAt(0))`;

let c;
try {
  launch([three, TEST_HOOK]);
  c = await connect();
  await c.send("Page.bringToFront");
  check("three-pages.pdf opens in the release build", await until(() => c.ev(pagesLoaded(3)), 40000));
  check("the test hook is there, with the PDFium engine registered",
    await until(() => c.ev(`!!${HOOK} && ${ENGINE}?.name === 'PDFium'`), 10000));
  await sleep(1500);
  check("PDFium's chunk and .wasm are not fetched at start", (await c.ev(FETCHED)) === "[]", await c.ev(FETCHED));

  // 1. listRuns finds "Page 1".
  const runs = await c.ev(`(async () => JSON.stringify(await ${ENGINE}.listRuns(${BYTES}, 0)))()`);
  const listed = typeof runs === "string" ? JSON.parse(runs) : [];
  const target = listed.find((r) => r.text === "Page 1");
  check("listRuns on page 1 finds \"Page 1\"", !!target && target.editable, typeof runs === "string" ? listed.map((r) => r.text).join(" | ") : JSON.stringify(runs));
  const fetched = JSON.parse(await c.ev(FETCHED));
  check("the first engine call fetches PDFium's chunk and .wasm from the app's own origin",
    fetched.length === 2 && fetched.every((u) => u.startsWith("http://tauri.localhost/assets/")), fetched.join(", "));
  if (!target) throw new Error("no \"Page 1\" run to edit");
  const locator = JSON.stringify({ pageIndex: 0, text: target.text, bbox: target.bbox });
  const edits = `[{ kind: 'replace', target: ${locator}, text: 'Page one' }]`;

  // 2. applyEdits, and its font notes.
  const applied = await c.ev(`(async () => {
    const r = await ${ENGINE}.applyEdits(${BYTES}, ${edits});
    const runs = await ${ENGINE}.listRuns(r.bytes, 0);
    return JSON.stringify({ notes: r.notes, size: r.bytes.length, runs: runs.map(x => ({ text: x.text, font: x.fontName, size: x.fontSize })) });
  })()`);
  const result = typeof applied === "string" ? JSON.parse(applied) : null;
  check("applyEdits replaces \"Page 1\" with \"Page one\"", result?.runs.some((r) => r.text === "Page one") && !result.runs.some((r) => r.text === "Page 1"),
    result ? JSON.stringify(result.runs) : JSON.stringify(applied));
  console.log(`      font notes: ${JSON.stringify(result?.notes)}; the file went from ${original.length} to ${result?.size} bytes`);
  const font = result?.runs.find((r) => r.text === "Page one")?.font ?? "";
  check("the new text is drawn in a Windows font, not a PDFium standard font",
    font !== "" && !/^(Helvetica|Times|Courier)/.test(font), font);

  // 3. The same edit through runOp: the result loads in the tab, and PDF.js reads it back.
  const tabId = await c.ev(`${HOOK}.manager.getSnapshot().activeTabId`);
  const changed = await c.ev(`${HOOK}.manager.runOp(${JSON.stringify(tabId)}, { kind: 'text.edits', edits: ${edits} })`);
  check("runOp runs the text edit and marks the tab unsaved", changed === true && (await until(() => c.ev(DIRTY), 10000)), String(changed));
  await until(() => c.ev(pagesLoaded(3)), 20000);
  const text = await until(async () => {
    const t = await c.ev(PAGE_ONE_TEXT);
    return typeof t === "string" && t.includes("Page one") ? t : null;
  }, 20000);
  check("PDF.js reads \"Page one\" in the tab, and not \"Page 1\"", !!text && !text.includes("Page 1"), JSON.stringify(text ?? (await c.ev(PAGE_ONE_TEXT))));

  // renderPage draws in the release build too.
  const drawn = await c.ev(`(async () => {
    const p = await ${ENGINE}.renderPage(${BYTES}, 0, 800);
    let ink = 0; for (let i = 0; i < p.rgba.length; i += 4) if (p.rgba[i] < 128) ink++;
    return JSON.stringify({ width: p.width, height: p.height, ink });
  })()`);
  const picture = typeof drawn === "string" ? JSON.parse(drawn) : null;
  check("renderPage draws page 1", picture && Math.max(picture.width, picture.height) === 800 && picture.ink > 1000, JSON.stringify(drawn));

  // 4. The engine's own font source reads a Windows font.
  const arial = await c.ev(`(async () => { const b = await ${ENGINE}.fontSource('arial.ttf'); return b ? b.length : null; })()`);
  check("readSystemFont('arial.ttf') through the engine's source is not null", typeof arial === "number" && arial > 100000, `${arial} bytes`);
  const refused = await c.ev(`(async () => { try { await ${ENGINE}.fontSource('..\\\\arial.ttf'); return 'read'; } catch (e) { return e.message; } })()`);
  check("a name off the allowlist is refused", refused !== "read", String(refused));

  // 5. Close without saving, so no file changes.
  requestClose();
  const closing = await until(() => c.ev(DIALOG), 8000);
  if (closing) await c.ev(clickButton("Discard"));
  check("the window closes with Discard", await waitGone());
  check("the sample file on disk is unchanged", readFileSync(three).equals(original));
  const seen = problems(c.events);
  check("no console error, CSP violation or exception", seen.length === 0, seen.join(" ; ").slice(0, 600));
} catch (err) {
  check("the probe completed", false, String(err?.stack ?? err).slice(0, 400));
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
