// A stand-in OCR service for tests (spec 20.4). It answers from a queue, remembers every
// picture it was handed, and can be told to be unavailable or to fail.

import { OcrError, type OcrPageResult, type OcrService, type OcrStatus } from "./OcrService";

/** A result with one line of words, enough for a test that only cares about placement. */
export function fakeResult(words: OcrPageResult['lines'][number]['words'], over: Partial<OcrPageResult> = {}): OcrPageResult {
  return {
    language: "en-GB",
    width: 1000,
    height: 1400,
    textAngle: null,
    lines: [{ words }],
    ...over,
  };
}

export class FakeOcrService implements OcrService {
  /** Every picture recognise() was given, in order. */
  readonly seen: Uint8Array[] = [];
  /** Answered one per call, in order. The last one is repeated once the queue runs out. */
  results: OcrPageResult[] = [];
  available = true;
  language: string | null = "en-GB";
  maxImageDimension = 4000;
  /** When set, the next recognise() throws this instead of answering. */
  failWith: OcrError | null = null;
  statusCalls = 0;

  async status(): Promise<OcrStatus> {
    this.statusCalls++;
    return {
      available: this.available,
      language: this.available ? this.language : null,
      maxImageDimension: this.maxImageDimension,
    };
  }

  async recognise(image: Uint8Array): Promise<OcrPageResult> {
    this.seen.push(image);
    if (!this.available) throw new OcrError('unavailable', "No OCR language is installed.");
    if (this.failWith) throw this.failWith;
    const next = this.results.length > 1 ? this.results.shift() : this.results[0];
    if (!next) throw new OcrError('failed', "The fake has no result queued.");
    return next;
  }
}
