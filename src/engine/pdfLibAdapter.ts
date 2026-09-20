// The pdf-lib engine (spec 13.4). This is the only file under src/ that imports
// @cantoo/pdf-lib. Every result is a whole new file, so its mode is always 'rewrite'.

import {
  concatTransformationMatrix, degrees, drawObject, EncryptedPDFError, PDFArray, PDFDict,
  PDFDocument, PDFName, PDFNumber, PDFRef, PDFStream, popGraphicsState, pushGraphicsState,
  toDegrees, type PDFObject, type PDFPage,
} from "@cantoo/pdf-lib";
import {
  EngineError, type Capability, type EngineAdapter, type EngineOp, type EngineResult,
} from "./EngineAdapter";
import { placementFor } from "./placement";

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
      return flatten(doc);
    default:
      // Unreachable while EngineOp names three kinds. It catches a fourth added later.
      throw new EngineError('unsupported', `pdf-lib cannot run ${(op as EngineOp).kind}.`);
  }
}

/** Spec 13.4: bake the form values in, then the notes and stamps. */
function flatten(doc: PDFDocument): void {
  flattenForm(doc);
  flattenAnnotations(doc);
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

/** The annotation types spec 13.4 bakes in. A link or anything else stays as it is. */
const FLATTENABLE = new Set(['Stamp', 'FreeText', 'Ink', 'Highlight']);
const IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];

/**
 * Step 2 of spec 13.4: draw each note or stamp onto its page as an XObject, then take it
 * out of /Annots. One that cannot be drawn is left alone, which is the safe direction:
 * the file keeps an annotation rather than losing one.
 */
function flattenAnnotations(doc: PDFDocument): void {
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    const drawn: number[] = [];
    for (let index = 0; index < annots.size(); index++) {
      if (drawAnnotation(doc, page, annots.get(index))) drawn.push(index);
    }
    // Backwards, so removing one does not shift the index of the next.
    for (let i = drawn.length - 1; i >= 0; i--) annots.remove(drawn[i]);
  }
}

/** True when the annotation is now painted on the page and should leave /Annots. */
function drawAnnotation(doc: PDFDocument, page: PDFPage, entry: PDFObject): boolean {
  const annot = doc.context.lookup(entry);
  if (!(annot instanceof PDFDict)) return false;
  const subtype = doc.context.lookup(annot.get(PDFName.of('Subtype')));
  if (!(subtype instanceof PDFName) || !FLATTENABLE.has(subtype.decodeText())) return false;

  // The normal appearance has to be a reference: the page's resources point at it.
  const appearances = doc.context.lookup(annot.get(PDFName.of('AP')));
  if (!(appearances instanceof PDFDict)) return false;
  const normal = appearances.get(PDFName.of('N'));
  if (!(normal instanceof PDFRef)) return false;
  const stream = doc.context.lookup(normal);
  if (!(stream instanceof PDFStream)) return false;

  const bbox = numbersIn(doc, stream.dict.get(PDFName.of('BBox')));
  const matrix = numbersIn(doc, stream.dict.get(PDFName.of('Matrix'))) ?? IDENTITY_MATRIX;
  const rect = numbersIn(doc, annot.get(PDFName.of('Rect')));
  if (!bbox || !rect) return false;
  const place = placementFor(bbox, matrix, rect);
  if (!place) return false;

  // The stream's own /Matrix is not applied here. A renderer applies a form XObject's.
  const name = page.node.newXObject('FlatAnnot', normal);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(place.sx, 0, 0, place.sy, place.tx, place.ty),
    drawObject(name),
    popGraphicsState(),
  );
  return true;
}

/** The numbers of a PDF array, or null if it is not an array of numbers. */
function numbersIn(doc: PDFDocument, entry: PDFObject | undefined): number[] | null {
  const array = doc.context.lookup(entry);
  if (!(array instanceof PDFArray)) return null;
  const values: number[] = [];
  for (const item of array.asArray()) {
    const value = doc.context.lookup(item);
    if (!(value instanceof PDFNumber)) return null;
    values.push(value.asNumber());
  }
  return values;
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
