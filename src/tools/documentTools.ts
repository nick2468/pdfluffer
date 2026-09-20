// The Document submenu's tools (spec 13.5). Each one is a small script over the session
// manager, which owns every decision. Nothing here imports React or the app frame.

import type { Capability } from "../engine/EngineAdapter";
import { BUTTON, FLATTEN_DIALOG, openFailedDialog, type DialogText } from "../session/dialogTexts";
import { messageOf } from "../session/saveFlow";
import type { Tool, ToolContext } from "./toolRegistry";

const ask = (ctx: ToolContext, text: DialogText): Promise<string> =>
  ctx.dialogs.ask(text.title, text.body, text.buttons);

const INSERT: Capability[] = ['pages.insertPdf'];
const ROTATE: Capability[] = ['pages.rotate'];
const FLATTEN: Capability[] = ['flatten'];

export const insertPdf: Tool = {
  id: "insertPdf",
  label: "Insert PDF at end...",
  needs: INSERT,
  /** One operation per chosen file, in the order chosen. The first failure stops the rest. */
  async run(ctx: ToolContext): Promise<void> {
    let refs;
    try {
      refs = await ctx.files.pickFiles();
    } catch (err) {
      console.warn("Could not show the Open dialog:", err);
      return;
    }
    for (const ref of refs) {
      let bytes;
      try {
        bytes = (await ctx.files.readFile(ref)).bytes;
      } catch (err) {
        await ask(ctx, openFailedDialog(messageOf(err)));
        return;
      }
      if (!await ctx.session.runOp(ctx.tabId, { kind: 'pages.insertPdf', other: bytes })) return;
    }
  },
};

export const rotateAllRight: Tool = {
  id: "rotateAllRight",
  label: "Rotate all pages right",
  needs: ROTATE,
  async run(ctx: ToolContext): Promise<void> {
    await ctx.session.runOp(ctx.tabId, { kind: 'pages.rotate', pages: 'all', degrees: 90 });
  },
};

export const rotateAllLeft: Tool = {
  id: "rotateAllLeft",
  label: "Rotate all pages left",
  needs: ROTATE,
  async run(ctx: ToolContext): Promise<void> {
    await ctx.session.runOp(ctx.tabId, { kind: 'pages.rotate', pages: 'all', degrees: -90 });
  },
};

export const rotatePageRight: Tool = {
  id: "rotatePageRight",
  label: "Rotate this page right",
  needs: ROTATE,
  async run(ctx: ToolContext): Promise<void> {
    const page = ctx.session.currentPage(ctx.tabId);
    if (page === null) return;
    await ctx.session.runOp(ctx.tabId, { kind: 'pages.rotate', pages: [page], degrees: 90 });
  },
};

export const flatten: Tool = {
  id: "flatten",
  label: "Flatten...",
  needs: FLATTEN,
  /** Flatten cannot be undone once the file is saved, so it asks first. */
  async run(ctx: ToolContext): Promise<void> {
    if (await ask(ctx, FLATTEN_DIALOG) !== BUTTON.continue.id) return;
    await ctx.session.runOp(ctx.tabId, { kind: 'flatten' });
  },
};

/** In the order the Document submenu shows them. */
export const documentTools: Tool[] = [
  insertPdf, rotateAllRight, rotateAllLeft, rotatePageRight, flatten,
];
