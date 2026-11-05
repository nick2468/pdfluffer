import {
  beginText, degrees, drawObject, endText, moveText, PDFDocument, PDFHexString, PDFName, PDFString, rgb, setFontAndSize,
  setTextRenderingMode, showText, StandardFonts, TextRenderingMode, type PDFFont, type PDFPage,
} from "@cantoo/pdf-lib";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EngineError } from "./EngineAdapter";
import { PdfiumAdapter, pdfiumHeapSize } from "./pdfiumAdapter";
import { PAGE_CHANGED, type FontSource, type RunLocator, type TextRun } from "./textEdit";

// Spec 21 and chip 14 section 5. Every PDF is built here with pdf-lib and its standard fonts.
// PDFium runs from the package's own .wasm in node_modules. In Node there is no Windows font
// source, so a test that wants a real font file uses the LiberationSans that PDF.js ships.

const WASM = new URL("../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm", import.meta.url);
const LIBERATION = new URL("../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf", import.meta.url);

async function wasm(): Promise<ArrayBuffer> {
  const bytes = readFileSync(WASM);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** The Node engine: no font source, so every substitute is a PDFium standard font. */
const engine = new PdfiumAdapter(null, wasm);

/** A font source that answers every allowlisted name with LiberationSans, and records the asks. */
function liberationSource(): { source: FontSource; asked: string[] } {
  const asked: string[] = [];
  const font = readFileSync(LIBERATION);
  return { asked, source: async (file) => (asked.push(file), font.slice()) };
}

async function fonts(doc: PDFDocument) {
  return {
    helvetica: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
}

/** Draws text the way pdf-lib's drawText cannot: in a given render mode. */
function drawRaw(page: PDFPage, font: PDFFont, text: string, x: number, y: number, size: number, mode: TextRenderingMode): void {
  const name = page.node.newFontDictionary("Raw", font.ref);
  page.pushOperators(beginText(), setFontAndSize(name, size), setTextRenderingMode(mode), moveText(x, y),
    showText(font.encodeText(text)), endText());
}

/** Chip 14 test 1's page: lines, a bold word, turned text, white text and an OCR-style layer. */
async function mixedPage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const { helvetica, bold } = await fonts(doc);
  page.drawText("First line of text", { x: 50, y: 700, size: 12, font: helvetica });
  page.drawText("Total due is ", { x: 50, y: 650, size: 12, font: helvetica });
  page.drawText("now", { x: 50 + helvetica.widthOfTextAtSize("Total due is ", 12), y: 650, size: 12, font: bold });
  page.drawText("Turned text", { x: 400, y: 300, size: 14, font: helvetica, rotate: degrees(90) });
  page.drawText("White text", { x: 50, y: 600, size: 12, font: helvetica, color: rgb(1, 1, 1) });
  drawRaw(page, helvetica, "Hidden layer", 50, 550, 12, TextRenderingMode.Invisible);
  return doc.save();
}

/** Three plain lines, for edits. */
async function threeLines(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const { helvetica, bold } = await fonts(doc);
  page.drawText("Hello there world", { x: 50, y: 700, size: 12, font: helvetica });
  page.drawText("Second line here", { x: 50, y: 650, size: 12, font: helvetica });
  page.drawText("Bold heading", { x: 50, y: 600, size: 20, font: bold, color: rgb(1, 0, 0) });
  return doc.save();
}

const run = (runs: TextRun[], text: string): TextRun => {
  const found = runs.find((r) => r.text === text);
  if (!found) throw new Error(`No run "${text}" in ${JSON.stringify(runs.map((r) => r.text))}`);
  return found;
};
const locator = (r: TextRun): RunLocator => ({ pageIndex: r.pageIndex, text: r.text, bbox: r.bbox });
const width = (r: TextRun) => r.bbox[2] - r.bbox[0];
const height = (r: TextRun) => r.bbox[3] - r.bbox[1];

/** Chip 14 test 9: every saved result loads in pdf-lib too. */
async function reloads(bytes: Uint8Array): Promise<void> {
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBeGreaterThan(0);
}

async function rejection(promise: Promise<unknown>): Promise<EngineError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(EngineError);
    return err as EngineError;
  }
  throw new Error("expected a rejection");
}

