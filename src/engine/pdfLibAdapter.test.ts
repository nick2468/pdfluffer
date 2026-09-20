import {
  decodePDFRawStream, degrees, PDFArray, PDFDocument, PDFRawStream, PDFStream, StandardFonts,
  toDegrees,
} from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { EngineError, type EngineOp } from "./EngineAdapter";
import { PdfLibAdapter } from "./pdfLibAdapter";

// Spec 15 item 7. Every input is built here with @cantoo/pdf-lib, so no test reads a file.

const engine = new PdfLibAdapter();

/** A document whose pages have the given sizes, so a test can tell them apart. */
async function pdfWithPages(sizes: [number, number][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const size of sizes) doc.addPage(size);
  return doc.save();
}

/** A document of n pages, each already turned by the matching angle. */
async function pdfWithRotations(angles: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const angle of angles) doc.addPage([200, 300]).setRotation(degrees(angle));
  return doc.save();
}

async function rotations(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => toDegrees(p.getRotation()));
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

/** An XObject being drawn: a name, then the Do operator. */
const DRAWS_XOBJECT = /\/[A-Za-z0-9_-]+ Do\b/;

/** The operators of one page, decompressed, as text. */
async function contentOf(bytes: Uint8Array, index = 0): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPages()[index].node.Contents();
  const entries = contents instanceof PDFArray ? contents.asArray() : [contents];
  const parts: string[] = [];
  for (const entry of entries) {
    const stream = doc.context.lookup(entry);
    if (stream instanceof PDFRawStream) {
      parts.push(new TextDecoder().decode(decodePDFRawStream(stream).decode()));
    } else if (stream instanceof PDFStream) {
      parts.push(stream.getContentsString());
    }
  }
  return parts.join("\n");
}

async function fieldNames(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getForm().getFields().map((f) => f.getName());
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

  it("has the three capabilities spec 13.4 names, and no more", async () => {
    expect([...engine.capabilities()].sort()).toEqual(['flatten', 'pages.insertPdf', 'pages.rotate']);
  });

  it("refuses an operation kind it does not know", async () => {
    const bytes = await pdfWithPages([[200, 200]]);
    const madeUp = { kind: 'text.edit' } as unknown as EngineOp;
    expect(await codeOf(engine.run(madeUp, bytes))).toBe("unsupported");
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

// Plan P2.4

describe("PdfLibAdapter pages.rotate", () => {
  it("turns every page when pages is 'all'", async () => {
    const bytes = await pdfWithRotations([0, 90, 270]);
    const result = await engine.run({ kind: 'pages.rotate', pages: 'all', degrees: 90 }, bytes);
    expect(result.mode).toBe("rewrite");
    expect(await rotations(result.bytes)).toEqual([90, 180, 0]);
  });

  it("turns only the pages it is given, by 1-based number", async () => {
    const bytes = await pdfWithRotations([0, 0, 0]);
    const result = await engine.run({ kind: 'pages.rotate', pages: [1, 3], degrees: 180 }, bytes);
    expect(await rotations(result.bytes)).toEqual([180, 0, 180]);
  });

  it("turns anticlockwise and wraps below zero", async () => {
    const bytes = await pdfWithRotations([0, 90]);
    const result = await engine.run({ kind: 'pages.rotate', pages: 'all', degrees: -90 }, bytes);
    expect(await rotations(result.bytes)).toEqual([270, 0]);
  });

  it("turns one page twice when it is named twice", async () => {
    const bytes = await pdfWithRotations([0]);
    const result = await engine.run({ kind: 'pages.rotate', pages: [1, 1], degrees: 90 }, bytes);
    expect(await rotations(result.bytes)).toEqual([180]);
  });

  it("fails for a page number that is not in the document", async () => {
    const bytes = await pdfWithRotations([0, 0]);
    for (const pages of [[3], [0], [-1], [1.5], [1, 9]]) {
      expect(await codeOf(engine.run({ kind: 'pages.rotate', pages, degrees: 90 }, bytes))).toBe("failed");
    }
    // Nothing was written, so the bytes the caller holds still say 0.
    expect(await rotations(bytes)).toEqual([0, 0]);
  });

  it("reports an encrypted file as encrypted", async () => {
    const bytes = await encryptedPdf();
    expect(await codeOf(engine.run({ kind: 'pages.rotate', pages: 'all', degrees: 90 }, bytes))).toBe("encrypted");
  });
});

// Plan P2.5

/** One page with a filled text field and a ticked checkbox. */
async function pdfWithForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  const who = form.createTextField("who");
  who.setText("Nick");
  who.addToPage(page, { x: 20, y: 200, width: 200, height: 20, font });
  const agreed = form.createCheckBox("agreed");
  agreed.check();
  agreed.addToPage(page, { x: 20, y: 160, width: 16, height: 16 });
  return doc.save();
}

describe("PdfLibAdapter flatten: form fields", () => {
  it("removes every field and draws it on the page instead", async () => {
    const bytes = await pdfWithForm();
    expect(await fieldNames(bytes)).toEqual(["who", "agreed"]);
    const result = await engine.run({ kind: 'flatten' }, bytes);
    expect(result.mode).toBe("rewrite");
    expect(await fieldNames(result.bytes)).toEqual([]);
    expect(await contentOf(result.bytes)).toMatch(DRAWS_XOBJECT);
  });

  it("leaves a document with no form alone", async () => {
    const bytes = await pdfWithPages([[200, 200], [200, 300]]);
    const result = await engine.run({ kind: 'flatten' }, bytes);
    expect(await pageSizes(result.bytes)).toEqual([[200, 200], [200, 300]]);
    expect(await fieldNames(result.bytes)).toEqual([]);
  });

  it("reports an encrypted file as encrypted", async () => {
    expect(await codeOf(engine.run({ kind: 'flatten' }, await encryptedPdf()))).toBe("encrypted");
  });
});
