// Spec 20.5, "Make text selectable (OCR)...". A plain object like the Document tools: it
// reads pages through the session and the OCR service, and changes the document only through
// one ctx.session.runOp at the very end. Nothing reaches disk until the user saves.
//
// It never logs or keeps what the pages say. The words go from the engine into one operation
// and nowhere else.

import type { OcrPageLayer } from "../engine/EngineAdapter";
import { OcrError, type OcrPageResult } from "../ocr/OcrService";
import {
  BUTTON, NOTHING_TO_READ_DIALOG, OCR_NO_TEXT_DIALOG, OCR_PROGRESS_TITLE, ocrConfirmDialog,
  ocrDoneDialog, ocrFailedDialog, ocrProgressText, type DialogText,
} from "../session/dialogTexts";
import type { Tool, ToolContext } from "./toolRegistry";

/** O5: a page with more real text than this is not a scan, or has been read already. */
export const OCR_TEXT_THRESHOLD = 50;

const ask = (ctx: ToolContext, text: DialogText): Promise<string> =>
  ctx.dialogs.ask(text.title, text.body, text.buttons);

/** The words a result holds, not counting any that are only spaces. */
function wordCount(result: OcrPageResult): number {
  let count = 0;
  for (const line of result.lines) {
    for (const word of line.words) if (word.text.trim()) count++;
  }
  return count;
}

/** "en-GB" as "British English". The tag itself when the browser cannot name it. */
export function languageName(tag: string): string {
  if (!tag) return "an unknown language";
  try {
    return new Intl.DisplayNames(["en-AU"], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** The pages, 1-based, that need reading. Null when the tab went away while counting. */
async function pagesWithoutText(ctx: ToolContext, pages: number): Promise<number[] | null> {
  const needed: number[] = [];
  try {
    for (let page = 1; page <= pages; page++) {
      if (await ctx.session.pageTextLength(ctx.tabId, page) <= OCR_TEXT_THRESHOLD) needed.push(page);
    }
  } catch (err) {
    console.warn("Could not count the text on the pages:", err);
    return null;
  }
  return needed;
}

function failureOf(err: unknown): DialogText {
  if (err instanceof OcrError) return ocrFailedDialog(err.code, err.code === 'failed' ? err.message : "");
  return ocrFailedDialog('failed', err instanceof Error ? err.message : String(err));
}

export const ocrTool: Tool = {
  id: "ocr",
  label: "Make text selectable (OCR)...",
  needs: ['ocr'],
  async run(ctx: ToolContext): Promise<void> {
    const ocr = ctx.ocr;
    const total = ctx.session.pageCount(ctx.tabId);
    if (!ocr || !total) return;

    const needed = await pagesWithoutText(ctx, total);
    if (!needed) return;
    if (needed.length === 0) {
      await ask(ctx, NOTHING_TO_READ_DIALOG);
      return;
    }
    if (await ask(ctx, ocrConfirmDialog(needed.length, total)) !== BUTTON.continue.id) return;

    // Asked now, not at start-up, because the page picture has to fit the engine's own limit.
    let limit: number;
    try {
      const status = await ocr.status();
      if (!status.available) throw new OcrError('unavailable', "No OCR language is installed.");
      limit = status.maxImageDimension;
    } catch (err) {
      await ask(ctx, failureOf(err));
      return;
    }

    const layers: OcrPageLayer[] = [];
    let failure: DialogText | null = null;
    const progress = ctx.dialogs.progress(OCR_PROGRESS_TITLE, ocrProgressText(1, needed.length));
    try {
      for (let i = 0; i < needed.length; i++) {
        if (progress.cancelled) return;
        if (i > 0) progress.update(ocrProgressText(i + 1, needed.length));
        const image = await ctx.session.renderPageImage(ctx.tabId, needed[i], limit);
        const result = await ocr.recognise(image.bytes);
        // Cancel waits for the page under way, then drops everything: nothing has changed.
        if (progress.cancelled) return;
        layers.push({ pageIndex: needed[i] - 1, result, transform: image.transform });
      }
    } catch (err) {
      failure = failureOf(err);
    } finally {
      progress.close();
    }
    if (failure) {
      await ask(ctx, failure);
      return;
    }

    const words = layers.reduce((sum, layer) => sum + wordCount(layer.result), 0);
    if (words === 0) {
      await ask(ctx, OCR_NO_TEXT_DIALOG);
      return;
    }
    // One operation for every page, so a signed file's guard asks at most once.
    if (!await ctx.session.runOp(ctx.tabId, { kind: 'ocr.addTextLayer', pages: layers })) return;
    const pagesWithWords = layers.filter((layer) => wordCount(layer.result) > 0).length;
    await ask(ctx, ocrDoneDialog(words, pagesWithWords, languageName(layers[0].result.language)));
  },
};