describe("PdfiumAdapter, the engine seam", () => {
  it("offers text.edit only, and runs text.edits as a rewrite", async () => {
    expect([...engine.capabilities()]).toEqual(["text.edit"]);
    const before = await threeLines();
    const runs = await engine.listRuns(before, 0);
    const result = await engine.run({ kind: "text.edits", edits: [{ kind: "delete", target: locator(run(runs, "Second line here")) }] }, before);
    expect(result.mode).toBe("rewrite");
    expect((await engine.listRuns(result.bytes, 0)).map((r) => r.text)).toEqual(["Hello there world", "Bold heading"]);
  });

  it("refuses any other operation", async () => {
    const err = await rejection(engine.run({ kind: "flatten" }, await threeLines()));
    expect(err.code).toBe("unsupported");
  });

  it("maps an encrypted file to EngineError('encrypted'), like pdf-lib", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.encrypt({ userPassword: "open-sesame", ownerPassword: "owner" });
    const bytes = await doc.save();
    expect((await rejection(engine.listRuns(bytes, 0))).code).toBe("encrypted");
    expect((await rejection(engine.applyEdits(bytes, []))).code).toBe("encrypted");
  });

  it("names a page that is not there", async () => {
    const err = await rejection(engine.listRuns(await threeLines(), 3));
    expect(err.message).toBe("This document has no page 4.");
  });
});

describe("listRuns (chip 14 test 1)", () => {
  it("lists lines, a bold word as its own run, turned text, white text, and invisible text as not editable", async () => {
    const runs = await engine.listRuns(await mixedPage(), 0);
    expect(runs.map((r) => [r.text, r.editable, r.reason ?? null])).toEqual([
      ["First line of text", true, null],
      ["Total due is ", true, null],
      ["now", true, null],
      ["Turned text", true, null],
      ["White text", true, null],
      ["Hidden layer", false, "invisible"],
    ]);
    const first = run(runs, "First line of text");
    expect(first.fontName).toBe("Helvetica");
    expect(first.fontSize).toBeCloseTo(12, 3);
    expect(first.colour).toEqual([0, 0, 0]);
    expect(first.bbox[0]).toBeGreaterThanOrEqual(50);
    expect(first.bbox[0]).toBeLessThan(52);
    expect(first.bbox[1]).toBeCloseTo(700, 0);
    expect(run(runs, "now").fontName).toBe("Helvetica-Bold");
    expect(run(runs, "White text").colour).toEqual([255, 255, 255]);
    const turned = run(runs, "Turned text");
    expect(height(turned)).toBeGreaterThan(width(turned) * 4);
    expect(new Set(runs.map((r) => r.id)).size).toBe(runs.length);
  });

  it("marks Type 3 fonts and vertical writing not editable, and never lists text inside a form XObject", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const ctx = doc.context;
    const { helvetica } = await fonts(doc);
    page.drawText("Plain", { x: 50, y: 350, size: 12, font: helvetica });

    // A Type 3 font whose one glyph, "a", is a filled square.
    const glyph = ctx.register(ctx.flateStream("500 0 0 0 750 750 d1 0 0 750 750 re f"));
    const type3 = ctx.register(ctx.obj({
      Type: "Font", Subtype: "Type3", FontBBox: [0, 0, 750, 750], FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
      CharProcs: { a: glyph }, Encoding: { Type: "Encoding", Differences: [97, PDFName.of("a")] },
      FirstChar: 97, LastChar: 97, Widths: [500],
    }));
    page.node.setFontDictionary(PDFName.of("T3"), type3);
    page.pushOperators(beginText(), setFontAndSize("T3", 12), moveText(50, 300), showText(PDFHexString.of("616161")), endText());

    // A vertical font: LiberationSans as a CID font with Identity-V.
    const file = readFileSync(LIBERATION);
    const fontFile = ctx.register(ctx.flateStream(file, { Length1: file.length }));
    const descriptor = ctx.register(ctx.obj({
      Type: "FontDescriptor", FontName: "LiberationSans", Flags: 32, FontBBox: [0, -200, 1000, 900], ItalicAngle: 0,
      Ascent: 900, Descent: -200, CapHeight: 700, StemV: 80, FontFile2: fontFile,
    }));
    const cid = ctx.register(ctx.obj({
      Type: "Font", Subtype: "CIDFontType2", BaseFont: "LiberationSans", FontDescriptor: descriptor, CIDToGIDMap: "Identity",
      CIDSystemInfo: { Registry: PDFString.of("Adobe"), Ordering: PDFString.of("Identity"), Supplement: 0 },
    }));
    page.node.setFontDictionary(PDFName.of("V"), ctx.register(ctx.obj({
      Type: "Font", Subtype: "Type0", BaseFont: "LiberationSans", Encoding: "Identity-V", DescendantFonts: [cid],
    })));
    page.pushOperators(beginText(), setFontAndSize("V", 12), moveText(200, 300), showText(PDFHexString.of("002400250026")), endText());

    // Text inside a form XObject, drawn on the page.
    const form = ctx.register(ctx.flateStream("BT /H 12 Tf 50 100 Td (Inside a form) Tj ET", {
      Type: "XObject", Subtype: "Form", BBox: [0, 0, 400, 400], Resources: { Font: { H: helvetica.ref } },
    }));
    page.node.setXObject(PDFName.of("X1"), form);
    page.pushOperators(drawObject("X1"));

    const runs = await engine.listRuns(await doc.save(), 0);
    expect(runs.map((r) => [r.editable, r.reason ?? null])).toEqual([
      [true, null],
      [false, "type3-font"],
      [false, "vertical"],
    ]);
    expect(runs.some((r) => r.text.includes("Inside"))).toBe(false);
  });

  it("does not list form fields or annotations", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const field = doc.getForm().createTextField("name");
    field.setText("Field value");
    field.addToPage(page, { x: 50, y: 300, width: 200, height: 20 });
    expect(await engine.listRuns(await doc.save(), 0)).toEqual([]);
  });
});

