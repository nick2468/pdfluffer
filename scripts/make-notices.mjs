// Spec 22.3. Writes public/licences.txt: PDFluffer's own licence, then the licence and notice
// files of every third-party component the installed app holds. Plain Node, no dependency.
//
//   npm run notices               regenerate the file
//   npm run notices -- --check    exit 1 when the committed file is out of date
//
// npm: the production packages in package-lock.json (entries not marked dev), each read from
// its node_modules folder, plus PDF.js (public/pdfjs/LICENSE) and PDFium (its own licence
// inside @embedpdf/pdfium). Rust: `cargo metadata --offline`, following only normal
// dependencies from the pdfluffer crate, each read from its folder in the Cargo registry.
//
// The same text appears once, after the list of every component it covers. The output has
// \n line endings and a fixed order, so a rerun on the same tree gives the same bytes. It
// never holds a path from this machine: only file names.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "licences.txt");
const RUST_TARGET = "x86_64-pc-windows-msvc";
const LICENCE_FILE = /^(licen[cs]e|copying|notice|unlicense)/i;
const RULE = "=".repeat(78);
const THIN = "-".repeat(78);

/** Line endings to \n, no trailing spaces, no blank lines at either end, no byte order mark. */
function normalise(text) {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

/** The licence and notice files directly in a folder, by name. */
function licenceFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENCE_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort(byText);
}

function byText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A repository address as written in a package.json, made readable. */
function repositoryOf(pkg) {
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const url = repo || pkg.homepage || "";
  return url
    .replace(/^git\+/, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "");
}

/**
 * One component: what the reader sees, and where its licence texts come from.
 * `files` are [shown name, absolute path] pairs. The absolute path is never written out.
 */
function component(kind, name, version, licence, repository, files) {
  return { kind, name, version, licence: licence || "not stated", repository, files };
}

function npmComponents() {
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  const out = [];
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key || entry.dev) continue;
    const dir = join(ROOT, key);
    const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const files = licenceFiles(dir)
      // PDFium's own licence is listed under PDFium, below.
      .filter((file) => !(name === "@embedpdf/pdfium" && file === "LICENSE.pdfium"))
      .map((file) => [file, join(dir, file)]);
    out.push(component("npm", name, entry.version ?? pkg.version, entry.license ?? pkg.license, repositoryOf(pkg), files));
  }

  const pdfium = join(ROOT, "node_modules", "@embedpdf", "pdfium");
  const pdfiumPkg = JSON.parse(readFileSync(join(pdfium, "package.json"), "utf8"));
  out.push(component("npm", "PDFium", `as built into @embedpdf/pdfium ${pdfiumPkg.version}`,
    "BSD-3-Clause, with the notices of the libraries it contains", "https://pdfium.googlesource.com/pdfium",
    [["LICENSE.pdfium", join(pdfium, "LICENSE.pdfium")]]));

  const pdfjs = join(ROOT, "public", "pdfjs");
  const version = /const version = "([^"]+)"/.exec(readFileSync(join(pdfjs, "build", "pdf.mjs"), "utf8"))?.[1];
  if (!version) throw new Error("Could not read the PDF.js version from public/pdfjs/build/pdf.mjs.");
  out.push(component("npm", "PDF.js", version, "Apache-2.0", "https://github.com/mozilla/pdf.js",
    [["LICENSE", join(pdfjs, "LICENSE")]]));
  return out;
}

