// What a release must hold together: one version in three files, and a publisher that is
// set once and never changed. Tauri uses `bundle.publisher` twice: as the publisher Apps
// and Features shows, and as the name of the registry key an upgrade reads the old
// install's folder from. Changing it broke every Tabiya upgrade (2026-10-28), so this
// pins it to the LICENSE holder. The signing config's thumbprint must match the
// committed certificate, or a renewal has only half landed.
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repo = new URL("../../", import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, repo), "utf8");

describe("the version", () => {
  const declared = (JSON.parse(read("package.json")) as { version: string }).version;

  it("is three numbers", () => {
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is the same in tauri.conf.json, which the installer writes", () => {
    expect((JSON.parse(read("src-tauri/tauri.conf.json")) as { version: string }).version).toBe(declared);
  });

  it("is the same in Cargo.toml, which the executable carries", () => {
    expect(read("src-tauri/Cargo.toml").match(/^version = "([^"]+)"/m)?.[1]).toBe(declared);
  });
});

describe("the name the installer writes", () => {
  const holder = read("LICENSE").match(/^Copyright \(c\) \d{4} (.+)$/m)?.[1];
  const bundle = (JSON.parse(read("src-tauri/tauri.conf.json")) as { bundle: { publisher: string; copyright: string } }).bundle;

  it("is the copyright holder in LICENSE, and never changes", () => {
    expect(holder).toBe("Nicholas Walker");
    expect(bundle.publisher).toBe(holder);
    expect(bundle.copyright).toBe(`Copyright (c) 2026 ${holder}`);
  });
});

describe("the signing config", () => {
  it("names the committed certificate", () => {
    const certificate = new X509Certificate(readFileSync(new URL("src-tauri/signing/code-signing.cer", repo)));
    const config = JSON.parse(read("src-tauri/tauri.signing.conf.json")) as { bundle: { windows: { certificateThumbprint: string; tsp: boolean; timestampUrl: string } } };
    expect(config.bundle.windows.certificateThumbprint.toUpperCase()).toBe(certificate.fingerprint.replace(/:/g, "").toUpperCase());
    expect(config.bundle.windows.tsp).toBe(true);
    expect(config.bundle.windows.timestampUrl).toMatch(/^http:\/\/time\.certum\.pl/);
    expect(certificate.subject).toContain("Nicholas Walker");
  });
});
