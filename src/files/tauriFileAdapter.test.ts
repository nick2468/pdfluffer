import { describe, expect, it } from "vitest";
import { FileError } from "./FileAdapter";
import { toFileError } from "./tauriFileAdapter";

describe("toFileError", () => {
  it.each(["not-found", "not-pdf", "locked"] as const)("maps the Rust string %s to that code", (reason) => {
    const err = toFileError(reason);
    expect(err).toBeInstanceOf(FileError);
    expect(err.code).toBe(reason);
    expect(err.message).not.toBe("");
  });

  it("maps an io string to io and keeps the detail", () => {
    const err = toFileError("io: Access is denied. (os error 5)");
    expect(err.code).toBe("io");
    expect(err.message).toBe("Access is denied. (os error 5)");
  });

  it("maps any other string to io with the whole text", () => {
    expect(toFileError("io: bad x-path header")).toMatchObject({ code: "io", message: "bad x-path header" });
    expect(toFileError("command read_pdf not found")).toMatchObject({ code: "io", message: "command read_pdf not found" });
    expect(toFileError("Locked")).toMatchObject({ code: "io" });
  });

  it("maps a non-string rejection to io", () => {
    expect(toFileError(new Error("IPC failed"))).toMatchObject({ code: "io", message: "IPC failed" });
    expect(toFileError(undefined)).toMatchObject({ code: "io", message: "undefined" });
  });

  it("passes a FileError through unchanged", () => {
    const original = new FileError("locked", "In use");
    expect(toFileError(original)).toBe(original);
  });
});
