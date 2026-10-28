// Build a signed installer, then prove the signature is really there.
//
// PDFluffer's installer is code-signed with Nicholas Walker's Certum open-source
// certificate (2026-10-28). The private key never leaves Certum's SimplySign
// cloud: SimplySign Desktop, once Nick has logged in with the one-time code from
// his phone, presents it to Windows as a smart card, and signtool signs through
// that. So a signed build can only happen while he is logged in, and this script
// is the one place that knows it. Adapted from Tabiya's scripts/build-signed.mjs.
//
// The signing settings live in `src-tauri/tauri.signing.conf.json`, merged in for
// this build alone. A plain `npm run tauri build` never reads that file and stays
// unsigned, so every ordinary packaged build, including the smoke tests, still
// works without Nick.
//
// What is expected comes from the certificate itself, committed as
// `src-tauri/signing/code-signing.cer`. It holds only the public half, the same
// thing every signed file carries for anyone to read. Its thumbprint, subject and
// dates are read from it, never typed here, and the config's thumbprint is checked
// against it. When Certum renews the certificate (yearly), replace that file and
// the thumbprint in the config together; the preflight refuses if they disagree.
//
// Three steps, and a failure at any one stops the rest:
//   1. preflight: the certificate is current and Windows can sign with it now;
//   2. the build, with the signing config merged;
//   3. verify: the installer carries this certificate, a sha256 digest and an
//      RFC 3161 timestamp. The program and uninstaller inside it are checked the
//      same way once installed, by scripts/upgrade-walk.ps1.
//
// Run it with: npm run build:signed
// `node scripts/build-signed.mjs verify [file...]` runs step 3 alone.
import { execFileSync, spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const signingConfig = join(repo, "src-tauri", "tauri.signing.conf.json");
const certificateFile = join(repo, "src-tauri", "signing", "code-signing.cer");

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/** PowerShell, for the certificate store and Authenticode, which Node cannot reach. */
function powershell(script) {
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim();
}

function expectedCertificate() {
  const certificate = new X509Certificate(readFileSync(certificateFile));
  return {
    thumbprint: certificate.fingerprint.replaceAll(":", "").toUpperCase(),
    subject: certificate.subject.replaceAll("\n", ", "),
    validTo: new Date(certificate.validTo),
  };
}

function configuredThumbprint() {
  const config = JSON.parse(readFileSync(signingConfig, "utf8"));
  return String(config.bundle.windows.certificateThumbprint).toUpperCase();
}

/** The newest signtool in the Windows 10/11 SDK, which is where Tauri finds it too. */
function signtool() {
  const kits = "C:\\Program Files (x86)\\Windows Kits\\10\\bin";
  const versions = existsSync(kits) ? readdirSync(kits).filter((name) => /^10\./.test(name)).sort().reverse() : [];
  for (const version of versions) {
    const path = join(kits, version, "x64", "signtool.exe");
    if (existsSync(path)) return path;
  }
  fail("signtool.exe was not found. Install the Windows SDK signing tools.");
}

function preflight() {
  const expected = expectedCertificate();
  if (configuredThumbprint() !== expected.thumbprint) {
    fail(
      `The thumbprint in src-tauri/tauri.signing.conf.json does not match ` +
        `src-tauri/signing/code-signing.cer (${expected.thumbprint}). After a renewal, replace both together.`,
    );
  }
  if (expected.validTo.getTime() <= Date.now()) {
    fail(`The signing certificate expired on ${expected.validTo.toDateString()}. Renew it with Certum.`);
  }
  // SimplySign Desktop puts the certificate in the personal store while Nick is
  // logged in, and takes it away when the session ends.
  const found = powershell(
    `$c = Get-ChildItem Cert:\\CurrentUser\\My, Cert:\\LocalMachine\\My -ErrorAction SilentlyContinue | ` +
      `Where-Object { $_.Thumbprint -eq '${expected.thumbprint}' -and $_.HasPrivateKey } | Select-Object -First 1; ` +
      `if ($c) { 'yes' } else { 'no' }`,
  );
  if (found !== "yes") {
    fail(
      "Log in to SimplySign Desktop first: the signing certificate is not available.\n" +
        "Right-click the SimplySign icon by the clock, choose Connect to SimplySign, and enter the code from the phone app.",
    );
  }
  console.log(`Signing as ${expected.subject}, valid until ${expected.validTo.toDateString()}.`);
}

function build() {
  // Cargo is not on this machine's PATH by default.
  const env = { ...process.env, PATH: `${join(homedir(), ".cargo", "bin")}${delimiter}${process.env.PATH}` };
  const result = spawnSync("npx", ["tauri", "build", "--config", signingConfig], { cwd: repo, env, stdio: "inherit", shell: true });
  if (result.status !== 0) fail("The signed build failed. Nothing was verified.");
}

/** The one signed file the build leaves on disk: the installer. The program and the
 *  uninstaller are signed inside it and are checked after installing. */
function builtFiles() {
  const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
  return [join(repo, "src-tauri", "target", "release", "bundle", "nsis", `PDFluffer_${version}_x64-setup.exe`)];
}

function verify(files) {
  const expected = expectedCertificate();
  const tool = signtool();
  let faults = 0;
  for (const file of files) {
    const problems = [];
    if (!existsSync(file)) {
      console.log(`MISSING  ${file}`);
      faults++;
      continue;
    }
    const signature = JSON.parse(
      powershell(
        `$s = Get-AuthenticodeSignature -LiteralPath '${file.replaceAll("'", "''")}'; ` +
          `[pscustomobject]@{ status = [string]$s.Status; signer = $s.SignerCertificate.Thumbprint; ` +
          `stamped = [bool]$s.TimeStamperCertificate } | ConvertTo-Json -Compress`,
      ),
    );
    if (signature.status !== "Valid") problems.push(`signature is ${signature.status}`);
    if (signature.signer !== expected.thumbprint) problems.push(`signed by ${signature.signer ?? "nobody"}`);
    if (!signature.stamped) problems.push("no timestamp");
    const detail = spawnSync(tool, ["verify", "/pa", "/v", file], { encoding: "utf8" }).stdout ?? "";
    if (!/Hash of file \(sha256\)/i.test(detail)) problems.push("digest is not sha256");
    if (!/timestamped/i.test(detail)) problems.push("signtool sees no timestamp");
    console.log(`${problems.length ? "FAULT" : "OK"}       ${file}${problems.length ? `: ${problems.join(", ")}` : ""}`);
    faults += problems.length ? 1 : 0;
  }
  if (faults) fail(`${faults} of ${files.length} files are not signed as expected.`);
  console.log(`\nAll ${files.length} files are signed by ${expected.subject}, sha256, timestamped.`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "verify") {
  verify(rest.length ? rest.map((file) => resolve(file)) : builtFiles());
} else if (command === "preflight") {
  preflight();
} else {
  preflight();
  build();
  verify(builtFiles());
  console.log("Now install it with scripts/upgrade-walk.cmd and read its log (docs/releasing.md).");
}
