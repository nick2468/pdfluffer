import {
  concatTransformationMatrix, decodePDFRawStream, degrees, PDFArray, PDFDict, PDFDocument, PDFName,
  PDFRawStream, PDFStream, StandardFonts, toDegrees,
} from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import type { OcrPageResult } from "../ocr/OcrService";
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

  it("has the three capabilities spec 13.4 names, OCR from spec 20.4, and no more", async () => {
    expect([...engine.capabilities()].sort()).toEqual(['flatten', 'ocr', 'pages.insertPdf', 'pages.rotate']);
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

// Plan P2.6

/** The /Annots subtypes of one page, in order. */
async function annotSubtypes(bytes: Uint8Array, index = 0): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPages()[index].node.Annots();
  if (!annots) return [];
  return annots.asArray().map((entry) => {
    const annot = doc.context.lookup(entry);
    if (!(annot instanceof PDFDict)) return "?";
    const subtype = doc.context.lookup(annot.get(PDFName.of("Subtype")));
    return subtype instanceof PDFName ? subtype.decodeText() : "?";
  });
}

/**
 * One page carrying a form field, a Stamp and a FreeText with real appearance streams, a
 * Link that also has one, and a Stamp with no appearance at all.
 */
async function pdfWithAnnotations(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const who = doc.getForm().createTextField("who");
  who.setText("Nick");
  who.addToPage(page, { x: 20, y: 250, width: 200, height: 20, font });

  // A 10 by 10 form XObject: a filled blue square.
  const appearance = doc.context.register(doc.context.flateStream("0 0 1 rg 0 0 10 10 re f", {
    Type: "XObject", Subtype: "Form", BBox: [0, 0, 10, 10],
  }));
  const annot = (subtype: string, rect: number[], withAppearance = true) =>
    doc.context.register(doc.context.obj({
      Type: "Annot", Subtype: subtype, Rect: rect,
      ...(withAppearance ? { AP: { N: appearance } } : {}),
    }));

  page.node.addAnnot(annot("Stamp", [50, 50, 150, 150]));
  page.node.addAnnot(annot("Link", [10, 10, 100, 30]));
  page.node.addAnnot(annot("FreeText", [200, 200, 220, 240]));
  page.node.addAnnot(annot("Stamp", [0, 0, 20, 20], false));
  return doc.save();
}

describe("PdfLibAdapter flatten: annotations", () => {
  it("draws the notes and stamps on the page and keeps the link", async () => {
    const bytes = await pdfWithAnnotations();
    expect(await annotSubtypes(bytes)).toEqual(["Widget", "Stamp", "Link", "FreeText", "Stamp"]);

    const result = await engine.run({ kind: 'flatten' }, bytes);
    expect(await fieldNames(result.bytes)).toEqual([]);
    // The link stays, and so does the stamp that has no appearance to draw.
    expect(await annotSubtypes(result.bytes)).toEqual(["Link", "Stamp"]);
    expect(await contentOf(result.bytes)).toMatch(DRAWS_XOBJECT);
  });

  it("fits the appearance box into the annotation rectangle", async () => {
    const result = await engine.run({ kind: 'flatten' }, await pdfWithAnnotations());
    const content = await contentOf(result.bytes);
    // The 10 by 10 box into Rect [50 50 150 150], and into Rect [200 200 220 240].
    expect(content).toContain("10 0 0 10 50 50 cm");
    expect(content).toContain("2 0 0 4 200 200 cm");
  });

  it("changes nothing the second time", async () => {
    const once = await engine.run({ kind: 'flatten' }, await pdfWithAnnotations());
    const twice = await engine.run({ kind: 'flatten' }, once.bytes);
    expect(await annotSubtypes(twice.bytes)).toEqual(await annotSubtypes(once.bytes));
    expect(await contentOf(twice.bytes)).toEqual(await contentOf(once.bytes));
    expect(await fieldNames(twice.bytes)).toEqual([]);
  });

  it("passes a page with no annotations through", async () => {
    const result = await engine.run({ kind: 'flatten' }, await pdfWithPages([[200, 200]]));
    expect(await annotSubtypes(result.bytes)).toEqual([]);
    expect(await contentOf(result.bytes)).not.toMatch(DRAWS_XOBJECT);
  });
});

// Plan P4.7, spec 20.4: the invisible OCR text layer.

/** The viewport PDF.js gives an upright 600 by 800 page at scale 1: points are pixels. */
const UPRIGHT = [1, 0, 0, -1, 0, 800];

function ocrPage(texts: string[]): OcrPageResult {
  // One line, words 60 pixels wide and 20 tall, side by side near the top of the page.
  return {
    language: "en-GB",
    width: 600,
    height: 800,
    textAngle: 0,
    lines: [{ words: texts.map((text, i) => ({ text, x: 50 + i * 70, y: 100, w: 60, h: 20 })) }],
  };
}

const layerOp = (pages: { pageIndex: number; texts: string[] }[]): EngineOp => ({
  kind: 'ocr.addTextLayer',
  pages: pages.map(({ pageIndex, texts }) => ({ pageIndex, result: ocrPage(texts), transform: UPRIGHT })),
});

const tokens = (content: string) => content.split(/\s+/).filter(Boolean);
const count = (content: string, op: string) => tokens(content).filter((t) => t === op).length;

/** Our block: from the q just before BT to the end. The page's own content comes before it. */
function ourBlock(content: string): string[] {
  const all = tokens(content);
  const bt = all.indexOf("BT");
  expect(bt).toBeGreaterThan(0);
  expect(all[bt - 1]).toBe("q");
  return all.slice(bt - 1);
}

/** The one font entry of a page's resources: its name in the page, and what it points at. */
function fontsOf(doc: PDFDocument, index: number): [string, string][] {
  const resources = doc.getPages()[index].node.Resources();
  const fonts = resources?.lookup(PDFName.of("Font"), PDFDict);
  return fonts ? fonts.entries().map(([name, ref]) => [String(name), String(ref)]) : [];
}

describe("PdfLibAdapter ocr.addTextLayer", () => {
  it("adds one invisible text block with one show-text per word", async () => {
    const op = layerOp([{ pageIndex: 0, texts: ["Hello", "there", "world"] }]);
    const result = await engine.run(op, await pdfWithPages([[600, 800]]));
    expect(result.mode).toBe("rewrite");
    const content = await contentOf(result.bytes);
    expect(count(content, "BT")).toBe(1);
    expect(count(content, "ET")).toBe(1);
    expect(content).toMatch(/\b3 Tr\b/);
    expect(count(content, "Tj")).toBe(3);
    // Each word in Helvetica's WinAnsi codes: "Hello" is 48 65 6C 6C 6F.
    expect(content.toUpperCase()).toContain("<48656C6C6F> TJ");
  });

  it("sets the font, the text matrix and the horizontal scale for every word", async () => {
    const op = layerOp([{ pageIndex: 0, texts: ["Hello", "there"] }]);
    const content = await contentOf((await engine.run(op, await pdfWithPages([[600, 800]]))).bytes);
    expect(count(content, "Tf")).toBe(2);
    expect(count(content, "Tm")).toBe(2);
    expect(count(content, "Tz")).toBe(2);
    // An upright page, so the matrix starts 1 0 0 1, and the first word starts at x = 50.
    expect(content).toMatch(/\b1 0 0 1 50 [\d.]+ Tm/);
  });

  it("draws nothing visible: no picture, no fill, no stroke, no shape", async () => {
    const op = layerOp([{ pageIndex: 0, texts: ["Hello", "there"] }]);
    const block = ourBlock(await contentOf((await engine.run(op, await pdfWithPages([[600, 800]]))).bytes));
    for (const name of ["Do", "f", "F", "f*", "S", "s", "B", "B*", "b", "b*", "re", "sh", "BI"]) {
      expect(block, `our block holds ${name}`).not.toContain(name);
    }
    expect(block[block.length - 1]).toBe("Q");
  });

  it("embeds Helvetica once, however many pages gain text", async () => {
    const op = layerOp([{ pageIndex: 0, texts: ["one"] }, { pageIndex: 1, texts: ["two"] }]);
    const doc = await PDFDocument.load((await engine.run(op, await pdfWithPages([[600, 800], [600, 800]]))).bytes);
    const first = fontsOf(doc, 0);
    const second = fontsOf(doc, 1);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0][1]).toBe(second[0][1]);
    const fonts = doc.getPages()[0].node.Resources()?.lookup(PDFName.of("Font"), PDFDict);
    const font = fonts?.lookup(PDFName.of(first[0][0].slice(1)), PDFDict);
    expect(String(font?.get(PDFName.of("BaseFont")))).toBe("/Helvetica");
  });

  it("starts only after the page's own graphics state is closed, so a leaked cm cannot move it", async () => {
    // Many scanners write a scaling matrix and never restore it. If our text came straight
    // after, it would be scaled with the picture and land in the wrong place.
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]).pushOperators(concatTransformationMatrix(2, 0, 0, 2, 0, 0));
    const leaky = await doc.save();
    expect(tokens(await contentOf(leaky))).not.toContain("q");

    const content = await contentOf((await engine.run(layerOp([{ pageIndex: 0, texts: ["Hello"] }]), leaky)).bytes);
    let depth = 0;
    let depthAtCm = -1;
    let depthBeforeOurBlock = -1;
    for (const token of tokens(content)) {
      if (token === "cm" && depthAtCm < 0) depthAtCm = depth;
      if (token === "BT") { depthBeforeOurBlock = depth - 1; break; }   // less our own q
      if (token === "q") depth++;
      if (token === "Q") depth--;
    }
    expect(depthAtCm).toBeGreaterThanOrEqual(1);   // the page's cm now sits inside a q ... Q
    expect(depthBeforeOurBlock).toBe(0);           // and that pair is closed before our q
  });

  it("drops a word Helvetica cannot write, using the font's own character set", async () => {
    // e acute and sharp s are in WinAnsi. Japanese is not.
    const op = layerOp([{ pageIndex: 0, texts: ["café", "日本", "Straße"] }]);
    expect(count(await contentOf((await engine.run(op, await pdfWithPages([[600, 800]]))).bytes), "Tj")).toBe(2);
  });

  it("leaves a page with no words exactly as it was", async () => {
    const before = await pdfWithPages([[600, 800], [600, 800]]);
    const op = layerOp([{ pageIndex: 0, texts: [] }, { pageIndex: 1, texts: ["Hello"] }]);
    const result = await engine.run(op, before);
    expect(await contentOf(result.bytes, 0)).toBe(await contentOf(before, 0));
    expect(count(await contentOf(result.bytes, 1), "Tj")).toBe(1);
  });

  it("leaves the pages it was not given alone", async () => {
    const before = await pdfWithPages([[600, 800], [600, 800], [600, 800]]);
    const result = await engine.run(layerOp([{ pageIndex: 1, texts: ["middle"] }]), before);
    expect(await contentOf(result.bytes, 0)).toBe(await contentOf(before, 0));
    expect(await contentOf(result.bytes, 2)).toBe(await contentOf(before, 2));
    expect(count(await contentOf(result.bytes, 1), "Tj")).toBe(1);
  });

  it("fails for a page index that is not in the document", async () => {
    const bytes = await pdfWithPages([[600, 800]]);
    expect(await codeOf(engine.run(layerOp([{ pageIndex: 1, texts: ["x"] }]), bytes))).toBe("failed");
    expect(await codeOf(engine.run(layerOp([{ pageIndex: -1, texts: ["x"] }]), bytes))).toBe("failed");
  });

  it("reports an encrypted file as encrypted", async () => {
    expect(await codeOf(engine.run(layerOp([{ pageIndex: 0, texts: ["x"] }]), await encryptedPdf()))).toBe("encrypted");
  });
});
