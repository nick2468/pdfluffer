// Makes the OCR test pictures in samples/ocr/, with every word's true position (plan P4.1).
//
//   node scripts/make-ocr-fixtures.mjs
//
// A development tool, not part of the app. It drives a headless Edge with a throwaway
// profile over the DevTools protocol: it writes a small HTML page, screenshots it, and
// reads each word's true box straight from the page with getBoundingClientRect(). So the
// positions are measured, not calculated, and the OCR tests have something to be right or
// wrong against.
//
// Three pictures come out of the browser: the page straight, and the same page turned two
// degrees each way about the picture's centre. The fourth, too-large.png, is written here
// in Node, because it is bigger than any browser will screenshot.
//
// Traps this script has already paid for (BUILD-NOTES decision 15): a hidden page never
// fires requestAnimationFrame and never paints, so Page.bringToFront comes first; and the
// browser profile is thrown away afterwards, so it can never touch the user's own.
import { execSync, spawn } from "node:child_process";
import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, sleep } from "./prod-smoke/cdp.mjs";

const PORT = 9224;
const WIDTH = 1600;
const HEIGHT = 1200;
const SKEW = 2;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "samples", "ocr");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

// Plain words the engine will not have to guess at, plus one line of digits and one in
// capitals. The lines run nearly the full width on purpose: a rotation moves a word further
// the further it sits from the centre, so words near the edges are what catch a wrong
// mapping. A short line down the middle would agree with almost any rule.
const LINES = [
  "The quick brown fox jumps over the lazy dog beside a wide river in the morning",
  "Invoice number and date are printed below with the total amount payable this month",
  "0123456789 4567 8901 2345 6789 0246 8135 7902 4681 3579 2468 1357 9024 6813",
  "CAPITAL LETTERS FOR TESTING THE ENGINE ON UPPER CASE WORDS ACROSS A WIDE PAGE",
  "Please sign and return this form to the address shown on the back page before the date",
  "Reference code alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo",
  "Signature of the account holder is required here with the date and a contact number",
  "Thank you for your business today and for choosing to pay by the method that suits you",
  "Every page of this document carries a header and a footer with the same reference",
  "Read each line carefully and check that the words match what you expect to find here",
];

function page(degrees) {
  const body = LINES.map(
    (line) => `<div class="line">${line.split(" ").map((w) => `<span>${w}</span>`).join(" ")}</div>`,
  ).join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  #block {
    position: absolute; inset: 0;
    transform-origin: ${WIDTH / 2}px ${HEIGHT / 2}px;
    transform: rotate(${degrees}deg);
  }
  .line {
    margin: 0 0 72px 120px;
    font: 28px Arial, sans-serif;
    color: #000;
    white-space: nowrap;
  }
  .line:first-child { margin-top: 120px; }
</style></head>
<body><div id="block">
${body}
</div></body></html>`;
}

/** Every word's text and box, measured in the page itself. */
const MEASURE = `JSON.stringify([...document.querySelectorAll('#block span')].map((s) => {
  const r = s.getBoundingClientRect();
  return {
    text: s.textContent,
    x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2),
    cx: +(r.x + r.width / 2).toFixed(2), cy: +(r.y + r.height / 2).toFixed(2),
  };
}))`;

/** A plain white PNG, written by hand so no image library is needed. */
function whitePng(width, height) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeInt32BE(crc(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;   // 8 bits per sample
  header[9] = 0;   // greyscale
  // One filter byte per row, then the row itself, all white.
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width, 0xff)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) | 0;
}

const work = mkdtempSync(join(tmpdir(), "ocr-fixtures-"));
const profile = join(work, "edge-profile");
let edge;
try {
  if (!existsSync(EDGE)) throw new Error(`No Edge at ${EDGE}`);
  mkdirSync(out, { recursive: true });
  mkdirSync(profile, { recursive: true });
  edge = spawn(EDGE, [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });

  const c = await connect(PORT);
  // A hidden page paints nothing, so every screenshot would come back blank.
  await c.send("Page.bringToFront");
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
  });

  for (const [name, degrees] of [["straight", 0], ["skew-cw2", SKEW], ["skew-ccw2", -SKEW]]) {
    const file = join(work, `${name}.html`);
    writeFileSync(file, page(degrees));
    await c.send("Page.navigate", { url: `file:///${file.replace(/\\/g, "/")}` });
    await sleep(900);
    const shot = await c.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 },
    });
    const data = shot.result?.data;
    if (!data) throw new Error(`no screenshot for ${name}`);
    writeFileSync(join(out, `${name}.png`), Buffer.from(data, "base64"));

    const words = JSON.parse(await c.ev(MEASURE));
    if (words.length === 0) throw new Error(`no words measured for ${name}`);
    writeFileSync(
      join(out, `${name}.json`),
      // The centre is the honest number for a turned word: the box of a rotated rectangle
      // grows, but its centre is exactly the rotated centre.
      JSON.stringify({ image: `${name}.png`, width: WIDTH, height: HEIGHT, rotationDeg: degrees, words }, null, 2) + "\n",
    );
    console.log(`${name}.png  ${words.length} words`);
  }
  c.close();

  // The engine refuses anything wider or taller than MaxImageDimension. This machine says
  // 10000, read at run time by ocr_status; 200 wider is enough to be refused.
  const limit = Number(process.argv[2] ?? 10000);
  const tooLarge = whitePng(limit + 200, 100);
  writeFileSync(join(out, "too-large.png"), tooLarge);
  console.log(`too-large.png  ${limit + 200} by 100, ${tooLarge.length} bytes`);
} finally {
  // Killing the process we spawned leaves its renderers holding the profile, so the whole
  // tree goes by the profile path. Nothing else can match it: the folder name is fresh.
  edge?.kill();
  try {
    execSync(
      // Matched on the temp folder's name alone: PowerShell's -like treats a backslash as
      // an ordinary character, so a full path would have to be escaped and is not worth it.
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='msedge.exe'\\" | ` +
        `Where-Object { $_.CommandLine -like '*${basename(work)}*' } | ` +
        `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: "ignore" },
    );
  } catch { /* nothing to kill */ }
  // Windows releases the files a moment after the processes go.
  for (let i = 0; i < 10; i++) {
    try { rmSync(work, { recursive: true, force: true }); break; } catch { await sleep(500); }
  }
  if (existsSync(work)) console.warn(`Could not delete ${work}. Delete it by hand.`);
}