describe("renderPage", () => {
  it("fits the longer side, starts from white, and maps points to the pixels where the text is", async () => {
    const bytes = await threeLines();
    const page = await engine.renderPage(bytes, 0, 1000);
    expect([page.width, page.height]).toEqual([750, 1000]);
    expect(page.rgba.length).toBe(750 * 1000 * 4);
    expect([...page.rgba.slice(0, 4)]).toEqual([255, 255, 255, 255]);

    const [a, b, c, d, e, f] = page.transform;
    expect(a).toBeCloseTo(1.25, 4);
    expect(d).toBeCloseTo(-1.25, 4);
    expect(b).toBeCloseTo(0, 6);
    expect(c).toBeCloseTo(0, 6);
    expect(e).toBeCloseTo(0, 3);
    expect(f).toBeCloseTo(1000, 3);

    // The red heading's box, through the transform, holds red pixels.
    const heading = run(await engine.listRuns(bytes, 0), "Bold heading");
    const [x0, y0] = [a * heading.bbox[0] + e, d * heading.bbox[3] + f];
    const [x1, y1] = [a * heading.bbox[2] + e, d * heading.bbox[1] + f];
    let red = 0;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const i = (y * page.width + x) * 4;
        if (page.rgba[i] > 200 && page.rgba[i + 1] < 80 && page.rgba[i + 2] < 80) red++;
      }
    }
    expect(red).toBeGreaterThan(50);
  });

  it("holds the page's /Rotate in the picture and the transform", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 600]).setRotation(degrees(90));
    const page = await engine.renderPage(await doc.save(), 0, 600);
    expect([page.width, page.height]).toEqual([600, 400]);
    // Turned a quarter clockwise: the page's bottom-left corner lands top left, its top-left top right.
    const at = (x: number, y: number) => {
      const [a, b, c, d, e, f] = page.transform;
      return [a * x + c * y + e, b * x + d * y + f].map((v) => Math.round(v * 1000) / 1000);
    };
    expect(at(0, 0)).toEqual([0, 0]);
    expect(at(0, 600)).toEqual([600, 0]);
    expect(at(400, 0)).toEqual([0, 400]);
  });

  it("draws form fields, as the user sees them", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const field = doc.getForm().createTextField("name");
    field.addToPage(page, { x: 50, y: 300, width: 200, height: 20, borderColor: rgb(0, 0, 0), borderWidth: 2 });
    const picture = await engine.renderPage(await doc.save(), 0, 400);
    // Points equal pixels here. The border's bottom edge runs along y = 300, pixel row 100.
    let dark = 0;
    for (let x = 60; x < 240; x++) {
      const i = (99 * 400 + x) * 4;
      const j = (100 * 400 + x) * 4;
      if (picture.rgba[i] < 100 || picture.rgba[j] < 100) dark++;
    }
    expect(dark).toBeGreaterThan(150);
  });
});

