import { describe, expect, it } from "vitest";
import { decideSave, type SaveStep } from "./decideSave";

type Mode = "none" | "append" | "rewrite";
const bools = [false, true];
const modes: Mode[] = ["none", "append", "rewrite"];

// The four rules of spec 12.3, written out again independently of decideSave.
function expected(dirty: boolean, mode: Mode, signed: boolean, acknowledged: boolean, confirmed: boolean): SaveStep {
  if (dirty === false) return "nothing-to-save";
  const needsGuard = mode === "rewrite" && signed === true && acknowledged === false;
  if (needsGuard) return "guard-signature";
  return confirmed ? "write" : "ask-first-save";
}

const rows = bools.flatMap((dirty) => modes.flatMap((mode) => bools.flatMap((signed) =>
  bools.flatMap((acknowledged) => bools.map((confirmed) =>
    [dirty, mode, signed, acknowledged, confirmed, expected(dirty, mode, signed, acknowledged, confirmed)] as const,
  )))));

describe("decideSave", () => {
  it("covers all 48 combinations", () => {
    expect(rows).toHaveLength(48);
  });

  it.each(rows)(
    "dirty %s, mode %s, signed %s, acknowledged %s, confirmed %s gives %s",
    (dirty, mode, hasDigitalSignature, rewriteAcknowledged, saveConfirmed, step) => {
      expect(decideSave({ dirty, mode, hasDigitalSignature, rewriteAcknowledged, saveConfirmed })).toBe(step);
    },
  );

  it("lets an acknowledged rewrite of a signed file through to the first-save question", () => {
    const input = { dirty: true, mode: "rewrite" as const, hasDigitalSignature: true, rewriteAcknowledged: true };
    expect(decideSave({ ...input, saveConfirmed: false })).toBe("ask-first-save");
    expect(decideSave({ ...input, saveConfirmed: true })).toBe("write");
  });

  it("never guards an append on a signed file", () => {
    expect(decideSave({ dirty: true, mode: "append", hasDigitalSignature: true, rewriteAcknowledged: false, saveConfirmed: true }))
      .toBe("write");
  });
});
