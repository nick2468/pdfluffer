import { describe, expect, it } from "vitest";
import { FileError } from "./FileAdapter";
import { FakeFileAdapter } from "./fakeFileAdapter";

const REF = "C:\\docs\\Form.pdf";

describe("FakeFileAdapter", () => {
  it("returns a copy of the bytes from readFile", async () => {
    const files = new FakeFileAdapter();
    files.addFile(REF, "Form.pdf", new Uint8Array([1, 2, 3]));
    const first = await files.readFile(REF);
    first.bytes[0] = 99;
    const second = await files.readFile(REF);
    expect(second.name).toBe("Form.pdf");
    expect(Array.from(second.bytes)).toEqual([1, 2, 3]);
  });

  it("throws not-found for a missing file", async () => {
    const files = new FakeFileAdapter();
    await expect(files.readFile(REF)).rejects.toMatchObject({ code: "not-found" });
  });

  it("throws a failNext error once only", async () => {
    const files = new FakeFileAdapter();
    files.addFile(REF, "Form.pdf", new Uint8Array([1]));
    const locked = new FileError("locked", "In use");
    files.failNext("write", REF, locked);
    await expect(files.writeFile(REF, new Uint8Array([2]), { keepBackup: false })).rejects.toBe(locked);
    expect(files.writes).toHaveLength(0);
    await files.writeFile(REF, new Uint8Array([2]), { keepBackup: true });
    expect(files.writes).toEqual([{ ref: REF, bytes: new Uint8Array([2]), options: { keepBackup: true } }]);
    expect(Array.from((await files.readFile(REF)).bytes)).toEqual([2]);
  });

  it("keeps read and write failures apart", async () => {
    const files = new FakeFileAdapter();
    files.addFile(REF, "Form.pdf", new Uint8Array([1]));
    files.failNext("read", REF, new FileError("io", "Disk error"));
    await files.writeFile(REF, new Uint8Array([2]), { keepBackup: false });
    await expect(files.readFile(REF)).rejects.toMatchObject({ code: "io" });
    await expect(files.readFile(REF)).resolves.toMatchObject({ name: "Form.pdf" });
  });

  it("compares refs without regard to case", () => {
    const files = new FakeFileAdapter();
    expect(files.sameFile("C:\\Docs\\A.PDF", "c:\\docs\\a.pdf")).toBe(true);
    expect(files.sameFile("C:\\docs\\a.pdf", "C:\\docs\\b.pdf")).toBe(false);
  });

  it("runs the registered close handler, and closes when none is registered", async () => {
    const files = new FakeFileAdapter();
    expect(await files.requestClose()).toBe(true);
    const off = files.onCloseRequested(async () => false);
    expect(await files.requestClose()).toBe(false);
    off();
    expect(await files.requestClose()).toBe(true);
  });

  it("round-trips state as a deep copy", async () => {
    const files = new FakeFileAdapter();
    expect(await files.loadState("session")).toBeNull();
    const value = { version: 1, items: [{ name: "a" }] };
    await files.saveState("history", value);
    value.items[0].name = "changed after save";
    const loaded = await files.loadState<typeof value>("history");
    expect(loaded).toEqual({ version: 1, items: [{ name: "a" }] });
    loaded!.items[0].name = "changed after load";
    expect(await files.loadState("history")).toEqual({ version: 1, items: [{ name: "a" }] });
  });

  it("returns queued picks and pending files once, then empty", async () => {
    const files = new FakeFileAdapter();
    files.queuePickFiles(["a.pdf", "b.pdf"]);
    files.queueSaveTarget("c.pdf");
    files.setPending(["d.pdf"]);
    expect(await files.pickFiles()).toEqual(["a.pdf", "b.pdf"]);
    expect(await files.pickFiles()).toEqual([]);
    expect(await files.pickSaveTarget("x.pdf", null)).toBe("c.pdf");
    expect(await files.pickSaveTarget("x.pdf", null)).toBeNull();
    expect(await files.takePendingOpenRequests()).toEqual(["d.pdf"]);
    expect(await files.takePendingOpenRequests()).toEqual([]);
  });

  it("delivers open requests to listeners until they unsubscribe", () => {
    const files = new FakeFileAdapter();
    const seen: string[][] = [];
    const off = files.onOpenRequest((refs) => seen.push(refs));
    files.emitOpenRequest(["a.pdf"]);
    off();
    files.emitOpenRequest(["b.pdf"]);
    expect(seen).toEqual([["a.pdf"]]);
  });

  it("records titles and external links", async () => {
    const files = new FakeFileAdapter();
    await files.setWindowTitle("Form.pdf - PDFluffer");
    await files.openExternal("https://example.com");
    expect(files.titles).toEqual(["Form.pdf - PDFluffer"]);
    expect(files.opened).toEqual(["https://example.com"]);
  });

  it("names a file from its stored name, else from the last path segment", () => {
    const files = new FakeFileAdapter();
    files.addFile(REF, "Stored.pdf", new Uint8Array());
    expect(files.nameOf(REF)).toBe("Stored.pdf");
    expect(files.nameOf("C:\\other\\New.pdf")).toBe("New.pdf");
  });
});
