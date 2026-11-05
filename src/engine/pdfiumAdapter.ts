// The PDFium engine (spec 21). The only file under src/ that imports @embedpdf/pdfium, the way
// pdfLibAdapter.ts is the only one that imports pdf-lib. It lists a page's text runs, draws a
// page for the editor, and replays text edits.
//
// The library is a dynamic import inside the first call, so it is a chunk of its own, and the
// .wasm is fetched from the app's own origin at the same moment. A reader who never edits text
// downloads neither. The top-level imports are a type and the .wasm's URL, a plain string.
//
// PDFium works on its own heap. Every document, page, text page, bitmap, font and buffer opened
// here is closed in a `finally`, and a unit test opens the same file 200 times to prove the
// heap stays the same size.

import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import { EngineError, type Capability, type EngineAdapter, type EngineOp, type EngineResult } from "./EngineAdapter";
import { DEFAULT_FONT, embeddingRestricted, matchWindowsFont, type FontChoice } from "./fontMatch";
import { directionOf, extentAlong, groupRuns, matchesLocator, type GroupedRun, type TextObjectInfo } from "./runGrouping";
import {
  PAGE_CHANGED, type EditNote, type FontSource, type NotEditableReason, type RenderedPage, type RunLocator,
  type TextEdit, type TextEditEngine, type TextRun,
} from "./textEdit";

type Pdfium = WrappedPdfiumModule;
/** Where the .wasm's bytes come from. The app fetches its own copy; a unit test reads the file. */
export type WasmLoader = () => Promise<ArrayBuffer>;

let loading: Promise<Pdfium> | null = null;

/**
 * PDFium's memory as bytes. The package types its module over @types/emscripten, which this
 * project does not install, so the view is named here. Read it afresh each time: it is
 * replaced whenever the heap grows.
 */
function heapOf(m: Pdfium): Uint8Array {
  return (m.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
}

/** Loads PDFium once. A failed load is not cached, so the next call tries again. */
function loadPdfium(wasm: WasmLoader): Promise<Pdfium> {
  loading ??= (async () => {
    // Destructured straight from the import, so the bundler can see `init` is the only export
    // used and leave out the package's built-in CDN address (BUILD-NOTES decision 23).
    const { init } = await import("@embedpdf/pdfium");
    // With the bytes handed over, the package never looks for the .wasm itself.
    const module = await init({ wasmBinary: await wasm() });
    module.PDFiumExt_Init();
    return module;
  })().catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}

/** The app's own copy of the .wasm, emitted by Vite into dist/assets. */
async function fetchOwnWasm(): Promise<ArrayBuffer> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`The PDF text engine did not load (${response.status}).`);
  return response.arrayBuffer();
}

/** For the leak test: the size of PDFium's heap, once it has loaded. */
export async function pdfiumHeapSize(): Promise<number> {
  if (!loading) throw new Error("PDFium has not loaded.");
  return heapOf(await loading).length;
}

const CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>(['text.edit']);

// PDFium's constants (fpdfview.h, fpdf_edit.h, fpdf_text.h).
const FPDF_PAGEOBJ_TEXT = 1;
const FPDF_ANNOT = 0x01;
const FPDF_REVERSE_BYTE_ORDER = 0x10;      // draws RGBA instead of BGRA
const FPDFBITMAP_BGRA = 4;
const FPDF_FONT_TRUETYPE = 2;
const FPDF_ERR_PASSWORD = 4;
const FPDF_ERR_SECURITY = 5;
const RENDER_STROKE = 1;
const RENDER_FILL_STROKE = 2;
const RENDER_INVISIBLE = 3;
const RENDER_CLIP_FIRST = 4;
const RENDER_INVISIBLE_CLIP = 7;
/** The fallback size for an insert with nothing to copy (E10). */
const DEFAULT_SIZE = 11;
/** E4's floor: narrower than 85% is noticeable. */
const MIN_SQUEEZE = 0.85;

export class PdfiumAdapter implements EngineAdapter, TextEditEngine {
  readonly name = "PDFium";

  /**
   * `fontSource` gives Windows font files by name (spec 21.4). Null, or a null answer, falls
   * back to PDFium's standard fonts, which only the browser harness and the unit tests need.
   */
  constructor(
    readonly fontSource: FontSource | null = null,
    private readonly wasm: WasmLoader = fetchOwnWasm,
  ) {}

  capabilities(): ReadonlySet<Capability> {
    return CAPABILITIES;
  }

  async run(op: EngineOp, bytes: Uint8Array): Promise<EngineResult> {
    if (op.kind !== 'text.edits') throw new EngineError('unsupported', `PDFium cannot run ${op.kind}.`);
    const result = await this.applyEdits(bytes, op.edits);
    return { bytes: result.bytes, mode: 'rewrite' };
  }

