// The engine contract (spec 13.1). An engine is whatever library actually changes the PDF
// bytes. Nothing here imports React, the app frame, or the bridge: an engine never sees a viewer.

export type Capability =
  | 'pages.insertPdf' | 'pages.rotate' | 'flatten'
  | 'text.edit' | 'redact' | 'ocr' | 'sign.verify' | 'sign.certificate';

export type EngineOp =
  | { kind: 'pages.insertPdf'; other: Uint8Array }              // append all pages at the end
  | { kind: 'pages.rotate'; pages: number[] | 'all'; degrees: 90 | -90 | 180 }
  | { kind: 'flatten' };

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
