import { describe, expect, it } from "vitest";
import { OcrError } from "./OcrService";
import { toOcrError } from "./tauriOcrService";

describe("toOcrError", () => {
  it("maps the Rust string ocr-unavailable", () => {
    const err = toOcrError("ocr-unavailable");
    expect(err).toBeInstanceOf(OcrError);
    expect(err.code).toBe("unavailable");
    expect(err.message).not.toBe("");
  });

  it("maps the Rust string ocr-too-large", () => {
    const err = toOcrError("ocr-too-large");
    expect(err.code).toBe("too-large");
    expect(err.message).not.toBe("");
  });

  it("maps an ocr: string to failed and keeps the detail", () => {
    const err = toOcrError("ocr: The component cannot be found.");
    expect(err.code).toBe("failed");
    expect(err.message).toBe("The component cannot be found.");
  });

  it("maps any other string to failed with the whole text", () => {
    expect(toOcrError("command ocr_image not found")).toMatchObject({
      code: "failed", message: "command ocr_image not found",
    });
    // Near misses are not the codes: only the exact strings Rust sends count.
    expect(toOcrError("OCR-TOO-LARGE")).toMatchObject({ code: "failed" });
    expect(toOcrError("ocr-too-large ")).toMatchObject({ code: "failed" });
  });

  it("maps a non-string rejection to failed", () => {
    expect(toOcrError(new Error("IPC failed"))).toMatchObject({ code: "failed", message: "IPC failed" });
    expect(toOcrError(undefined)).toMatchObject({ code: "failed", message: "undefined" });
  });

  it("passes an OcrError through unchanged", () => {
    const original = new OcrError("too-large", "Too big");
    expect(toOcrError(original)).toBe(original);
  });
});