  async listRuns(bytes: Uint8Array, pageIndex: number): Promise<TextRun[]> {
    const doc = new Pdf(await this.module()).open(bytes);
    try {
      return doc.page(pageIndex).read().runs.map((run, i) => toTextRun(run, pageIndex, i));
    } catch (err) {
      throw asEngineError(err);
    } finally {
      doc.close();
    }
  }

  async renderPage(bytes: Uint8Array, pageIndex: number, maxDimension: number): Promise<RenderedPage> {
    const doc = new Pdf(await this.module()).open(bytes);
    try {
      return doc.render(pageIndex, maxDimension);
    } catch (err) {
      throw asEngineError(err);
    } finally {
      doc.close();
    }
  }

  async applyEdits(bytes: Uint8Array, edits: TextEdit[]): Promise<{ bytes: Uint8Array; notes: EditNote[] }> {
    const doc = new Pdf(await this.module()).open(bytes);
    const editor = new Editor(doc, this.fontSource);
    try {
      // E3 asks what each font has drawn in the document as it came in, so this is read
      // before the first edit changes anything. A list of deletes never needs it.
      if (edits.some((edit) => edit.kind !== 'delete')) editor.readCoverage();
      for (const [index, edit] of edits.entries()) await editor.apply(edit, index);
      return { bytes: editor.finish(), notes: editor.notes };
    } catch (err) {
      throw asEngineError(err);
    } finally {
      editor.close();
      doc.close();
    }
  }

  private async module(): Promise<Pdfium> {
    try {
      return await loadPdfium(this.wasm);
    } catch (err) {
      throw new EngineError('failed', `Could not load the PDF text engine. ${messageOf(err)}`);
    }
  }
}

function toTextRun(run: PageRun, pageIndex: number, i: number): TextRun {
  const first = run.records[0];
  return {
    id: `${pageIndex}:${i}`,
    pageIndex,
    text: run.text,
    bbox: run.bbox,
    fontName: first.fontName,
    fontSize: first.info.size,
    colour: first.info.colour,
    editable: first.info.notEditable === undefined,
    ...(first.info.notEditable ? { reason: first.info.notEditable } : {}),
  };
}

/** A text object as the adapter needs it: the grouping input plus what an edit copies. */
interface ObjectRecord {
  handle: number;
  /** Its index among all the page's objects, text or not. */
  index: number;
  info: TextObjectInfo;
  font: number;
  fontName: string;
  fontFlags: number;
  /** The font size the content stream sets, before the matrix scales it. */
  fontSize: number;
  alpha: number;
  stroke: [number, number, number, number];
  strokeWidth: number;
}

interface PageRun extends GroupedRun {
  records: ObjectRecord[];
}

interface FontInfo {
  name: string;
  flags: number;
  type3: boolean;
}

/** Thin, typed access to PDFium's heap, with 64 bytes of scratch memory for out-parameters. */
class Pdf {
  /** Reused by every call that does not await in between. Freed when the document closes. */
  readonly scratch: number;

  constructor(readonly m: Pdfium) {
    this.scratch = this.malloc(64);
  }

  malloc(size: number): number {
    const ptr = this.m.pdfium.wasmExports.malloc(size);
    if (!ptr) throw new EngineError('failed', "The PDF text engine ran out of memory.");
    return ptr;
  }

  free(ptr: number): void {
    this.m.pdfium.wasmExports.free(ptr);
  }

  copyIn(bytes: Uint8Array): number {
    const ptr = this.malloc(Math.max(1, bytes.length));
    heapOf(this.m).set(bytes, ptr);
    return ptr;
  }

  f32(ptr: number, i = 0): number {
    return this.m.pdfium.getValue(ptr + 4 * i, 'float');
  }

  f64(ptr: number, i = 0): number {
    return this.m.pdfium.getValue(ptr + 8 * i, 'double');
  }

  u32(ptr: number, i = 0): number {
    return this.m.pdfium.getValue(ptr + 4 * i, 'i32') >>> 0;
  }

  setF32(ptr: number, values: number[]): void {
    values.forEach((v, i) => this.m.pdfium.setValue(ptr + 4 * i, v, 'float'));
  }

  /** A UTF-16 string from a PDFium "ask for the length in bytes, then fill" pair of calls. */
  utf16(call: (buffer: number, length: number) => number): string {
    const length = call(0, 0);
    if (length <= 2) return "";
    const buffer = this.malloc(length);
    try {
      call(buffer, length);
      return this.m.pdfium.UTF16ToString(buffer);
    } finally {
      this.free(buffer);
    }
  }

