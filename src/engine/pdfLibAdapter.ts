// The pdf-lib engine (spec 13.4). This is the only file under src/ that imports
// @cantoo/pdf-lib. Every result is a whole new file, so its mode is always 'rewrite'.

import { degrees, EncryptedPDFError, PDFDocument, toDegrees, type PDFPage } from "@cantoo/pdf-lib";
import {
  EngineError, type Capability, type EngineAdapter, type EngineOp, type EngineResult,
} from "./EngineAdapter";

const CAPABILITIES: ReadonlySet<Capability> =
  new Set<Capability>(['pages.insertPdf', 'pages.rotate', 'flatten']);

export class PdfLibAdapter implements EngineAdapter {
  readonly name = "pdf-lib";

  capabilities(): ReadonlySet<Capability> {
    return CAPABILITIES;
  }

  async run(op: EngineOp, bytes: Uint8Array): Promise<EngineResult> {
    const doc = await load(bytes);
    try {
      await apply(doc, op);
      // updateFieldAppearances stays off: a form filled in the viewer already carries the
      // appearances PDF.js wrote, and regenerating them would redraw the user's values.
      return { bytes: await doc.save({ updateFieldAppearances: false }), mode: 'rewrite' };
    } catch (err) {
      throw asEngineError(err);
    }
  }
}

async function apply(doc: PDFDocument, op: EngineOp): Promise<void> {
  switch (op.kind) {
    case 'pages.insertPdf':
      return insertPdf(doc, op.other);
    case 'pages.rotate':
      return rotate(doc, op.pages, op.degrees);
    case 'flatten':
      return flattenForm(doc);
    default:
      // Unreachable while EngineOp names three kinds. It catches a fourth added later.
      throw new EngineError('unsupported', `pdf-lib cannot run ${(op as EngineOp).kind}.`);
  }
}

/**
 * Step 1 of spec 13.4: draw every form field onto its page and remove the field. A file
 * with no form is not an error, and neither is one field pdf-lib cannot draw: the rest of
 * the flatten still runs.
 */
function flattenForm(doc: PDFDocument): void {
  try {
    doc.getForm().flatten();
  } catch (err) {
    console.warn("Could not flatten the form fields:", err);
  }
}

/** Copies every page of the other document to the end of this one. */
async function insertPdf(doc: PDFDocument, other: Uint8Array): Promise<void> {
  const source = await load(other);
  const copied = await doc.copyPages(source, source.getPageIndices());
  for (const page of copied) doc.addPage(page);
}

/** Turns each chosen page by delta. `pages` holds 1-based page numbers, or 'all'. */
function rotate(doc: PDFDocument, pages: number[] | 'all', delta: number): void {
  const all = doc.getPages();
  let chosen: PDFPage[];
  if (pages === 'all') {
    chosen = all;
  } else {
    chosen = pages.map((number) => {
      const page = Number.isInteger(number) ? all[number - 1] : undefined;
      if (!page) throw new EngineError('failed', `This document has no page ${number}.`);
      return page;
    });
  }
  for (const page of chosen) {
    const current = toDegrees(page.getRotation());
    page.setRotation(degrees(((current + delta) % 360 + 360) % 360));
  }
}

/** The one place an encrypted file is recognised. Everything else is a plain failure. */
async function load(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    // A copy. pdf-lib keeps the input bytes for an incremental save, and they are the
    // caller's array, which the session still owns.
    return await PDFDocument.load(bytes.slice());
  } catch (err) {
    throw asEngineError(err);
  }
}

function asEngineError(err: unknown): EngineError {
  if (err instanceof EngineError) return err;
  if (err instanceof EncryptedPDFError) {
    return new EngineError('encrypted', "This PDF is password-protected.");
  }
  return new EngineError('failed', err instanceof Error ? err.message : String(err));
}