function cargoMetadata() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const bin = join(home, ".cargo", "bin");
  const cargo = existsSync(join(bin, "cargo.exe")) ? join(bin, "cargo.exe") : "cargo";
  const env = { ...process.env, PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}` };
  const result = spawnSync(cargo, [
    "metadata", "--format-version", "1", "--offline", "--filter-platform", RUST_TARGET,
  ], { cwd: join(ROOT, "src-tauri"), env, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (result.error) throw new Error(`Could not run cargo: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`cargo metadata failed:\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function rustComponents() {
  const meta = cargoMetadata();
  const packages = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const root = meta.packages.find((p) => p.name === "pdfluffer");
  if (!root) throw new Error("cargo metadata has no pdfluffer package.");

  // Normal dependencies only: a kind of null. Build and dev dependencies are not shipped.
  const seen = new Set();
  const stack = [root.id];
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (dep.dep_kinds.some((k) => k.kind === null)) stack.push(dep.pkg);
    }
  }
  seen.delete(root.id);

  return [...seen].map((id) => {
    const p = packages.get(id);
    const dir = dirname(p.manifest_path);
    const files = licenceFiles(dir).map((file) => [file, join(dir, file)]);
    // A crate may name its licence file elsewhere in its folder.
    if (p.license_file) {
      const path = resolve(dir, p.license_file);
      const shown = p.license_file.replace(/\\/g, "/");
      if (existsSync(path) && !files.some(([, f]) => f === path)) files.push([shown, path]);
    }
    return component("rust", p.name, p.version, p.license, p.repository || p.homepage || "", files);
  });
}

function label(c) {
  return `${c.name} ${c.version}`;
}

function makeNotices() {
  const own = normalise(readFileSync(join(ROOT, "LICENSE"), "utf8"));
  const all = [...npmComponents(), ...rustComponents()].sort((a, b) =>
    byText(a.name.toLowerCase(), b.name.toLowerCase()) || byText(a.name, b.name)
    || byText(a.version, b.version) || byText(a.kind, b.kind));

  // Each distinct text once, in the order the sorted components first reach it.
  const texts = new Map();   // text -> [{ component, file }]
  const bare = [];
  for (const c of all) {
    if (c.files.length === 0) {
      bare.push(c);
      continue;
    }
    for (const [file, path] of c.files) {
      const text = normalise(readFileSync(path, "utf8"));
      if (!texts.has(text)) texts.set(text, []);
      texts.get(text).push({ c, file });
    }
  }

  const npmCount = all.filter((c) => c.kind === "npm").length;
  const rustCount = all.length - npmCount;
  const lines = [
    "PDFluffer licence notices",
    RULE,
    "",
    "PDFluffer's own licence comes first. Then come the licences of the components bundled",
    `with it: ${npmCount} JavaScript packages, PDF.js and PDFium among them, and ${rustCount} Rust crates`,
    "compiled into pdfluffer.exe. Each licence text appears once, after the list of every",
    "component it covers. Written by scripts/make-notices.mjs. Do not edit it by hand.",
    "",
    "",
    "PDFluffer",
    RULE,
    "",
    own,
    "",
    "",
    "Components",
    RULE,
    "",
    "kind  name and version  licence  source",
    "",
    ...all.map((c) => `${c.kind === "npm" ? "js  " : "rust"}  ${label(c)}  ${c.licence}${c.repository ? `  ${c.repository}` : ""}`),
  ];

  let n = 0;
  for (const [text, users] of texts) {
    n++;
    lines.push("", "", RULE, `Licence text ${n} of ${texts.size}. It covers:`, "");
    for (const { c, file } of users) lines.push(`  ${label(c)} (${c.licence}), from its file ${file}`);
    lines.push(THIN, "", text);
  }

  if (bare.length > 0) {
    lines.push("", "", RULE, "Components that ship no licence file", "",
      "These components declare their licence but carry no licence file. The full text of each",
      "licence named is above, under another component, or at the source address.", "");
    for (const c of bare) lines.push(`  ${label(c)} (${c.licence})${c.repository ? `  ${c.repository}` : ""}`);
  }

  return { text: `${lines.join("\n")}\n`, npm: npmCount, rust: rustCount, texts: texts.size, bare };
}

function main() {
  const check = process.argv.includes("--check");
  let result;
  try {
    result = makeNotices();
  } catch (err) {
    console.error(`make-notices: ${err.message}`);
    process.exit(1);
  }
  const summary = `${result.npm} JavaScript components, ${result.rust} Rust crates, ` +
    `${result.texts} distinct texts, ${Buffer.byteLength(result.text)} bytes`;
  if (check) {
    const committed = existsSync(OUT) ? readFileSync(OUT, "utf8") : null;
    if (committed !== result.text) {
      console.error(committed === null
        ? "make-notices: public/licences.txt is missing. Run `npm run notices` and commit it."
        : "make-notices: public/licences.txt is out of date with the installed packages. " +
          "Run `npm run notices` and commit the result.");
      process.exit(1);
    }
    console.log(`make-notices: public/licences.txt is up to date (${summary}).`);
    return;
  }
  writeFileSync(OUT, result.text);
  console.log(`make-notices: wrote public/licences.txt (${summary}).`);
  if (result.bare.length > 0) {
    console.log(`No licence file: ${result.bare.map((c) => `${label(c)} (${c.kind})`).join(", ")}`);
  }
}

main();