describe("applyEdits: replace", () => {
  it("keeps the position: the new run starts within 0.5 point of the old one (chip 14 test 2)", async () => {
    const before = await threeLines();
    const old = run(await engine.listRuns(before, 0), "Second line here");
    const { bytes } = await engine.applyEdits(before, [{ kind: "replace", target: locator(old), text: "Short" }]);
    await reloads(bytes);
    const now = run(await engine.listRuns(bytes, 0), "Short");
    expect(Math.abs(now.bbox[0] - old.bbox[0])).toBeLessThan(0.5);
    expect(Math.abs(now.bbox[1] - old.bbox[1])).toBeLessThan(0.5);
    expect(now.fontSize).toBeCloseTo(12, 3);
  });

  it("keeps a turned run turned, starting where it started", async () => {
    const before = await mixedPage();
    const old = run(await engine.listRuns(before, 0), "Turned text");
    // No descenders in either text, so the baseline side of both boxes is the same edge.
    const { bytes } = await engine.applyEdits(before, [{ kind: "replace", target: locator(old), text: "Turned on" }]);
    const now = run(await engine.listRuns(bytes, 0), "Turned on");
    expect(height(now)).toBeGreaterThan(width(now) * 3);
    expect(Math.abs(now.bbox[1] - old.bbox[1])).toBeLessThan(0.5);
    expect(Math.abs(now.bbox[2] - old.bbox[2])).toBeLessThan(0.5);
  });

  it("keeps the run's font when every character was already drawn in it (chip 14 test 3)", async () => {
    const before = await threeLines();
    const { source, asked } = liberationSource();
    const fontful = new PdfiumAdapter(source, wasm);
    const old = run(await fontful.listRuns(before, 0), "Hello there world");
    // Every letter of "Second here hold" is drawn in Helvetica on this page already.
    const result = await fontful.applyEdits(before, [{ kind: "replace", target: locator(old), text: "Second here hold" }]);
    expect(result.notes).toEqual([]);
    expect(asked).toEqual([]);
    expect(run(await fontful.listRuns(result.bytes, 0), "Second here hold").fontName).toBe("Helvetica");
  });

  it("substitutes the closest Windows font for a character the font cannot hold, with a note (chip 14 test 3)", async () => {
    const before = await threeLines();
    const { source, asked } = liberationSource();
    const fontful = new PdfiumAdapter(source, wasm);
    const old = run(await fontful.listRuns(before, 0), "Hello there world");
    // Omega is not in Helvetica's WinAnsi encoding, so the trial (E3 revised) reads it back wrong.
    const result = await fontful.applyEdits(before, [{ kind: "replace", target: locator(old), text: "Hello Ω" }]);
    expect(result.notes).toEqual([{ kind: "font-substituted", font: "Arial", edit: 0 }]);
    expect(asked).toEqual(["arial.ttf"]);
    const runs = await fontful.listRuns(result.bytes, 0);
    expect(run(runs, "Hello Ω").fontName).toBe("LiberationSans");
    // The run beside it keeps its own font.
    expect(run(runs, "Second line here").fontName).toBe("Helvetica");
    await reloads(result.bytes);
  });

  it("proves coverage across the whole document, not just the page", async () => {
    const doc = await PDFDocument.create();
    const { helvetica } = await fonts(doc);
    doc.addPage([300, 300]).drawText("Page 1", { x: 50, y: 200, size: 24, font: helvetica });
    doc.addPage([300, 300]).drawText("Page 2", { x: 50, y: 200, size: 24, font: helvetica });
    const before = await doc.save();
    const { source, asked } = liberationSource();
    const fontful = new PdfiumAdapter(source, wasm);
    const old = run(await fontful.listRuns(before, 0), "Page 1");
    const result = await fontful.applyEdits(before, [{ kind: "replace", target: locator(old), text: "Page 2" }]);
    expect(result.notes).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("keeps a font that is not embedded when its encoding holds every new character, with no note (E3 revised)", async () => {
    const doc = await PDFDocument.create();
    const { helvetica } = await fonts(doc);
    doc.addPage([300, 300]).drawText("Page 1", { x: 50, y: 200, size: 24, font: helvetica });
    const before = await doc.save();
    const { source, asked } = liberationSource();
    const fontful = new PdfiumAdapter(source, wasm);
    const old = run(await fontful.listRuns(before, 0), "Page 1");
    // "o", "n" and "e" are drawn nowhere in the file, so only the trial can keep Helvetica.
    const result = await fontful.applyEdits(before, [{ kind: "replace", target: locator(old), text: "Page one" }]);
    // Far wider than "Page 1", so E4 notes runs-past-end. There is no font note.
    expect(result.notes).toEqual([{ kind: "runs-past-end", edit: 0 }]);
    expect(asked).toEqual([]);
    expect(run(await fontful.listRuns(result.bytes, 0), "Page one").fontName).toBe("Helvetica");
    // The trial's scratch page is gone again.
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(1);
  });

  it("keeps the proven-present rule for an embedded font: an undrawn letter substitutes, a drawn one does not", async () => {
    const { source } = liberationSource();
    const fontful = new PdfiumAdapter(source, wasm);
    const before = await threeLines();
    // The first edit embeds LiberationSans, drawing "Hello Ω" in it.
    const first = await fontful.applyEdits(before, [
      { kind: "replace", target: locator(run(await fontful.listRuns(before, 0), "Hello there world")), text: "Hello Ω" },
    ]);
    const embedded = run(await fontful.listRuns(first.bytes, 0), "Hello Ω");
    expect(embedded.fontName).toBe("LiberationSans");
    const fontNotes = (notes: { kind: string }[]) => notes.filter((n) => n.kind === "font-substituted");
    const kept = await fontful.applyEdits(first.bytes, [{ kind: "replace", target: locator(embedded), text: "Ω Hello" }]);
    expect(fontNotes(kept.notes)).toEqual([]);
    const swapped = await fontful.applyEdits(first.bytes, [{ kind: "replace", target: locator(embedded), text: "Hello Zed" }]);
    expect(fontNotes(swapped.notes)).toEqual([{ kind: "font-substituted", font: "Arial", edit: 0 }]);
  });

  it("gives each edit its own notes, tagged with its index (spec 21.2)", async () => {
    const before = await threeLines();
    const { source } = liberationSource();
    const fontful = new PdfiumAdapter(source, wasm);
    const runs = await fontful.listRuns(before, 0);
    const result = await fontful.applyEdits(before, [
      { kind: "replace", target: locator(run(runs, "Hello there world")), text: "Ω one" },
      { kind: "delete", target: locator(run(runs, "Bold heading")) },
      { kind: "replace", target: locator(run(runs, "Second line here")), text: "Ω two" },
    ]);
    expect(result.notes).toEqual([
      { kind: "font-substituted", font: "Arial", edit: 0 },
      { kind: "font-substituted", font: "Arial", edit: 2 },
    ]);
  });

  it("falls back to PDFium's standard font, with a note, when the font source has nothing", async () => {
    const before = await threeLines();
    const old = run(await engine.listRuns(before, 0), "Bold heading");
    const result = await engine.applyEdits(before, [{ kind: "replace", target: locator(old), text: "QuizΩ" }]);
    expect(result.notes).toEqual([{ kind: "font-substituted", font: "Helvetica-Bold", edit: 0 }]);
    const now = (await engine.listRuns(result.bytes, 0)).find((r) => r.text.startsWith("Quiz"));
    if (!now) throw new Error("The replaced run is missing.");
    expect(now.fontName).toBe("Helvetica-Bold");
    expect(now.colour).toEqual([255, 0, 0]);
    expect(now.fontSize).toBeCloseTo(20, 3);
  });

  it("never uses a standard font while the font source answers", async () => {
    const before = await threeLines();
    const { source } = liberationSource();
    const fontful = new PdfiumAdapter(source, wasm);
    const runs = await fontful.listRuns(before, 0);
    const result = await fontful.applyEdits(before, [
      { kind: "replace", target: locator(run(runs, "Bold heading")), text: "QuizΩ" },
      { kind: "replace", target: locator(run(runs, "Hello there world")), text: "JumpΩ" },
      { kind: "insert", pageIndex: 0, x: 50, y: 500, text: "Fresh", styleFrom: null },
      { kind: "insert", pageIndex: 0, x: 50, y: 450, text: "XylophoneΩ", styleFrom: locator(run(runs, "Second line here")) },
    ]);
    const after = await fontful.listRuns(result.bytes, 0);
    for (const text of ["QuizΩ", "JumpΩ", "Fresh", "XylophoneΩ"]) expect(run(after, text).fontName).toBe("LiberationSans");
    expect(result.notes).toEqual([
      { kind: "font-substituted", font: "Arial Bold", edit: 0 },
      { kind: "font-substituted", font: "Arial", edit: 1 },
      { kind: "font-substituted", font: "Arial", edit: 3 },
    ]);
  });

  it("refuses a font whose licence forbids embedding", async () => {
    const restricted = new Uint8Array(38);
    const view = new DataView(restricted.buffer);
    view.setUint32(0, 0x00010000);
    view.setUint16(4, 1);
    restricted.set([0x4f, 0x53, 0x2f, 0x32], 12);   // 'OS/2'
    view.setUint32(20, 28);
    view.setUint32(24, 10);
    view.setUint16(36, 0x0002);
    const strict = new PdfiumAdapter(async () => restricted, wasm);
    const before = await threeLines();
    const old = run(await strict.listRuns(before, 0), "Hello there world");
    const err = await rejection(strict.applyEdits(before, [{ kind: "replace", target: locator(old), text: "ZebraΩ" }]));
    expect(err.code).toBe("failed");
    expect(err.message).toMatch(/does not allow embedding/);
  });

  it("squeezes slightly longer text to end within 0.5 point of the old right edge (chip 14 test 4)", async () => {
    const before = await threeLines();
    const old = run(await engine.listRuns(before, 0), "Hello there world");
    const result = await engine.applyEdits(before, [{ kind: "replace", target: locator(old), text: "Hello there worlds" }]);
    expect(result.notes.some((n) => n.kind === "runs-past-end")).toBe(false);
    const now = run(await engine.listRuns(result.bytes, 0), "Hello there worlds");
    expect(Math.abs(now.bbox[2] - old.bbox[2])).toBeLessThan(0.5);
    expect(Math.abs(now.bbox[0] - old.bbox[0])).toBeLessThan(0.5);
  });

  it("stops at 85% and notes runs-past-end for much longer text (chip 14 test 4)", async () => {
    const before = await threeLines();
    const old = run(await engine.listRuns(before, 0), "Hello there world");
    const text = "Hello there world, and a great deal more";
    const result = await engine.applyEdits(before, [{ kind: "replace", target: locator(old), text }]);
    expect(result.notes).toContainEqual({ kind: "runs-past-end", edit: 0 });
    const now = run(await engine.listRuns(result.bytes, 0), text);
    expect(now.bbox[2]).toBeGreaterThan(old.bbox[2] + 10);
    // The same text unsqueezed, inserted at the same place, is wider by 1 / 0.85.
    const plain = await engine.applyEdits(before, [{ kind: "insert", pageIndex: 0, x: 50, y: 300, text, styleFrom: locator(old) }]);
    const full = run(await engine.listRuns(plain.bytes, 0), text);
    expect(width(now) / width(full)).toBeCloseTo(0.85, 2);
  });

  it("does not squeeze shorter text", async () => {
    const before = await threeLines();
    const old = run(await engine.listRuns(before, 0), "Second line here");
    const result = await engine.applyEdits(before, [{ kind: "replace", target: locator(old), text: "Second line" }]);
    const plain = await engine.applyEdits(before, [{ kind: "insert", pageIndex: 0, x: 50, y: 300, text: "Second line", styleFrom: locator(old) }]);
    expect(width(run(await engine.listRuns(result.bytes, 0), "Second line")))
      .toBeCloseTo(width(run(await engine.listRuns(plain.bytes, 0), "Second line")), 3);
  });

  it("treats a replace with only white space as a delete", async () => {
    const before = await threeLines();
    const old = run(await engine.listRuns(before, 0), "Second line here");
    const result = await engine.applyEdits(before, [{ kind: "replace", target: locator(old), text: "  " }]);
    expect((await engine.listRuns(result.bytes, 0)).map((r) => r.text)).toEqual(["Hello there world", "Bold heading"]);
  });
});

describe("applyEdits: delete (chip 14 test 5)", () => {
  it("removes the run and leaves every other run's text and box unchanged", async () => {
    const before = await mixedPage();
    const runs = await engine.listRuns(before, 0);
    const { bytes } = await engine.applyEdits(before, [{ kind: "delete", target: locator(run(runs, "Total due is ")) }]);
    await reloads(bytes);
    const after = await engine.listRuns(bytes, 0);
    const kept = runs.filter((r) => r.text !== "Total due is ");
    expect(after.map((r) => r.text)).toEqual(kept.map((r) => r.text));
    after.forEach((r, i) => {
      r.bbox.forEach((v, k) => expect(Math.abs(v - kept[i].bbox[k])).toBeLessThan(0.01));
      expect(r.fontName).toBe(kept[i].fontName);
      expect(r.colour).toEqual(kept[i].colour);
      expect(r.editable).toBe(kept[i].editable);
    });
  });
});

describe("applyEdits: insert (chip 14 test 6)", () => {
  it("copies font, size and colour from styleFrom, with its baseline at the point given", async () => {
    const before = await threeLines();
    const heading = run(await engine.listRuns(before, 0), "Bold heading");
    // Every letter of "dig in" is drawn in Helvetica-Bold already, so the font is kept.
    const result = await engine.applyEdits(before, [{ kind: "insert", pageIndex: 0, x: 300, y: 400, text: "dig in", styleFrom: locator(heading) }]);
    expect(result.notes).toEqual([]);
    const added = run(await engine.listRuns(result.bytes, 0), "dig in");
    expect(added.fontName).toBe("Helvetica-Bold");
    expect(added.fontSize).toBeCloseTo(20, 3);
    expect(added.colour).toEqual([255, 0, 0]);
    expect(added.bbox[0]).toBeGreaterThanOrEqual(300);
    expect(added.bbox[0]).toBeLessThan(302);
    expect(added.bbox[1]).toBeLessThan(400);        // the "g" hangs below the baseline
    await reloads(result.bytes);
  });

  it("with no styleFrom, draws Arial at 11 point, black: in Node, the standard-font fallback", async () => {
    const before = await threeLines();
    const result = await engine.applyEdits(before, [{ kind: "insert", pageIndex: 0, x: 100, y: 100, text: "New words", styleFrom: null }]);
    expect(result.notes).toEqual([{ kind: "font-substituted", font: "Helvetica", edit: 0 }]);
    const added = run(await engine.listRuns(result.bytes, 0), "New words");
    expect(added.fontName).toBe("Helvetica");
    expect(added.fontSize).toBeCloseTo(11, 3);
    expect(added.colour).toEqual([0, 0, 0]);
  });

  it("with no styleFrom and a font source, draws Arial without a note", async () => {
    const { source, asked } = liberationSource();
    const fontful = new PdfiumAdapter(source, wasm);
    const result = await fontful.applyEdits(await threeLines(), [{ kind: "insert", pageIndex: 0, x: 100, y: 100, text: "New", styleFrom: null }]);
    expect(result.notes).toEqual([]);
    expect(asked).toEqual(["arial.ttf"]);
    expect(run(await fontful.listRuns(result.bytes, 0), "New").fontName).toBe("LiberationSans");
  });

  it("on a page turned by /Rotate, runs upright as the page is shown", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 600]).setRotation(degrees(90));
    const result = await engine.applyEdits(await doc.save(), [{ kind: "insert", pageIndex: 0, x: 100, y: 100, text: "Upright words", styleFrom: null }]);
    const added = run(await engine.listRuns(result.bytes, 0), "Upright words");
    // A quarter turn clockwise on screen, so the text runs up the page in page space.
    expect(height(added)).toBeGreaterThan(width(added) * 4);
    expect(added.bbox[1]).toBeGreaterThanOrEqual(100);
  });

  it("does nothing for empty text", async () => {
    const before = await threeLines();
    const result = await engine.applyEdits(before, [{ kind: "insert", pageIndex: 0, x: 1, y: 1, text: " ", styleFrom: null }]);
    expect((await engine.listRuns(result.bytes, 0)).length).toBe(3);
  });
});

