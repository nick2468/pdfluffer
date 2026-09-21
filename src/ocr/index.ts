import type { OcrService } from "./OcrService";
import { TauriOcrService } from "./tauriOcrService";

/**
 * The OCR service inside the desktop app, or null in a browser tab (spec 20.4, O6).
 * Windows' engine is the only one, and only the Tauri host can reach it, so the harness
 * has none and the OCR tool is simply absent there.
 */
export function createOcrService(): OcrService | null {
  if ("__TAURI_INTERNALS__" in window) return new TauriOcrService();
  return null;
}
