// The OCR contract (spec 20.4). OCR, optical character recognition, reads the words in a
// picture of a page so a scan's text can be selected, copied and searched.
//
// Nothing here knows about Windows, Tauri or PDF.js. The browser harness has no engine, so
// createOcrService returns null there and the tool is simply absent (O6).

/** One word, as the engine measured it, in the picture's own pixels. */
export interface OcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrLine {
  words: OcrWord[];
}

export interface OcrPageResult {
  /** The recogniser's BCP-47 tag, for example "en-GB". */
  language: string;
  /** The decoded picture, in pixels. */
  width: number;
  height: number;
  /**
   * The clockwise rotation of the text the engine found, in degrees, or null.
   *
   * The boxes above are measured on the **straightened** picture. To put a word back over
   * the real page, turn its position clockwise by this angle about the picture's centre.
   * Settled by measurement in chip 11, BUILD-NOTES decision 16.
   */
  textAngle: number | null;
  lines: OcrLine[];
}

export interface OcrStatus {
  available: boolean;
  language: string | null;
  /** The largest width or height the engine accepts. Read it, never assume it. */
  maxImageDimension: number;
}

export type OcrErrorCode = 'unavailable' | 'too-large' | 'failed';

export class OcrError extends Error {
  constructor(public code: OcrErrorCode, message: string) { super(message); }
}

export interface OcrService {
  status(): Promise<OcrStatus>;
  /** Reads one page picture, PNG or JPEG. Throws OcrError. */
  recognise(image: Uint8Array): Promise<OcrPageResult>;
}