describe("applyEdits: replay and stale locators", () => {
  it("replays three edits in a row, the second targeting the run the first created (chip 14 test 7)", async () => {
    const before = await threeLines();
    const runs = await engine.listRuns(before, 0);
    const first = { kind: "replace" as const, target: locator(run(runs, "Hello there world")), text: "Hello world" };
    // What the editor would see after the first edit, and so what its second edit names.
    const created = run(await engine.listRuns((await engine.applyEdits(before, [first])).bytes, 0), "Hello world");
    const result = await engine.applyEdits(before, [
      first,
      { kind: "replace", target: locator(created), text: "Hello there" },
      { kind: "delete", target: locator(run(runs, "Second line here")) },
    ]);
    await reloads(result.bytes);
    expect((await engine.listRuns(result.bytes, 0)).map((r) => r.text)).toEqual(["Hello there", "Bold heading"]);
  });

  it("fails a stale locator with the spec's message and changes nothing (chip 14 test 8)", async () => {
    const before = await threeLines();
    const copy = before.slice();
    const real = run(await engine.listRuns(before, 0), "Second line here");
    for (const target of [
      { ...locator(real), text: "Not on the page" },
      { ...locator(real), bbox: [real.bbox[0] + 2, real.bbox[1], real.bbox[2], real.bbox[3]] as [number, number, number, number] },
    ]) {
      const err = await rejection(engine.applyEdits(before, [
        { kind: "delete", target: locator(run(await engine.listRuns(before, 0), "Hello there world")) },
        { kind: "replace", target, text: "x" },
      ]));
      expect(err.code).toBe("failed");
      expect(err.message).toBe(PAGE_CHANGED);
    }
    expect(before).toEqual(copy);
  });

  it("deletes text drawn twice over itself, leaving no copy behind", async () => {
    // PDFium's text reader drops the second copy, so it reads as an empty object. It must
    // still go with the run (BUILD-NOTES decision 24).
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const { helvetica } = await fonts(doc);
    page.drawText("Twice", { x: 50, y: 200, size: 24, font: helvetica });
    page.drawText("Other", { x: 50, y: 100, size: 24, font: helvetica });
    page.drawText("Twice", { x: 50.5, y: 200, size: 24, font: helvetica });
    const bytes = await doc.save();
    const runs = await engine.listRuns(bytes, 0);
    expect(runs.map((r) => r.text)).toEqual(["Twice", "Other"]);
    const { bytes: after } = await engine.applyEdits(bytes, [{ kind: "delete", target: locator(runs[0]) }]);
    const picture = await engine.renderPage(after, 0, 300);
    let dark = 0;
    for (let y = 300 - 230; y < 300 - 195; y++) {
      for (let x = 45; x < 130; x++) if (picture.rgba[(y * 300 + x) * 4] < 128) dark++;
    }
    expect(dark).toBe(0);
  });

  it("refuses to edit a run that is not editable", async () => {
    const before = await mixedPage();
    const hidden = run(await engine.listRuns(before, 0), "Hidden layer");
    const err = await rejection(engine.applyEdits(before, [{ kind: "delete", target: locator(hidden) }]));
    expect(err.message).toBe("This text cannot be edited.");
  });

  it("saves a full rewrite, never an append", async () => {
    const before = await threeLines();
    const old = run(await engine.listRuns(before, 0), "Second line here");
    const { bytes } = await engine.applyEdits(before, [{ kind: "delete", target: locator(old) }]);
    expect(bytes.slice(0, before.length)).not.toEqual(before);
  });
});