  /** The same for a UTF-8 string. */
  utf8(call: (buffer: number, length: number) => number): string {
    const length = call(0, 0);
    if (length <= 1) return "";
    const buffer = this.malloc(length);
    try {
      call(buffer, length);
      return this.m.pdfium.UTF8ToString(buffer);
    } finally {
      this.free(buffer);
    }
  }

  /** Opens a document over a copy of the bytes. Throws EngineError('encrypted') on encryption. */
  open(bytes: Uint8Array): Doc {
    const buffer = this.copyIn(bytes);
    const handle = this.m.FPDF_LoadMemDocument(buffer, bytes.length, "");
    let refusal: EngineError | null = null;
    if (!handle) {
      const code = this.m.FPDF_GetLastError();
      refusal = code === FPDF_ERR_PASSWORD || code === FPDF_ERR_SECURITY
        ? new EngineError('encrypted', "This PDF is password-protected.")
        : new EngineError('failed', `The PDF text engine could not read this PDF (error ${code}).`);
    } else if (this.m.EPDF_IsEncrypted(handle)) {
      // Like pdf-lib (spec 13.4): any encryption at all, even with an empty password, is refused.
      this.m.FPDF_CloseDocument(handle);
      refusal = new EngineError('encrypted', "This PDF is password-protected.");
    }
    if (refusal) {
      this.free(buffer);
      this.free(this.scratch);
      throw refusal;
    }
    return new Doc(this, handle, buffer);
  }
}

class Doc {
  private readonly pages = new Map<number, Page>();

  constructor(readonly pdf: Pdf, readonly handle: number, private readonly buffer: number) {}

  get m(): Pdfium {
    return this.pdf.m;
  }

  get pageCount(): number {
    return this.m.FPDF_GetPageCount(this.handle);
  }

  /** The page, opened once and kept open until the document closes. */
  page(pageIndex: number): Page {
    let page = this.pages.get(pageIndex);
    if (page) return page;
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.pageCount) {
      throw new EngineError('failed', `This document has no page ${pageIndex + 1}.`);
    }
    const handle = this.m.FPDF_LoadPage(this.handle, pageIndex);
    if (!handle) throw new EngineError('failed', `The PDF text engine could not read page ${pageIndex + 1}.`);
    page = new Page(this, handle, pageIndex);
    this.pages.set(pageIndex, page);
    return page;
  }

  /** Spec 21.2 renderPage: white, with annotations and form fields drawn as the user sees them. */
  render(pageIndex: number, maxDimension: number): RenderedPage {
    const { m } = this;
    const page = this.page(pageIndex);
    const widthPt = m.FPDF_GetPageWidthF(page.handle);
    const heightPt = m.FPDF_GetPageHeightF(page.handle);
    const scale = maxDimension / Math.max(widthPt, heightPt);
    const width = Math.max(1, Math.round(widthPt * scale));
    const height = Math.max(1, Math.round(heightPt * scale));

    // Form fields are widgets, which PDFium draws only through its form environment.
    const formInfo = m.PDFiumExt_OpenFormFillInfo();
    const form = formInfo ? m.PDFiumExt_InitFormFillEnvironment(this.handle, formInfo) : 0;
    const bitmap = m.FPDFBitmap_CreateEx(width, height, FPDFBITMAP_BGRA, 0, 0);
    try {
      if (!bitmap) throw new EngineError('failed', "The PDF text engine could not draw this page.");
      if (form) m.FORM_OnAfterLoadPage(page.handle, form);
      m.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
      const flags = FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER;
      m.FPDF_RenderPageBitmap(bitmap, page.handle, 0, 0, width, height, 0, flags);
      if (form) m.FPDF_FFLDraw(form, bitmap, page.handle, 0, 0, width, height, 0, flags);

      const stride = m.FPDFBitmap_GetStride(bitmap);
      const source = m.FPDFBitmap_GetBuffer(bitmap);
      const rgba = new Uint8ClampedArray(width * height * 4);
      const heap = heapOf(m);
      for (let y = 0; y < height; y++) {
        rgba.set(heap.subarray(source + y * stride, source + y * stride + width * 4), y * width * 4);
      }
      return { rgba, width, height, transform: page.pixelTransform(width, height) };
    } finally {
      if (bitmap) m.FPDFBitmap_Destroy(bitmap);
      if (form) {
        m.FORM_OnBeforeClosePage(page.handle, form);
        m.PDFiumExt_ExitFormFillEnvironment(form);
      }
      if (formInfo) m.PDFiumExt_CloseFormFillInfo(formInfo);
    }
  }

  /** Saves with PDFium's full rewrite (spec 21.3). Never an incremental append. */
  save(): Uint8Array {
    const { m, pdf } = this;
    const writer = m.PDFiumExt_OpenFileWriter();
    if (!writer) throw new EngineError('failed', "The PDF text engine could not save.");
    try {
      if (!m.PDFiumExt_SaveAsCopy(this.handle, writer)) {
        throw new EngineError('failed', "The PDF text engine could not save.");
      }
      const size = m.PDFiumExt_GetFileWriterSize(writer);
      const buffer = pdf.malloc(size);
      try {
        m.PDFiumExt_GetFileWriterData(writer, buffer, size);
        return heapOf(m).slice(buffer, buffer + size);
      } finally {
        pdf.free(buffer);
      }
    } finally {
      m.PDFiumExt_CloseFileWriter(writer);
    }
  }

  close(): void {
    for (const page of this.pages.values()) this.m.FPDF_ClosePage(page.handle);
    this.pages.clear();
    this.m.FPDF_CloseDocument(this.handle);
    this.pdf.free(this.buffer);
    this.pdf.free(this.pdf.scratch);
  }
}

