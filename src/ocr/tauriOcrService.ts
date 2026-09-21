// The product's OCR service (spec 20.3, 20.4). The second and last file in src/ that
// imports @tauri-apps. It calls the two Rust commands and maps their error strings.

import { invoke } from "@tauri-apps/api/core";
import { OcrError, type OcrPageResult, type OcrService, type OcrStatus } from "./OcrService";

/** Maps a rejected invoke, which carries the Rust error string, to an OcrError. */
export function toOcrError(reason: unknown): OcrError {
  if (reason instanceof OcrError) return reason;
  const text = typeof reason === "string" ? reason : reason instanceof Error ? reason.message : String(reason);
  switch (text) {
    case "ocr-unavailable":
      return new OcrError('unavailable', "This computer has no OCR language installed.");
    case "ocr-too-large":
      return new OcrError('too-large', "That page picture is too large for the OCR engine.");
    default:
      return new OcrError('failed', text.startsWith("ocr: ") ? text.slice(5) : text);
  }
}

export class TauriOcrService implements OcrService {
  async status(): Promise<OcrStatus> {
    try {
      return await invoke<OcrStatus>("ocr_status");
    } catch (err) {
      throw toOcrError(err);
    }
  }

  async recognise(image: Uint8Array): Promise<OcrPageResult> {
    try {
      // The picture goes as the raw request body, like write_pdf's bytes.
      return await invoke<OcrPageResult>("ocr_image", image);
    } catch (err) {
      throw toOcrError(err);
    }
  }
}
