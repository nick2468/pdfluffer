// Production smoke test. Drives the REAL release build (the exe the installer ships) through
// its WebView2 debugging port, with no human at the window. Run it after any change that
// could affect the desktop app:
//
//   1. With the Rust PATH set:  npm run tauri build
//   2.                          npm run smoke:prod
//
// It proves, in the production build: assets and the CSP load the PDF.js viewer, a PDF passed
// as a launch argument opens (the double-click path), an edit raises the dirty dot, Ctrl+S
// asks once and writes a true incremental save, a second launch hands off to the running
// window, the close dialog's Cancel and Discard work with no native "Leave site?" prompt, the
// session and the page and zoom come back, tabs load lazily, and a Document tool plus Revert
// work (so the pdf-lib chunk loads under the production CSP).
//
// It cannot prove: the installer, the Windows file association, window focus, native file
// dialogs, printing, real drag and drop, or how anything looks. Those stay USER checks.
//
// Safety: it refuses to run while PDFluffer is open (single instance would hijack the launch),
// works on copies of samples/ in a temp folder, and backs up and restores the user's
// state.json and window state, so the user's saved session and recent list are untouched.
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
const clickTab = (name) =>
  `(() => { const t = [...document.querySelectorAll('.tab')].find(t => t.querySelector('.tab-name')?.textContent === ${JSON.stringify(name)}); if (!t) return false; t.click(); return true; })()`;
const pagesLoaded = (n) => `(() => { const a = ${VIS}?.contentWindow?.PDFViewerApplication; return !!a?.pdfDocument && a.pagesCount === ${n}; })()`;
const rotations = `(async () => { const a = ${VIS}.contentWindow.PDFViewerApplication; const out = []; for (let i = 1; i <= a.pagesCount; i++) out.push((await a.pdfDocument.getPage(i)).rotate); return out.join(','); })()`;
const openMenu = `(() => { const b = [...document.querySelectorAll('.tabbar button')].find(b => /menu/i.test(b.getAttribute('aria-label') || b.title || '')); if (!b) return false; b.click(); return true; })()`;
const clickMenuItem = (label) =>
  `(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)})); if (!b) return false; b.click(); return true; })()`;
const textFields = `[...${VIS}.contentDocument.querySelectorAll('.annotationLayer input[type="text"]')]`;
const typeInto = (index, value) =>
  `(() => { const i = ${textFields}[${index}]; i.focus(); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`;
const DIRTY = `!!document.querySelector('.tab.active .tab-dirty')`;
const SETTLED = `!document.querySelector('.tab.active .tab-dirty') && !document.querySelector('dialog[open]')`;

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

const work = mkdtempSync(join(tmpdir(), "pdfluffer-smoke-"));
const backup = join(work, "state-backup");
cpSync(join(root, "samples"), join(work, "files"), { recursive: true });
const had = Object.fromEntries(stateFiles.map((f) => [f, existsSync(join(stateDir, f))]));
for (const f of stateFiles) if (had[f]) cpSync(join(stateDir, f), join(backup, f));
const form = join(work, "files", "form-basic.pdf");
const three = join(work, "files", "three-pages.pdf");
const original = readFileSync(form);
const oneTab = JSON.stringify([{ name: "form-basic.pdf", active: true, dirty: false, signed: false }]);
const twoTabs = JSON.stringify([
  { name: "form-basic.pdf", active: true, dirty: false, signed: false },
  { name: "three-pages.pdf", active: false, dirty: false, signed: false },
]);