class Page {
  constructor(readonly doc: Doc, readonly handle: number, readonly index: number) {}

  /**
   * Reads every page-level text object and groups them into runs. Text inside a form XObject
   * is not a page-level object, so it never appears (spec 21.1 E9). Neither do form fields and
   * annotations, which are not page content at all.
   */
  read(): { records: ObjectRecord[]; runs: PageRun[] } {
    const { m, pdf } = this.doc;
    const textPage = m.FPDFText_LoadPage(this.handle);
    if (!textPage) throw new EngineError('failed', `The PDF text engine could not read page ${this.index + 1}.`);
    try {
      const vertical = this.verticalObjects(textPage);
      const fonts = new Map<number, FontInfo>();
      const records: ObjectRecord[] = [];
      const s = pdf.scratch;
      const count = m.FPDFPage_CountObjects(this.handle);
      for (let index = 0; index < count; index++) {
        const handle = m.FPDFPage_GetObject(this.handle, index);
        if (!handle || m.FPDFPageObj_GetType(handle) !== FPDF_PAGEOBJ_TEXT) continue;

        const text = pdf.utf16((buffer, length) => m.FPDFTextObj_GetText(handle, textPage, buffer, length));
        const font = m.FPDFTextObj_GetFont(handle);
        let fontInfo = fonts.get(font);
        if (!fontInfo) {
          fontInfo = this.fontInfo(font);
          fonts.set(font, fontInfo);
        }
        const fontSize = m.FPDFTextObj_GetFontSize(handle, s) ? pdf.f32(s) : 0;
        m.FPDFPageObj_GetMatrix(handle, s);
        const matrix = [0, 1, 2, 3, 4, 5].map((i) => pdf.f32(s, i));
        m.FPDFPageObj_GetFillColor(handle, s, s + 4, s + 8, s + 12);
        const colour: [number, number, number] = [pdf.u32(s, 0), pdf.u32(s, 1), pdf.u32(s, 2)];
        const alpha = pdf.u32(s, 3);
        m.FPDFPageObj_GetStrokeColor(handle, s, s + 4, s + 8, s + 12);
        const stroke: [number, number, number, number] = [pdf.u32(s, 0), pdf.u32(s, 1), pdf.u32(s, 2), pdf.u32(s, 3)];
        const strokeWidth = m.FPDFPageObj_GetStrokeWidth(handle, s) ? pdf.f32(s) : 1;
        m.FPDFPageObj_GetBounds(handle, s, s + 4, s + 8, s + 12);
        const bounds: [number, number, number, number] = [pdf.f32(s, 0), pdf.f32(s, 1), pdf.f32(s, 2), pdf.f32(s, 3)];
        const quad = this.quadOf(handle) ?? boxQuad(bounds);
        const renderMode = m.FPDFTextObj_GetTextRenderMode(handle);

        records.push({
          handle, index, font, fontName: fontInfo.name, fontFlags: fontInfo.flags, fontSize, alpha, stroke, strokeWidth,
          info: {
            text, fontKey: font, size: fontSize * Math.hypot(matrix[2], matrix[3]), colour, renderMode, matrix, quad, bounds,
            notEditable: notEditable(renderMode, fontInfo, vertical.has(handle)),
          },
        });
      }
      const runs = groupRuns(records.map((r) => r.info)).map((run) => ({
        ...run,
        records: run.members.map((i) => records[i]),
      }));
      return { records, runs };
    } finally {
      m.FPDFText_ClosePage(textPage);
    }
  }

