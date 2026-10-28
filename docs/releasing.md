# Releasing PDFluffer

How a version goes from `main` to a signed installer on the GitHub releases page. Adapted
from Tabiya's `docs/releasing.md` on 2026-10-28, when PDFluffer's installer was first signed.

## What signing needs

The installer, the program and the uninstaller are signed with Nicholas Walker's Certum
"Open Source Code Signing in the Cloud" certificate. Windows shows the publisher as
**Open Source Developer Nicholas Walker**. The certificate is for open-source software only.

The private key lives in Certum's SimplySign cloud, never on this machine. SimplySign
Desktop makes it look like a smart card to Windows, but only while Nick is logged in. So
**a signed build needs Nick present**, logged in with the one-time code from the SimplySign
phone app. A session never asks for that code, and it never goes in a file or on a command
line.

An ordinary `npm run tauri build` stays unsigned and needs nobody. Only `npm run build:signed`
signs.

## The publisher, set once

`bundle.publisher` in `src-tauri/tauri.conf.json` is `Nicholas Walker`. **Never change it.**
Tauri names a registry key after it, `HKCU\Software\Nicholas Walker\PDFluffer`, and an
upgrade reads the old install's folder from that key. Tabiya changed its publisher once and
every upgrade from an older version failed. `src/util/release.test.ts` pins it to the
LICENSE holder. Release 0.1.0 shipped before the publisher was set, so its key is
`HKCU\Software\pdfluffer\PDFluffer`: an install of 0.1.0 cannot be upgraded in place by a
later release. Uninstall it first.

## Steps

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml`, then `npm install --package-lock-only --no-audit --no-fund` so the
   lockfile follows. `src/util/release.test.ts` fails if they disagree.
2. `npm run check`. Commit, so the build comes from a clean tree.
3. Nick logs in to SimplySign Desktop: right-click its icon by the clock, choose
   **Connect to SimplySign**, and enter the code from the phone app.
4. `npm run build:signed`. It checks the certificate is available, builds with the signing
   config merged, and checks the installer's signature. If signing fails at the very last
   step, on the installer itself, it is almost always the timestamp server: sign that one
   file again by hand with the command the build printed, then
   `node scripts/build-signed.mjs verify`. Never sign without the timestamp.
5. The build may update `src-tauri/Cargo.lock` with the new version. Commit that.
6. Install it **through its windows, as a user would**, with `scripts/upgrade-walk.cmd`. It
   clicks through the installer, takes the uninstall option when a version is already
   installed, checks the old uninstaller was given the install folder (`_?=<folder>`, not a
   bare `_?=`), leaves "Delete the application data" unticked, finishes, records the
   installed version, publisher and signatures, and starts the program once. Its log is
   `%TEMP%\pdfluffer-upgrade-walk.log`.
   **A Claude Code session must start it through Explorer**:
   `Start-Process explorer.exe '"<repo>\scripts\upgrade-walk.cmd"'`, then wait for the log's
   `.finished` file before reading the log. The session's own shell runs in a sandbox whose
   writes to the registry and LocalAppData go to a private copy, so an install run from it
   changes nothing on the real machine. A silent `/S` install is no substitute: it skips the
   page that runs the old uninstaller.
7. Push, tag `v<version>`, push the tag, write `SHA256SUMS.txt` for the installer, and create
   the release with both as assets, titled "PDFluffer <version>".
8. Check the released asset's SHA-256 matches the file you walked, and that
   `https://github.com/nick2468/pdfluffer/releases/latest` points at the new release.

## What signing does not do

Signing names the publisher. It does not stop the SmartScreen warning on day one. Windows
builds up trust in a publisher and in each file over time, so a new release may still warn
for a while.

## Renewing the certificate

The certificate runs for one year, from 28 October 2026 to 28 October 2027. Renew it with
Certum before then. The renewed certificate has a new thumbprint, so replace both together:

- `src-tauri/signing/code-signing.cer`, the new certificate's public file;
- `certificateThumbprint` in `src-tauri/tauri.signing.conf.json`.

The preflight and `release.test.ts` both refuse if the two disagree. Releases signed before
the renewal stay valid, because every signature carries a timestamp from
`http://time.certum.pl`. That is why a timestamp failure is retried, never skipped.
