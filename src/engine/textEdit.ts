// The text-editing contract (spec 21.2). Plain types only, so the editor dialog (chip 15) can
// import them without pulling in PDFium. `pdfiumAdapter.ts` implements `TextEditEngine`.

/** One run of text on a page: what the editor shows a box for (spec 21). */
export interface TextRun {
  id: string;                    // stable for one listing only
  pageIndex: number;             // 0-based
  text: string;
  bbox: [number, number, number, number];   // PDF points, page space: left, bottom, right, top
  fontName: string;              // the PDF base font name, subset prefix and all
  fontSize: number;              // in points on the page, after the text matrix
  colour: [number, number, number];          // fill colour, 0 to 255 each
  editable: boolean;
  reason?: NotEditableReason;    // why not, from E9
}

/**
 * Why a run cannot be edited (spec 21.1 E9). Form fields, annotations and text inside form
 * XObjects are not page-level text objects, so they never appear in a listing at all.
 * `clipping` is the builder's addition under E9's rule (BUILD-NOTES decision 25).
 */
export type NotEditableReason = 'invisible' | 'clipping' | 'type3-font' | 'vertical';

/** How an edit names its run. Replay finds the one run with this text whose box is within 1 point. */
export interface RunLocator {
  pageIndex: number;
  text: string;
  bbox: [number, number, number, number];
}

/**
 * One edit. For an insert, `x` and `y` are where the new text's baseline starts, in PDF points,
 * page space. `styleFrom` names the run whose font, size and colour it copies, or null for
 * Arial at 11 point, black (E10).
 */
export type TextEdit =
  | { kind: 'replace'; target: RunLocator; text: string }
  | { kind: 'delete'; target: RunLocator }
  | { kind: 'insert'; pageIndex: number; x: number; y: number; text: string; styleFrom: RunLocator | null };

/**
 * What the editor tells the user after an edit (E3, E4). `edit` is the 0-based index, in the
 * list given to `applyEdits`, of the edit that caused it. Each note appears once per edit
 * (spec 21.2, ruled 2026-11-05), so the editor can show the newest edit's notes only.
 */
export type EditNote =
  | { kind: 'font-substituted'; font: string; edit: number }
  | { kind: 'runs-past-end'; edit: number };

/** A page drawn for the editor. `transform` maps PDF points to picture pixels, as PDF.js's does. */
export interface RenderedPage {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  transform: number[];
}

export interface TextEditEngine {
  listRuns(bytes: Uint8Array, pageIndex: number): Promise<TextRun[]>;
  renderPage(bytes: Uint8Array, pageIndex: number, maxDimension: number): Promise<RenderedPage>;
  applyEdits(bytes: Uint8Array, edits: TextEdit[]): Promise<{ bytes: Uint8Array; notes: EditNote[] }>;
}

/** True when an engine adapter also edits text, so the editor can reach it through this interface. */
export function isTextEditEngine(value: unknown): value is TextEditEngine {
  const engine = value as Partial<TextEditEngine> | null;
  return typeof engine?.listRuns === 'function'
    && typeof engine.renderPage === 'function'
    && typeof engine.applyEdits === 'function';
}

/**
 * Where the engine gets a Windows font file by name (spec 21.4), or null when it cannot. Wired
 * to `FileAdapter.readSystemFont` in `main.tsx`, so the engine never imports a file adapter.
 */
export type FontSource = (fileName: string) => Promise<Uint8Array | null>;

/** The stale-locator message (spec 21.2). */
export const PAGE_CHANGED = 'The page changed under this edit.';