  /** The object's box turned with its text, or null when PDFium cannot give one. */
  quadOf(handle: number): number[] | null {
    const { m, pdf } = this.doc;
    const quad = pdf.scratch + 16;
    if (!m.FPDFPageObj_GetRotatedBounds(handle, quad)) return null;
    return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => pdf.f32(quad, i));
  }

  private fontInfo(font: number): FontInfo {
    const { m, pdf } = this.doc;
    const name = font ? pdf.utf8((buffer, length) => m.FPDFFont_GetBaseFontName(font, buffer, length)) : "";
    const flags = font ? m.FPDFFont_GetFlags(font) : 0;
    // PDFium counts a Type 3 font as embedded, but it has no font program to hand back.
    let type3 = false;
    if (font && m.FPDFFont_GetIsEmbedded(font) && m.FPDFFont_GetFontData(font, 0, 0, pdf.scratch)) {
      type3 = pdf.u32(pdf.scratch) === 0;
    }
    return { name, flags, type3 };
  }

  /**
   * Text objects written vertically: their characters step across the text direction rather
   * than along it. PDFium does not say whether a font writes vertically, so this measures it.
   * An object of one character cannot be told apart, and counts as horizontal.
   */
  private verticalObjects(textPage: number): Set<number> {
    const { m, pdf } = this.doc;
    const first = new Map<number, [number, number]>();
    const last = new Map<number, [number, number]>();
    const x = pdf.scratch + 48;
    const y = pdf.scratch + 56;
    const count = m.FPDFText_CountChars(textPage);
    for (let i = 0; i < count; i++) {
      const object = m.FPDFText_GetTextObject(textPage, i);
      if (!object || !m.FPDFText_GetCharOrigin(textPage, i, x, y)) continue;
      const origin: [number, number] = [pdf.f64(x), pdf.f64(y)];
      if (!first.has(object)) first.set(object, origin);
      last.set(object, origin);
    }
    const vertical = new Set<number>();
    for (const [object, start] of first) {
      const end = last.get(object) ?? start;
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      if (dx === 0 && dy === 0) continue;
      m.FPDFPageObj_GetMatrix(object, pdf.scratch);
      const dir = directionOf([pdf.f32(pdf.scratch, 0), pdf.f32(pdf.scratch, 1)]);
      const along = dx * dir[0] + dy * dir[1];
      const across = -dx * dir[1] + dy * dir[0];
      if (Math.abs(across) > Math.abs(along)) vertical.add(object);
    }
    return vertical;
  }

  /**
   * PDF points to picture pixels, in PDF.js's [a b c d e f] form, for a picture of this size.
   * Taken from PDFium's own device mapping, which already holds the page's /Rotate.
   */
  pixelTransform(width: number, height: number): number[] {
    const { m, pdf } = this.doc;
    const x = pdf.scratch + 48;
    const y = pdf.scratch + 56;
    const toPage = (dx: number, dy: number): [number, number] => {
      m.FPDF_DeviceToPage(this.handle, 0, 0, width, height, 0, dx, dy, x, y);
      return [pdf.f64(x), pdf.f64(y)];
    };
    // Device to page is affine: page = origin + dx * u + dy * v. Invert it.
    const origin = toPage(0, 0);
    const right = toPage(width, 0);
    const down = toPage(0, height);
    const u = [(right[0] - origin[0]) / width, (right[1] - origin[1]) / width];
    const v = [(down[0] - origin[0]) / height, (down[1] - origin[1]) / height];
    const det = u[0] * v[1] - v[0] * u[1];
    const a = v[1] / det;
    const b = -u[1] / det;
    const c = -v[0] / det;
    const d = u[0] / det;
    return [a, b, c, d, -(a * origin[0] + c * origin[1]), -(b * origin[0] + d * origin[1])];
  }

  removeObject(handle: number): void {
    const { m } = this.doc;
    if (!m.FPDFPage_RemoveObject(this.handle, handle)) {
      throw new EngineError('failed', "The PDF text engine could not remove the old text.");
    }
    m.FPDFPageObj_Destroy(handle);
  }
}

function boxQuad([l, b, r, t]: [number, number, number, number]): number[] {
  return [l, b, r, b, r, t, l, t];
}

function notEditable(renderMode: number, font: FontInfo, vertical: boolean): NotEditableReason | undefined {
  if (renderMode === RENDER_INVISIBLE || renderMode === RENDER_INVISIBLE_CLIP) return 'invisible';
  if (renderMode >= RENDER_CLIP_FIRST) return 'clipping';
  if (font.type3) return 'type3-font';
  if (vertical) return 'vertical';
  return undefined;
}

/** What an inserted or replacing object copies from a run (E10, spec 21.3). */
interface Style {
  font: number;
  fontName: string;
  fontFlags: number;
  fontSize: number;
  matrix: number[];
  colour: [number, number, number];
  alpha: number;
  renderMode: number;
  stroke: [number, number, number, number];
  strokeWidth: number;
}