try {
  // A. Launch with a file argument: the path a double-click in Explorer takes.
  launch([form]);
  let c = await connect();
  check("loads from embedded assets", c.url.startsWith("http://tauri.localhost"), c.url);
  check("the PDF from the launch argument opens", await until(() => c.ev(pagesLoaded(1)), 40000));
  check("one tab, named after the file", (await c.ev(TABS)) === oneTab, await c.ev(TABS));
  const display = JSON.parse(
    await c.ev(
      `(() => { const d = ${VIS}.contentDocument; const o = {}; for (const id of ['secondaryOpenFile','downloadButton','secondaryDownload','printButton','editorSignatureButton']) o[id] = getComputedStyle(d.getElementById(id)).display; return JSON.stringify(o); })()`,
    ),
  );
  check(
    "PDF.js Open and Download are hidden, Print and Signature are shown",
    display.secondaryOpenFile === "none" && display.downloadButton === "none" && display.secondaryDownload === "none" &&
      display.printButton !== "none" && display.editorSignatureButton !== "none",
    JSON.stringify(display),
  );
  await until(() => c.ev(`${textFields}.length > 0`), 20000);
  await c.ev(typeInto(0, "Smoke Test"));
  check("an edit raises the dirty dot", await until(() => c.ev(DIRTY), 5000));

  // B. Ctrl+S from inside the PDF, the first-save dialog, Overwrite, and the bytes on disk.
  for (const type of ["rawKeyDown", "keyUp"]) {
    await c.send("Input.dispatchKeyEvent", { type, modifiers: 2, key: "s", code: "KeyS", windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83 });
  }
  const first = await until(() => c.ev(DIALOG), 8000);
  check("Ctrl+S inside the PDF opens the first-save dialog", first && JSON.parse(first).buttons.join("|") === "Overwrite|Save As...|Cancel", first ?? "no dialog");
  await c.ev(clickButton("Overwrite"));
  check("the dot clears after Overwrite", await until(() => c.ev(SETTLED), 10000));
  const saved = readFileSync(form);
  check("the file grew and holds the typed value", saved.length > original.length && saved.includes("Smoke Test"), `${original.length} -> ${saved.length} bytes`);
  check("the save is a true incremental update", saved.subarray(0, original.length).equals(original));
  check("no temporary file is left behind", !existsSync(form + ".pdfluffer-tmp"));

  // C. Single instance: a second launch hands its file over and exits.
  const second = spawnSync(exe, [three], { env, timeout: 20000 });
  check("a second launch exits at once", second.status === 0 && !second.error, `status ${second.status}`);
  check(
    "its file opens as a new active tab",
    await until(() => c.ev(`document.querySelectorAll('.tab').length === 2 && document.querySelector('.tab.active .tab-name')?.textContent === 'three-pages.pdf'`), 10000),
    await c.ev(TABS),
  );
  spawnSync(exe, [form], { env, timeout: 20000 });
  await sleep(1500);
  check(
    "launching an already-open file switches to its tab",
    await c.ev(`document.querySelectorAll('.tab').length === 2 && document.querySelector('.tab.active .tab-name')?.textContent === 'form-basic.pdf'`),
    await c.ev(TABS),
  );

  // D. Set a view to restore later, then the close dialog: Cancel keeps, Discard closes.
  await c.ev(clickTab("three-pages.pdf"));
  await until(() => c.ev(pagesLoaded(3)), 15000);
  await c.ev(`(() => { const a = ${VIS}.contentWindow.PDFViewerApplication; a.pdfViewer.currentScaleValue = '1.5'; a.page = 3; })()`);
  await sleep(1500);
  await c.ev(clickTab("form-basic.pdf"));
  await sleep(800);
  await c.ev(typeInto(1, "discard-me"));
  await until(() => c.ev(DIRTY), 5000);
  requestClose();
  const closing = await until(() => c.ev(DIALOG), 8000);
  check("closing with unsaved changes asks Save, Discard, Cancel", closing && JSON.parse(closing).buttons.join("|") === "Save|Discard|Cancel", closing ?? "no dialog");
  await c.ev(clickButton("Cancel"));
  await sleep(1500);
  check("Cancel keeps the window and the unsaved change", running() && (await c.ev(DIRTY)));
  requestClose();
  await until(() => c.ev(DIALOG), 8000);
  await c.ev(clickButton("Discard"));
  check("Discard closes the window", await waitGone());
  allProblems.push(...problems(c.events));
  try { c.close(); } catch { /* the app has gone */ }

  // E. Restart with no argument: the session, lazy loading, the saved value, page and zoom.
  launch([]);
  c = await connect();
  await until(() => c.ev(`document.querySelectorAll('.tab').length === 2`), 20000);
  check("both tabs come back, with the last active one active", (await c.ev(TABS)) === twoTabs, await c.ev(TABS));
  await until(() => c.ev(`(${VIS}?.contentDocument?.querySelectorAll('.annotationLayer input[type="text"]').length ?? 0) > 0`), 20000);
  check("only the active tab has a viewer (lazy loading)", (await c.ev(`document.querySelectorAll('.viewer-host iframe').length`)) === 1);
  const values = await c.ev(`${textFields}.map(i => i.value).join('|')`);
  check("the saved value is there and the discarded one is not", String(values).startsWith("Smoke Test|") && !String(values).includes("discard-me"), values);
  await c.ev(clickTab("three-pages.pdf"));
  await until(() => c.ev(pagesLoaded(3)), 15000);
  await sleep(1500);
  const view = await c.ev(`(() => { const v = ${VIS}.contentWindow.PDFViewerApplication.pdfViewer; return v.currentPageNumber + '@' + v.currentScaleValue; })()`);
  check("page and zoom are restored", view === "3@1.5", view);

  // F. A Document tool, then Revert. The tool needs the lazily loaded pdf-lib chunk.
  await c.ev(openMenu);
  await sleep(400);
  await c.ev(clickMenuItem("Rotate all pages right"));
  await until(() => c.ev(DIRTY), 20000);
  await sleep(1500);
  check("Rotate all pages right turns every page and marks the tab dirty", (await c.ev(rotations)) === "90,90,90", await c.ev(rotations));
  await c.ev(openMenu);
  await sleep(400);
  await c.ev(clickMenuItem("Revert to saved"));
  await until(() => c.ev(DIALOG), 5000);
  await c.ev(clickButton("Revert"));
  await until(() => c.ev(SETTLED), 15000);
  await sleep(1500);
  check("Revert to saved restores the file and clears the dot", (await c.ev(rotations)) === "0,0,0" && !(await c.ev(DIRTY)), await c.ev(rotations));
  allProblems.push(...problems(c.events));
  try { c.close(); } catch { /* ignore */ }
  requestClose();
  check("a clean window closes without asking", await waitGone());
  check("no console error, CSP violation or native prompt anywhere", allProblems.length === 0, allProblems.join(" ; ").slice(0, 400));
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
