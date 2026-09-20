import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { EngineError } from "./EngineAdapter";
import { PdfLibAdapter } from "./pdfLibAdapter";

// Spec 15 item 7. Every input is built here with @cantoo/pdf-lib, so no test reads a file.

const engine = new PdfLibAdapter();

/** A document whose pages have the given sizes, so a test can tell them apart. */
async function pdfWithPages(sizes: [number, number][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const size of sizes) doc.addPage(size);
  return doc.save();
}

async function encryptedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.encrypt({ userPassword: "open-sesame", ownerPassword: "owner" });
  return doc.save();
}

async function pageSizes(bytes: Uint8Array): Promise<[number, number][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);
}

/** Fails the test unless the call rejected with an EngineError carrying this code. */
async function codeOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (err) {
    expect(err).toBeInstanceOf(EngineError);
    return (err as EngineError).code;
  }
  throw new Error("Expected the operation to fail, but it succeeded.");
}

describe("PdfLibAdapter", () => {
  it("is named pdf-lib", () => {
    expect(engine.name).toBe("pdf-lib");
  });

  it("refuses an operation it has no capability for", async () => {
    const bytes = await pdfWithPages([[200, 200]]);
    expect(await codeOf(engine.run({ kind: 'flatten' }, bytes))).toBe("unsupported");
  });

  it("reports an encrypted file as encrypted, and rubbish as failed", async () => {
    expect(await codeOf(engine.run({ kind: 'pages.insertPdf', other: await pdfWithPages([[10, 10]]) }, await encryptedPdf()))).toBe("encrypted");
    const rubbish = new TextEncoder().encode("this is not a PDF at all");
    expect(await codeOf(engine.run({ kind: 'pages.insertPdf', other: rubbish }, rubbish))).toBe("failed");
  });
});

// Plan P2.3

describe("PdfLibAdapter pages.insertPdf", () => {
  it("adds every page of the other document at the end", async () => {
    const base = await pdfWithPages([[200, 200], [200, 300]]);
    const other = await pdfWithPages([[400, 500], [400, 600], [400, 700]]);
    const result = await engine.run({ kind: 'pages.insertPdf', other }, base);
    expect(result.mode).toBe("rewrite");
    expect(await pageSizes(result.bytes)).toEqual([
      [200, 200], [200, 300], [400, 500], [400, 600], [400, 700],
    ]);
  });

  it("leaves the caller's bytes alone", async () => {
    const base = await pdfWithPages([[200, 200]]);
    const other = await pdfWithPages([[400, 500]]);
    const baseCopy = base.slice();
    const otherCopy = other.slice();
    await engine.run({ kind: 'pages.insertPdf', other }, base);
    expect(base).toEqual(baseCopy);
    expect(other).toEqual(otherCopy);
  });

  it("inserts nothing from an empty document and keeps the base", async () => {
    const base = await pdfWithPages([[200, 200]]);
    const other = await PDFDocument.create().then((d) => d.save({ addDefaultPage: false }));
    const result = await engine.run({ kind: 'pages.insertPdf', other }, base);
    expect(await pageSizes(result.bytes)).toEqual([[200, 200]]);
  });

  it("reports an encrypted other document as encrypted", async () => {
    const base = await pdfWithPages([[200, 200]]);
    const other = await encryptedPdf();
    expect(await codeOf(engine.run({ kind: 'pages.insertPdf', other }, base))).toBe("encrypted");
  });
});