function styleOf(record: ObjectRecord): Style {
  return {
    font: record.font, fontName: record.fontName, fontFlags: record.fontFlags, fontSize: record.fontSize,
    matrix: record.info.matrix, colour: record.info.colour, alpha: record.alpha, renderMode: record.info.renderMode,
    stroke: record.stroke, strokeWidth: record.strokeWidth,
  };
}

/** E10: Arial 11 point black, upright as the page is shown, so turned against its /Rotate. */
function defaultStyle(rotation: number): Style {
  // FPDFPage_GetRotation counts quarter turns clockwise. Upright text then runs anticlockwise.
  const [cos, sin] = [[1, 0], [0, 1], [-1, 0], [0, -1]][((rotation % 4) + 4) % 4];
  return {
    font: 0, fontName: DEFAULT_FONT.label, fontFlags: 0, fontSize: DEFAULT_SIZE,
    matrix: [cos, sin, -sin, cos, 0, 0], colour: [0, 0, 0], alpha: 255, renderMode: 0,
    stroke: [0, 0, 0, 255], strokeWidth: 1,
  };
}

/** A font PDFium loaded for this replay, and the name a note gives it. */
interface LoadedFont {
  handle: number;
  shownAs: string;
  /** False for PDFium's standard fonts, the browser harness's stand-ins. */
  windows: boolean;
}

/** A note before it knows which edit caused it. */
type NoteKind = { kind: 'font-substituted'; font: string } | { kind: 'runs-past-end' };

/** One replay of an edit list over one open document (spec 21.1 E7). */
class Editor {
  readonly notes: EditNote[] = [];
  /** The index of the edit being applied, which every note carries (spec 21.2). */
  private editIndex = 0;
  private readonly coverage = new Map<number, Set<string>>();
  private readonly loaded = new Map<string, LoadedFont>();
  private readonly ownFonts = new Set<number>();
  private readonly fontBuffers: number[] = [];
  private readonly changed = new Set<Page>();

  constructor(private readonly doc: Doc, private readonly fontSource: FontSource | null) {}

  /** E3: for each font object, every character it has drawn anywhere in the document. */
  readCoverage(): void {
    const { m, pdf } = this.doc;
    for (let i = 0; i < this.doc.pageCount; i++) {
      const page = this.doc.page(i);
      const textPage = m.FPDFText_LoadPage(page.handle);
      if (!textPage) continue;
      try {
        const count = m.FPDFPage_CountObjects(page.handle);
        for (let index = 0; index < count; index++) {
          const handle = m.FPDFPage_GetObject(page.handle, index);
          if (!handle || m.FPDFPageObj_GetType(handle) !== FPDF_PAGEOBJ_TEXT) continue;
          const font = m.FPDFTextObj_GetFont(handle);
          const text = pdf.utf16((buffer, length) => m.FPDFTextObj_GetText(handle, textPage, buffer, length));
          let drawn = this.coverage.get(font);
          if (!drawn) {
            drawn = new Set();
            this.coverage.set(font, drawn);
          }
          for (const ch of text) drawn.add(ch);
        }
      } finally {
        m.FPDFText_ClosePage(textPage);
      }
    }
  }

  async apply(edit: TextEdit, index: number): Promise<void> {
    this.editIndex = index;
    switch (edit.kind) {
      case 'replace':
        return this.replace(edit.target, edit.text);
      case 'delete':
        return this.remove(edit.target);
      case 'insert':
        return this.insert(edit.pageIndex, edit.x, edit.y, edit.text, edit.styleFrom);
      default:
        throw new EngineError('unsupported', `Unknown text edit ${(edit as TextEdit).kind}.`);
    }
  }

  /** Spec 21.3 replace: remove the run, draw the new text at its first object's matrix. */
  private async replace(target: RunLocator, text: string): Promise<void> {
    if (text.trim() === "") return this.remove(target);
    const { page, run } = this.locate(target);
    const style = styleOf(run.records[0]);
    const font = await this.fontFor(style, text);
    const at = run.records[0].index;
    const object = this.createText(font, style, text, style.matrix);
    this.squeeze(page, object, style.matrix, run.end);
    for (const record of [...run.records].reverse()) page.removeObject(record.handle);
    if (!this.doc.m.FPDFPage_InsertObjectAtIndex(page.handle, object, at)) this.doc.m.FPDFPage_InsertObject(page.handle, object);
    this.changed.add(page);
  }

  /** Spec 21.3 delete. */
  private remove(target: RunLocator): void {
    const { page, run } = this.locate(target);
    for (const record of [...run.records].reverse()) page.removeObject(record.handle);
    this.changed.add(page);
  }

