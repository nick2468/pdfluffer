// Choosing a Windows font for text the run's own font cannot draw (spec 21.4), and reading a
// font file's embedding licence. Pure, so both are tested without PDFium or a font file.

/** The PDF font descriptor flags spec 21.4 reads (PDF 32000-1, table 121). */
export const FONT_FLAG = {
  fixedPitch: 1 << 0,
  serif: 1 << 1,
  italic: 1 << 6,
  forceBold: 1 << 18,
} as const;

export interface FontChoice {
  /** The file in %WINDIR%\Fonts, one of the allowlist in `read_system_font`. */
  file: string;
  /** What the user is told: "Arial Bold". */
  label: string;
  /** PDFium's standard font for the browser harness, when no file can be read. */
  standard: string;
}

interface Family {
  label: string;
  files: [string, string, string, string];       // regular, bold, italic, bold italic
  standard: [string, string, string, string];
}

const ARIAL: Family = {
  label: "Arial",
  files: ["arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"],
  standard: ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"],
};
const TIMES: Family = {
  label: "Times New Roman",
  files: ["times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"],
  standard: ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"],
};
const COURIER: Family = {
  label: "Courier New",
  files: ["cour.ttf", "courbd.ttf", "couri.ttf", "courbi.ttf"],
  standard: ["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"],
};
const CALIBRI: Family = {
  label: "Calibri",
  files: ["calibri.ttf", "calibrib.ttf", "calibrii.ttf", "calibriz.ttf"],
  standard: ARIAL.standard,
};

/** A subset font's name starts with six capitals and a plus sign: "ABCDEF+Calibri-Bold". */
export function withoutSubsetPrefix(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, "");
}

/**
 * Spec 21.4. Fixed pitch gives Courier New, a name with Calibri gives Calibri, serif or a name
 * with Times gives Times New Roman, anything else Arial. A name with Courier counts as fixed
 * pitch too, because the 14 standard fonts carry no flags of their own (BUILD-NOTES decision 24).
 * Bold and italic come from the name or the flags.
 */
export function matchWindowsFont(baseFontName: string, flags: number): FontChoice {
  const name = withoutSubsetPrefix(baseFontName);
  let family: Family;
  if ((flags & FONT_FLAG.fixedPitch) !== 0 || /courier/i.test(name)) family = COURIER;
  else if (/calibri/i.test(name)) family = CALIBRI;
  else if ((flags & FONT_FLAG.serif) !== 0 || /times/i.test(name)) family = TIMES;
  else family = ARIAL;

  const bold = /bold|black|heavy/i.test(name) || (flags & FONT_FLAG.forceBold) !== 0;
  const italic = /italic|oblique/i.test(name) || (flags & FONT_FLAG.italic) !== 0;
  const style = (bold ? 1 : 0) + (italic ? 2 : 0);
  const suffix = ["", " Bold", " Italic", " Bold Italic"][style];
  return { file: family.files[style], label: family.label + suffix, standard: family.standard[style] };
}

/** E10: a page with no text to copy gets Arial, regular. */
export const DEFAULT_FONT: FontChoice = matchWindowsFont("Arial", 0);

/** The OS/2 `fsType` bit that forbids embedding (OpenType spec, OS/2 table). */
export const RESTRICTED_LICENCE = 0x0002;

/**
 * True when a TrueType or OpenType font's OS/2 `fsType` has the restricted-licence bit set,
 * so it must not be embedded (spec 21.4). A font with no OS/2 table carries no restriction.
 * Throws on bytes that are not a font file at all. A collection (.ttc) is read by its first font.
 */
export function embeddingRestricted(font: Uint8Array): boolean {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const need = (end: number) => {
    if (end > font.byteLength) throw new Error("This is not a font file PDFluffer can read.");
  };
  need(12);
  let offset = 0;
  if (view.getUint32(0) === 0x74746366) {        // 'ttcf'
    need(16);
    offset = view.getUint32(12);
    need(offset + 12);
  }
  const version = view.getUint32(offset);
  // 0x00010000 TrueType, 'true' old Apple TrueType, 'OTTO' OpenType with CFF outlines.
  if (version !== 0x00010000 && version !== 0x74727565 && version !== 0x4f54544f) {
    throw new Error("This is not a font file PDFluffer can read.");
  }
  const tables = view.getUint16(offset + 4);
  need(offset + 12 + tables * 16);
  for (let i = 0; i < tables; i++) {
    const record = offset + 12 + i * 16;
    if (view.getUint32(record) !== 0x4f532f32) continue;   // 'OS/2'
    const table = view.getUint32(record + 8);
    need(table + 10);
    return (view.getUint16(table + 8) & RESTRICTED_LICENCE) !== 0;
  }
  return false;
}