describe("PDFium's heap", () => {
  // The chip asks for 200 rounds. That cannot show a small leak: PDFium's heap starts with
  // about 18 MB of room, and a leaked page only grew it after some 1,400 listings when this
  // was checked with a mutant that never closed its pages. So listing runs 2,000 times, which
  // takes under half a second. Drawing leaks a whole bitmap if it leaks, so 200 rounds show it.
  it("does not grow when the same file is opened, listed and closed 2,000 times", async () => {
    const bytes = await mixedPage();
    for (let i = 0; i < 20; i++) await engine.listRuns(bytes, 0);
    const settled = await pdfiumHeapSize();
    for (let i = 0; i < 2000; i++) await engine.listRuns(bytes, 0);
    expect(await pdfiumHeapSize()).toBe(settled);
  });

  it("does not grow when the same page, with a form field, is drawn 200 times", async () => {
    const doc = await PDFDocument.load(await mixedPage());
    const field = doc.getForm().createTextField("name");
    field.setText("Typed");
    field.addToPage(doc.getPage(0), { x: 50, y: 100, width: 200, height: 20 });
    const bytes = await doc.save();
    for (let i = 0; i < 20; i++) await engine.renderPage(bytes, 0, 300);
    const settled = await pdfiumHeapSize();
    for (let i = 0; i < 200; i++) await engine.renderPage(bytes, 0, 300);
    expect(await pdfiumHeapSize()).toBe(settled);
  });

  it("does not grow over 50 replays with a loaded font", async () => {
    const before = await threeLines();
    const { source } = liberationSource();
    const fontful = new PdfiumAdapter(source, wasm);
    const target = locator(run(await fontful.listRuns(before, 0), "Hello there world"));
    const replay = () => fontful.applyEdits(before, [{ kind: "replace", target, text: "Zebra crossing" }]);
    for (let i = 0; i < 10; i++) await replay();
    const settled = await pdfiumHeapSize();
    for (let i = 0; i < 50; i++) await replay();
    expect(await pdfiumHeapSize()).toBe(settled);
  });
});