  /** Spec 21.3 insert, styled per E10. */
  private async insert(pageIndex: number, x: number, y: number, text: string, styleFrom: RunLocator | null): Promise<void> {
    if (text.trim() === "") return;
    const page = this.doc.page(pageIndex);
    let style: Style;
    let font: number;
    if (styleFrom) {
      style = styleOf(this.locate(styleFrom).run.records[0]);
      font = await this.fontFor(style, text);
    } else {
      style = defaultStyle(this.doc.m.FPDFPage_GetRotation(page.handle));
      font = await this.load(DEFAULT_FONT, false);
    }
    const [a, b, c, d] = style.matrix;
    const object = this.createText(font, style, text, [a, b, c, d, x, y]);
    this.doc.m.FPDFPage_InsertObject(page.handle, object);
    this.changed.add(page);
  }

  /** Generates each changed page's content and saves the whole file. */
  finish(): Uint8Array {
    for (const page of this.changed) {
      if (!this.doc.m.FPDFPage_GenerateContent(page.handle)) {
        throw new EngineError('failed', `The PDF text engine could not write page ${page.index + 1}.`);
      }
    }
    return this.doc.save();
  }

  close(): void {
    for (const font of this.loaded.values()) this.doc.m.FPDFFont_Close(font.handle);
    this.loaded.clear();
    for (const buffer of this.fontBuffers) this.doc.pdf.free(buffer);
    this.fontBuffers.length = 0;
  }

  /** The one run on its page that matches the locator, or the stale-locator error. */
  private locate(target: RunLocator): { page: Page; run: PageRun } {
    const page = this.doc.page(target.pageIndex);
    const matches = page.read().runs.filter((run) => matchesLocator(run, target));
    if (matches.length !== 1) throw new EngineError('failed', PAGE_CHANGED);
    const run = matches[0];
    if (run.records[0].info.notEditable) throw new EngineError('failed', "This text cannot be edited.");
    return { page, run };
  }

  /**
   * E3: the run's own font when every character of the new text is proven present, or when the
   * font is not embedded and its encoding names every character (revised 2026-11-05). Else the
   * closest Windows font. A font this replay loaded is a whole font file, so it draws anything.
   */
  private async fontFor(style: Style, text: string): Promise<number> {
    if (this.ownFonts.has(style.font)) return style.font;
    const drawn = this.coverage.get(style.font);
    if (drawn && [...text].every((ch) => drawn.has(ch))) return style.font;
    if (style.font && this.encodes(style.font, text)) return style.font;
    return this.load(matchWindowsFont(style.fontName, style.fontFlags), true);
  }

  /**
   * E3's trial, for a font that is not embedded. The viewer draws such a font from its own full
   * copy, so it lacks a character only when the font's encoding cannot name it. PDFium sets the
   * text in the font on a trial object, on a scratch page added for the purpose, and reads it
   * back. The same text back means the encoding carried every character. White space is left
   * out of the comparison: the text reader may add or fold spaces, and every encoding has one.
   * The scratch page, and the trial object it owns, are gone before this returns.
   */
  private encodes(font: number, text: string): boolean {
    const { m, pdf } = this.doc;
    if (m.FPDFFont_GetIsEmbedded(font)) return false;
    const index = this.doc.pageCount;
    const page = m.FPDFPage_New(this.doc.handle, index, 200, 200);
    if (!page) return false;
    try {
      const object = m.FPDFPageObj_CreateTextObj(this.doc.handle, font, 12);
      if (!object) return false;
      if (!this.setText(object, text)) {
        m.FPDFPageObj_Destroy(object);
        return false;
      }
      m.FPDFPage_InsertObject(page, object);   // the page owns it from here
      const textPage = m.FPDFText_LoadPage(page);
      if (!textPage) return false;
      try {
        const back = pdf.utf16((buffer, length) => m.FPDFTextObj_GetText(object, textPage, buffer, length));
        return withoutSpace(back) === withoutSpace(text);
      } finally {
        m.FPDFText_ClosePage(textPage);
      }
    } finally {
      m.FPDF_ClosePage(page);
      m.FPDFPage_Delete(this.doc.handle, index);
    }
  }

  /**
   * Loads a Windows font from the font source, once per replay. A null answer falls back to
   * PDFium's standard font, always with a note. `substituting` says a Windows font stands in
   * for the run's own, which the user hears about too.
   */
  private async load(choice: FontChoice, substituting: boolean): Promise<number> {
    let font = this.loaded.get(choice.file);
    if (!font) {
      const data = this.fontSource ? await this.fontSource(choice.file) : null;
      font = data ? this.loadWindowsFont(choice, data) : this.loadStandardFont(choice);
      this.loaded.set(choice.file, font);
      this.ownFonts.add(font.handle);
    }
    if (substituting || !font.windows) this.note({ kind: 'font-substituted', font: font.shownAs });
    return font.handle;
  }

