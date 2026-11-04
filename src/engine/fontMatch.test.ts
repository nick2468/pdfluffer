import { describe, expect, it } from "vitest";
import { DEFAULT_FONT, embeddingRestricted, FONT_FLAG, matchWindowsFont, withoutSubsetPrefix } from "./fontMatch";

// Spec 21.4. Every font here is a name and a number, or a hand-made header: no font file.

describe("matchWindowsFont", () => {
  const cases: [string, number, string, string][] = [
    // base font name, flags, file, label
    ["Helvetica", 32, "arial.ttf", "Arial"],
    ["ArialMT", 32, "arial.ttf", "Arial"],
    ["Arial-BoldMT", 32, "arialbd.ttf", "Arial Bold"],
    ["Helvetica-Oblique", 32, "ariali.ttf", "Arial Italic"],
    ["Helvetica-BoldOblique", 32, "arialbi.ttf", "Arial Bold Italic"],
    ["Verdana", 32, "arial.ttf", "Arial"],
    ["Roboto-Black", 32, "arialbd.ttf", "Arial Bold"],
    ["SomeSans-Heavy", 32, "arialbd.ttf", "Arial Bold"],
    ["Times-Roman", 32, "times.ttf", "Times New Roman"],
    ["TimesNewRomanPS-BoldItalicMT", 32, "timesbi.ttf", "Times New Roman Bold Italic"],
    ["Georgia", FONT_FLAG.serif, "times.ttf", "Times New Roman"],
    ["Georgia", FONT_FLAG.serif | FONT_FLAG.italic, "timesi.ttf", "Times New Roman Italic"],
    ["Courier", 32, "cour.ttf", "Courier New"],
    ["Courier-Bold", 32, "courbd.ttf", "Courier New Bold"],
    ["Consolas", FONT_FLAG.fixedPitch, "cour.ttf", "Courier New"],
    ["Consolas", FONT_FLAG.fixedPitch | FONT_FLAG.serif, "cour.ttf", "Courier New"],
    ["ABCDEF+Calibri", 32, "calibri.ttf", "Calibri"],
    ["ABCDEF+Calibri-Bold", 32, "calibrib.ttf", "Calibri Bold"],
    ["Calibri-Italic", 32, "calibrii.ttf", "Calibri Italic"],
    ["Calibri-BoldItalic", 32, "calibriz.ttf", "Calibri Bold Italic"],
    ["Calibri", FONT_FLAG.serif, "calibri.ttf", "Calibri"],
    ["Plain", FONT_FLAG.forceBold, "arialbd.ttf", "Arial Bold"],
    ["Plain", FONT_FLAG.italic, "ariali.ttf", "Arial Italic"],
    ["", 0, "arial.ttf", "Arial"],
  ];

  it.each(cases)("%s with flags %i gives %s", (name, flags, file, label) => {
    const choice = matchWindowsFont(name, flags);
    expect(choice.file).toBe(file);
    expect(choice.label).toBe(label);
  });

  it("gives a standard font of the same family and style for the browser harness", () => {
    expect(matchWindowsFont("Arial-BoldMT", 0).standard).toBe("Helvetica-Bold");
    expect(matchWindowsFont("Calibri-Italic", 0).standard).toBe("Helvetica-Oblique");
    expect(matchWindowsFont("Times-BoldItalic", 0).standard).toBe("Times-BoldItalic");
    expect(matchWindowsFont("Courier-Oblique", 0).standard).toBe("Courier-Oblique");
  });

  it("uses Arial, regular, for an insert with nothing to copy (E10)", () => {
    expect(DEFAULT_FONT).toEqual({ file: "arial.ttf", label: "Arial", standard: "Helvetica" });
  });

  it("only ever names a file on read_system_font's allowlist", () => {
    const allowlist = new Set([
      "arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf", "times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf",
      "cour.ttf", "courbd.ttf", "couri.ttf", "courbi.ttf", "calibri.ttf", "calibrib.ttf", "calibrii.ttf", "calibriz.ttf",
    ]);
    for (const [name, flags] of cases) expect(allowlist.has(matchWindowsFont(name, flags).file)).toBe(true);
  });
});

describe("withoutSubsetPrefix", () => {
  it("drops six capitals and a plus sign, and nothing else", () => {
    expect(withoutSubsetPrefix("ABCDEF+Calibri")).toBe("Calibri");
    expect(withoutSubsetPrefix("ABCDE+Calibri")).toBe("ABCDE+Calibri");
    expect(withoutSubsetPrefix("Calibri")).toBe("Calibri");
  });
});

/** A minimal TrueType header: one table, OS/2, holding only up to its fsType field. */
function fontHeader(fsType: number, tag = "OS/2", version = 0x00010000): Uint8Array {
  const bytes = new Uint8Array(12 + 16 + 10);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, version);
  view.setUint16(4, 1);                       // numTables
  for (let i = 0; i < 4; i++) bytes[12 + i] = tag.charCodeAt(i);
  view.setUint32(12 + 8, 28);                 // table offset
  view.setUint32(12 + 12, 10);                // table length
  view.setUint16(28 + 8, fsType);             // OS/2 fsType
  return bytes;
}

describe("embeddingRestricted", () => {
  it("refuses a font whose fsType has the restricted-licence bit", () => {
    expect(embeddingRestricted(fontHeader(0x0002))).toBe(true);
    expect(embeddingRestricted(fontHeader(0x0002 | 0x0100))).toBe(true);
  });

  it("allows installable, preview-and-print and editable fonts", () => {
    expect(embeddingRestricted(fontHeader(0x0000))).toBe(false);
    expect(embeddingRestricted(fontHeader(0x0004))).toBe(false);
    expect(embeddingRestricted(fontHeader(0x0008))).toBe(false);
  });

  it("allows a font with no OS/2 table, which carries no restriction", () => {
    expect(embeddingRestricted(fontHeader(0x0002, "head"))).toBe(false);
  });

  it("reads an OpenType font with CFF outlines", () => {
    expect(embeddingRestricted(fontHeader(0x0002, "OS/2", 0x4f54544f))).toBe(true);
  });

  it("reads the first font of a collection", () => {
    const inner = fontHeader(0x0002);
    const ttc = new Uint8Array(16 + inner.length);
    const view = new DataView(ttc.buffer);
    view.setUint32(0, 0x74746366);            // 'ttcf'
    view.setUint32(12, 16);                    // first font's offset
    ttc.set(inner, 16);
    // The table offset inside is from the start of the file, so move it along.
    new DataView(ttc.buffer).setUint32(16 + 12 + 8, 16 + 28);
    expect(embeddingRestricted(ttc)).toBe(true);
  });

  it("throws on bytes that are not a font", () => {
    expect(() => embeddingRestricted(new TextEncoder().encode("%PDF-1.7 not a font"))).toThrow();
    expect(() => embeddingRestricted(new Uint8Array(4))).toThrow();
  });

  it("reads the real LiberationSans that PDF.js ships as allowed", async () => {
    const { readFileSync } = await import("node:fs");
    const font = readFileSync(new URL("../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf", import.meta.url));
    expect(embeddingRestricted(font)).toBe(false);
  });
});
