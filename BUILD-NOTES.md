# PDFluffer - build notes

The builder's log (spec section 18). Newest findings go under the right heading.

## Environment

Checked 2026-09-19 at the start of chip 1 (plan P0.1).

| Tool | Version | How checked |
|---|---|---|
| Node | v24.19.0 | `node --version` |
| npm | 11.17.0 | `npm --version` |
| git | 2.45.1.windows.1 | `git --version` |
| rustc | 1.98.0 (88d9e12ae 2026-08-18) | `rustc --version`, with `$HOME/.cargo/bin` put on the PATH first |
| cargo | 1.98.0 (797e8a9bc 2026-08-05) | `cargo --version`, same PATH setting |

`.node-version` says `24.21.0`, the pin the sibling apps use. The machine runs 24.19.0,
which is on the same Node 24 line.

## Verified facts

Not checked yet (plan P0.8).

## Decisions taken under a named rule

None yet.

## Deviations

None yet.

## Questions for the user

None yet.

## Known issues

None yet.
