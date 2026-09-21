// Proves the last phase 2 acceptance criterion (spec 17): "the Settings backup checkbox
// works", end to end in the REAL release build. The pieces were each unit tested, but the
// chain from the checkbox to a file on disk was not:
//
//   the checkbox -> updateSettings -> saveFlow -> the x-backup header -> Rust write_atomic
//
// Run it the way you run the smoke test, with PDFluffer closed and after a tauri build:
//
//   node scripts/prod-smoke/backup.mjs
//
// Same safety as run.mjs: it refuses to run while PDFluffer is open, works on copies of
// samples/ in a temp folder, and backs up and restores the user's own saved state.
import { execSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, sleep, until, problems } from "./cdp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const exe = join(root, "src-tauri", "target", "release", "pdfluffer.exe");
const stateDir = join(process.env.APPDATA ?? "", "com.pdfluffer.desktop");
const stateFiles = ["state.json", ".window-state.json"];
const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9223" };

const running = () => /pdfluffer\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq pdfluffer.exe" /NH', { encoding: "utf8" }));
const requestClose = () =>
  execSync('powershell -NoProfile -Command "(Get-Process pdfluffer | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1).CloseMainWindow() | Out-Null"');

const results = [];
const check = (name, ok, detail = "") => {
  results.push(!!ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
};

if (!existsSync(exe)) { console.error("No release build."); process.exit(2); }
if (running()) { console.error("PDFluffer is running. Close it first."); process.exit(2); }

const VIS = `[...document.querySelectorAll('.viewer-host iframe')].find(f => getComputedStyle(f).visibility !== 'hidden')`;
const openMenu = `(() => { const b = [...document.querySelectorAll('.tabbar button')].find(b => /menu/i.test(b.getAttribute('aria-label') || '')); b.click(); return true; })()`;
const clickMenuItem = (label) =>
  `(() => { const b = [...document.querySelectorAll('.menu-list button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!b) return 'not found'; b.click(); return true; })()`;
const textFields = `[...${VIS}.contentDocument.querySelectorAll('.annotationLayer input[type="text"]')]`;
const typeInto = (index, value) =>
  `(() => { const i = ${textFields}[${index}]; i.focus(); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`;
const DIRTY = `!!document.querySelector('.tab.active .tab-dirty')`;
const CLEAN = `!document.querySelector('.tab.active .tab-dirty') && !document.querySelector('dialog[open]')`;

const work = mkdtempSync(join(tmpdir(), "pdfluffer-backup-"));
const backupDir = join(work, "state-backup");
cpSync(join(root, "samples"), join(work, "files"), { recursive: true });
const had = Object.fromEntries(stateFiles.map((f) => [f, existsSync(join(stateDir, f))]));
for (const f of stateFiles) if (had[f]) cpSync(join(stateDir, f), join(backupDir, f));
for (const f of stateFiles) rmSync(join(stateDir, f), { force: true });

const form = join(work, "files", "form-basic.pdf");
const backupFile = join(work, "files", "form-basic.backup.pdf");
const original = readFileSync(form);

try {
  spawn(exe, [form], { env, stdio: "ignore" });
  const c = await connect();
  check("the file opened", await until(() => c.ev(`(() => { const a = ${VIS}?.contentWindow?.PDFViewerApplication; return !!a?.pdfDocument; })()`), 40000));

  // 1. The checkbox, through the real Settings dialog.
  await c.ev(openMenu);
  await c.ev(clickMenuItem("Settings..."));
  await sleep(600);
  const label = `[...document.querySelectorAll('dialog[open] .setting')].find(l => /backup/i.test(l.textContent))`;
  check("the Settings dialog shows a backup checkbox", await c.ev(`!!${label}`), await c.ev(`${label}?.textContent.trim()`));
  check("it starts unticked", (await c.ev(`${label}.querySelector('input').checked`)) === false);
  await c.ev(`${label}.querySelector('input').click()`);
  await sleep(400);
  check("ticking it sticks", (await c.ev(`${label}.querySelector('input').checked`)) === true);
  await c.ev(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.trim() === 'Close').click()`);
  await sleep(400);

  // 2. Edit and save: the backup should appear.
  check("no backup before the first save", !existsSync(backupFile));
  await until(() => c.ev(`${textFields}.length > 0`), 20000);
  await c.ev(typeInto(0, "Backup Check"));
  check("the edit raised the dot", await until(() => c.ev(DIRTY), 8000));
  await c.ev(`document.querySelector('.save-button').click()`);
  await sleep(600);
  await c.ev(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.trim() === 'Overwrite').click()`);
  check("the save finished", await until(() => c.ev(CLEAN), 15000));

  const made = existsSync(backupFile);
  check("the backup file was made", made, backupFile.split("\\").pop());
  if (made) {
    check("the backup holds the ORIGINAL bytes", Buffer.compare(readFileSync(backupFile), original) === 0,
      `${statSync(backupFile).size} bytes, original ${original.length}`);
    check("the saved file changed", readFileSync(form).length !== original.length,
      `${readFileSync(form).length} bytes`);
  }

  // 3. "One backup, made once, never overwritten."
  const firstBackup = made ? readFileSync(backupFile) : null;
  await c.ev(typeInto(0, "Backup Check Twice"));
  await until(() => c.ev(DIRTY), 8000);
  await c.ev(`document.querySelector('.save-button').click()`);
  check("the second save asked nothing", await until(() => c.ev(CLEAN), 15000));
  check("the backup is still the original, not the first save",
    firstBackup && Buffer.compare(readFileSync(backupFile), original) === 0 && Buffer.compare(readFileSync(backupFile), firstBackup) === 0);

  // 4. And the setting survives a restart.
  requestClose();
  await until(async () => !running(), 12000);
  await sleep(1500);
  spawn(exe, [], { env, stdio: "ignore" });
  const d = await connect();
  await sleep(2500);
  await d.ev(openMenu);
  await d.ev(clickMenuItem("Settings..."));
  await sleep(700);
  check("the setting came back ticked after a restart", (await d.ev(`${label}.querySelector('input').checked`)) === true);
  await d.ev(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.trim() === 'Close').click()`);

  const noise = [...problems(c.events), ...problems(d.events)].filter((p) => !/No available adapters/.test(p));
  check("no console error or native prompt", noise.length === 0, noise.slice(0, 3).join(" | "));
  d.close();
  c.close();
} finally {
  if (running()) { try { requestClose(); } catch {} await until(async () => !running(), 12000); }
  for (const f of stateFiles) {
    if (had[f]) cpSync(join(backupDir, f), join(stateDir, f));
    else rmSync(join(stateDir, f), { force: true });
  }
  rmSync(work, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} passed. The user's saved state was restored.`);
  process.exit(passed === results.length ? 0 : 1);
}