  private loadWindowsFont(choice: FontChoice, data: Uint8Array): LoadedFont {
    let restricted: boolean;
    try {
      restricted = embeddingRestricted(data);
    } catch (err) {
      throw new EngineError('failed', `${choice.label}: ${messageOf(err)}`);
    }
    if (restricted) {
      throw new EngineError('failed', `The font ${choice.label} does not allow embedding, so PDFluffer cannot use it.`);
    }
    const { m, pdf } = this.doc;
    const buffer = pdf.copyIn(data);
    this.fontBuffers.push(buffer);
    // As a CID font, so any character the font has can be drawn, not only Latin ones.
    const handle = m.FPDFText_LoadFont(this.doc.handle, buffer, data.length, FPDF_FONT_TRUETYPE, true);
    if (!handle) throw new EngineError('failed', `The PDF text engine could not load ${choice.label}.`);
    return { handle, shownAs: choice.label, windows: true };
  }

  private loadStandardFont(choice: FontChoice): LoadedFont {
    const handle = this.doc.m.FPDFText_LoadStandardFont(this.doc.handle, choice.standard);
    if (!handle) throw new EngineError('failed', `The PDF text engine could not load ${choice.standard}.`);
    return { handle, shownAs: choice.standard, windows: false };
  }

  private createText(font: number, style: Style, text: string, matrix: number[]): number {
    const { m, pdf } = this.doc;
    const object = m.FPDFPageObj_CreateTextObj(this.doc.handle, font, style.fontSize);
    if (!object) throw new EngineError('failed', "The PDF text engine could not create the new text.");
    if (!this.setText(object, text)) {
      m.FPDFPageObj_Destroy(object);
      throw new EngineError('failed', "The PDF text engine could not set the new text.");
    }
    pdf.setF32(pdf.scratch, matrix);
    m.FPDFPageObj_SetMatrix(object, pdf.scratch);
    const [r, g, b] = style.colour;
    m.FPDFPageObj_SetFillColor(object, r, g, b, style.alpha);
    m.FPDFTextObj_SetTextRenderMode(object, style.renderMode);
    if (style.renderMode === RENDER_STROKE || style.renderMode === RENDER_FILL_STROKE) {
      const [sr, sg, sb, sa] = style.stroke;
      m.FPDFPageObj_SetStrokeColor(object, sr, sg, sb, sa);
      m.FPDFPageObj_SetStrokeWidth(object, style.strokeWidth);
    }
    return object;
  }

  /** `FPDFText_SetText` with the text copied in as UTF-16. False when PDFium refuses it. */
  private setText(object: number, text: string): boolean {
    const { m, pdf } = this.doc;
    const bytes = (text.length + 1) * 2;
    const buffer = pdf.malloc(bytes);
    try {
      m.pdfium.stringToUTF16(text, buffer, bytes);
      return Boolean(m.FPDFText_SetText(object, buffer));
    } finally {
      pdf.free(buffer);
    }
  }

  /**
   * E4. A new run wider than the old one is narrowed along its text direction, down to 85%.
   * If that is not enough it stays at 85% and the user is told it runs past the old end.
   */
  private squeeze(page: Page, object: number, matrix: number[], oldEnd: number): void {
    const quad = page.quadOf(object);
    if (!quad) return;
    const dir = directionOf(matrix);
    const origin = matrix[4] * dir[0] + matrix[5] * dir[1];
    const oldWidth = oldEnd - origin;
    const newWidth = extentAlong(quad, dir)[1] - origin;
    if (oldWidth <= 0 || newWidth <= oldWidth) return;
    const wanted = oldWidth / newWidth;
    if (wanted < MIN_SQUEEZE) this.note({ kind: 'runs-past-end' });
    const scale = Math.max(MIN_SQUEEZE, wanted);
    const [a, b, c, d, e, f] = matrix;
    const { m, pdf } = this.doc;
    pdf.setF32(pdf.scratch, [a * scale, b * scale, c, d, e, f]);
    m.FPDFPageObj_SetMatrix(object, pdf.scratch);
  }

  /** Each note once per edit, tagged with that edit's index, in the order met (spec 21.2). */
  private note(kind: NoteKind): void {
    const note = { ...kind, edit: this.editIndex } as EditNote;
    const key = JSON.stringify(note);
    if (!this.notes.some((n) => JSON.stringify(n) === key)) this.notes.push(note);
  }
}

function withoutSpace(text: string): string {
  return text.replace(/\s+/g, "");
}

function asEngineError(err: unknown): EngineError {
  if (err instanceof EngineError) return err;
  return new EngineError('failed', messageOf(err));
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
