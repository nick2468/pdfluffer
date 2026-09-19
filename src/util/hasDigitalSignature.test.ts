import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasDigitalSignature } from "./hasDigitalSignature";

const ascii = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));

describe("hasDigitalSignature", () => {
  it("is true for fake-signed.pdf", () => {
    expect(hasDigitalSignature(readFileSync("samples/fake-signed.pdf"))).toBe(true);
  });

  it("is false for three-pages.pdf", () => {
    expect(hasDigitalSignature(readFileSync("samples/three-pages.pdf"))).toBe(false);
  });

  it("is false for an empty array", () => {
    expect(hasDigitalSignature(new Uint8Array())).toBe(false);
  });

  it("finds the key at the very start and the very end", () => {
    expect(hasDigitalSignature(ascii("/ByteRange"))).toBe(true);
    expect(hasDigitalSignature(ascii("xx /ByteRange"))).toBe(true);
  });

  it("is false for a partial or differently cased key", () => {
    expect(hasDigitalSignature(ascii("/ByteRang"))).toBe(false);
    expect(hasDigitalSignature(ascii("/Byterange [0 0 0 0]"))).toBe(false);
    expect(hasDigitalSignature(ascii("//ByteRangX /ByteRang"))).toBe(false);
  });
});
