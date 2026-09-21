// The engine contract (spec 13.1). An engine is whatever library actually changes the PDF
// bytes. Nothing here imports React, the app frame, or the bridge: an engine never sees a viewer.

import type { OcrPageResult } from "../ocr/OcrService";

export type Capability =
  | 'pages.insertPdf' | 'pages.rotate' | 'flatten'
  | 'text.edit' | 'redact' | 'ocr' | 'sign.verify' | 'sign.certificate';

/**
 * Spec 20.4. One page's OCR, exactly as the engine read it, with the viewport transform of
 * the picture it read. The adapter places the words itself, because only it holds the font
 * whose widths decide the placement.
 */
export interface OcrPageLayer {
  pageIndex: number;              // 0-based
  result: OcrPageResult;
  transform: number[];            // PDF points to picture pixels, from PDF.js
}

export type EngineOp =
  | { kind: 'pages.insertPdf'; other: Uint8Array }              // append all pages at the end
  | { kind: 'pages.rotate'; pages: number[] | 'all'; degrees: 90 | -90 | 180 }
  | { kind: 'flatten' }
  | { kind: 'ocr.addTextLayer'; pages: OcrPageLayer[] };

/** The capability an operation needs. Each is named after its kind, except OCR's. */
export function capabilityOf(op: EngineOp): Capability {
  return op.kind === 'ocr.addTextLayer' ? 'ocr' : op.kind;
}

export type EngineErrorCode = 'encrypted' | 'unsupported' | 'failed';
export class EngineError extends Error {
  constructor(public code: EngineErrorCode, message: string) { super(message); }
}

export interface EngineResult { bytes: Uint8Array; mode: 'append' | 'rewrite'; }

export interface EngineAdapter {
  readonly name: string;
  capabilities(): ReadonlySet<Capability>;
  run(op: EngineOp, bytes: Uint8Array): Promise<EngineResult>;
}
