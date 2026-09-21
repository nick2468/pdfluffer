import { afterEach, describe, expect, it } from "vitest";
import type { EngineOp } from "../engine/EngineAdapter";
import { FakeFileAdapter } from "../files/fakeFileAdapter";
import { FakeOcrService, fakeResult } from "../ocr/fakeOcrService";
import { OcrError, type OcrPageResult } from "../ocr/OcrService";
import {
  BUTTON, NOTHING_TO_READ_DIALOG, OCR_FAILED_TITLE, OCR_NO_TEXT_DIALOG, OCR_PROGRESS_TITLE,
  ocrConfirmDialog, ocrDoneDialog, ocrFailedDialog, type DialogButton, type DialogText, type Dialogs,
  type Progress,
} from "../session/dialogTexts";
import type { SessionManager } from "../session/SessionManager";
import type { PageImage } from "../viewer/Viewer";
import { languageName, OCR_TEXT_THRESHOLD, ocrTool } from "./ocrTool";
import type { ToolContext } from "./toolRegistry";

// Spec 20.5. The tool is a script over the session, the dialogs and the OCR service, so
// every one of them is a fake here. The page drawing and the placement have their own tests.

interface Asked { title: string; body: string; buttons: string[]; }

class FakeProgress implements Progress {
  cancelled = false;
  closed = false;
  readonly texts: string[];
  constructor(readonly title: string, text: string) { this.texts = [text]; }
  update(text: string): void { this.texts.push(text); }
  close(): void { this.closed = true; }
}

class FakeDialogs implements Dialogs {
  readonly asked: Asked[] = [];
  readonly progresses: FakeProgress[] = [];
  private queue: string[] = [];

  answer(...ids: string[]): void { this.queue.push(...ids); }
  get unanswered(): string[] { return [...this.queue]; }

  async ask(title: string, body: string, buttons: DialogButton[]): Promise<string> {
    this.asked.push({ title, body, buttons: buttons.map((b) => b.id) });
    const id = this.queue.shift();
    if (id === undefined) throw new Error(`Unexpected dialog with nothing queued: "${title}"`);
    return id;
  }

  progress(title: string, text: string): Progress {
    const progress = new FakeProgress(title, text);
    this.progresses.push(progress);
    return progress;
  }
}

const asked = (text: DialogText): Asked => ({ title: text.title, body: text.body, buttons: text.buttons.map((b) => b.id) });

const TAB = "tab-1";
const TRANSFORM: PageImage["transform"] = [4, 0, 0, -4, 0, 3200];

/** The tool calls five methods on the manager. This stands in for it through one cast. */
function fakeSession(textLengths: number[]) {
  const session = {
    textLengths,
    rendered: [] as { page: number; maxDimension: number }[],
    ops: [] as EngineOp[],
    runOpResult: true,
    /** Called as each page is drawn, so a test can press Cancel part way through. */
    onRender: (_page: number): void => {},
    pageCount: (tabId: string) => (tabId === TAB ? session.textLengths.length : null),
    async pageTextLength(tabId: string, page: number): Promise<number> {
      if (tabId !== TAB) throw new Error("not ready");
      return session.textLengths[page - 1];
    },
    async renderPageImage(tabId: string, page: number, maxDimension: number): Promise<PageImage> {
      if (tabId !== TAB) throw new Error("not ready");
      session.rendered.push({ page, maxDimension });
      session.onRender(page);
      return { bytes: new Uint8Array([page]), width: 2400, height: 3200, transform: TRANSFORM };
    },
    async runOp(tabId: string, op: EngineOp): Promise<boolean> {
      session.ops.push(op);
      return tabId === TAB && session.runOpResult;
    },
  };
  return session;
}

const words = (...texts: string[]) => texts.map((text, i) => ({ text, x: 10 + 50 * i, y: 10, w: 40, h: 12 }));

let current: FakeDialogs | null = null;

function setup(textLengths: number[], results: OcrPageResult[] = [fakeResult(words("Hello", "there"))]) {
  const session = fakeSession(textLengths);
  const dialogs = new FakeDialogs();
  current = dialogs;
  const ocr = new FakeOcrService();
  ocr.results = results;
  ocr.maxImageDimension = 3500;
  const ctx: ToolContext = {
    tabId: TAB,
    session: session as unknown as SessionManager,
    files: new FakeFileAdapter(),
    dialogs,
    ocr,
  };
  return { session, dialogs, ocr, ctx };
}

afterEach(() => {
  // Every dialog a test reached had an answer queued, and every queued answer was used.
  expect(current?.unanswered ?? []).toEqual([]);
  // A progress dialog, once shown, is always closed again.
  expect(current?.progresses.filter((p) => !p.closed) ?? []).toEqual([]);
  current = null;
});

describe("the OCR tool (spec 20.5)", () => {
  it("is the Document list's OCR item, needing an engine with OCR", () => {
    expect(ocrTool.id).toBe("ocr");
    expect(ocrTool.label).toBe("Make text selectable (OCR)...");
    expect(ocrTool.needs).toEqual(["ocr"]);
  });

  it("reads only the pages with 50 or fewer characters of text (O5)", async () => {
    expect(OCR_TEXT_THRESHOLD).toBe(50);
    const { session, dialogs, ctx } = setup([0, 200, 50, 51]);
    dialogs.answer(BUTTON.continue.id, BUTTON.ok.id);
    await ocrTool.run(ctx);
    expect(dialogs.asked[0]).toEqual(asked(ocrConfirmDialog(2, 4)));
    expect(session.rendered.map((r) => r.page)).toEqual([1, 3]);
  });

  it("says so, and stops, when every page already has text", async () => {
    const { session, dialogs, ctx } = setup([51, 300]);
    dialogs.answer(BUTTON.ok.id);
    await ocrTool.run(ctx);
    expect(dialogs.asked).toEqual([asked(NOTHING_TO_READ_DIALOG)]);
    expect(session.rendered).toEqual([]);
    expect(session.ops).toEqual([]);
  });

  it("asks first, with the right counts and grammar", async () => {
    expect(ocrConfirmDialog(1, 1).body).toMatch(/^1 of 1 page has no selectable text\. PDFluffer will read it and /);
    expect(ocrConfirmDialog(2, 3).body).toMatch(/^2 of 3 pages have no selectable text\. PDFluffer will read them and /);
    expect(ocrConfirmDialog(1, 3).body).toMatch(/^1 of 3 pages has /);
    expect(ocrConfirmDialog(2, 3).body).toMatch(
      /add an invisible text layer\. The pages will look exactly the same\. This can take a few seconds a page\.$/,
    );
    expect(ocrConfirmDialog(2, 3).title).toBe("Make text selectable?");
    expect(ocrConfirmDialog(2, 3).buttons.map((b) => b.label)).toEqual(["Make selectable", "Cancel"]);
  });

  it("changes nothing when the user cancels the question", async () => {
    const { session, dialogs, ctx } = setup([0, 0]);
    dialogs.answer(BUTTON.cancel.id);
    await ocrTool.run(ctx);
    expect(session.rendered).toEqual([]);
    expect(dialogs.progresses).toEqual([]);
    expect(session.ops).toEqual([]);
  });

  it("shows which page it is reading, with the engine's own size limit", async () => {
    const { session, dialogs, ctx } = setup([0, 0, 0]);
    dialogs.answer(BUTTON.continue.id, BUTTON.ok.id);
    await ocrTool.run(ctx);
    expect(dialogs.progresses).toHaveLength(1);
    expect(dialogs.progresses[0].title).toBe(OCR_PROGRESS_TITLE);
    expect(dialogs.progresses[0].texts).toEqual([
      "Reading page 1 of 3...", "Reading page 2 of 3...", "Reading page 3 of 3...",
    ]);
    expect(session.rendered.map((r) => r.maxDimension)).toEqual([3500, 3500, 3500]);
  });

  it("stops after the current page when the user presses Cancel, and changes nothing", async () => {
    const { session, dialogs, ocr, ctx } = setup([0, 0, 0]);
    session.onRender = (page) => { if (page === 2) dialogs.progresses[0].cancelled = true; };
    dialogs.answer(BUTTON.continue.id);
    await ocrTool.run(ctx);
    expect(session.rendered.map((r) => r.page)).toEqual([1, 2]);
    expect(ocr.seen).toHaveLength(2);        // page 2 was already under way, and finished
    expect(session.ops).toEqual([]);
    expect(dialogs.asked).toHaveLength(1);   // the question only: no message afterwards
  });

  it("changes nothing when Cancel comes while the last page is being read", async () => {
    // No next page comes round to notice it, so the tool has to look once more after reading.
    const { session, dialogs, ocr, ctx } = setup([0, 0]);
    session.onRender = (page) => { if (page === 2) dialogs.progresses[0].cancelled = true; };
    dialogs.answer(BUTTON.continue.id);
    await ocrTool.run(ctx);
    expect(ocr.seen).toHaveLength(2);
    expect(session.ops).toEqual([]);
    expect(dialogs.asked).toHaveLength(1);
  });

  it("says no text was found, and runs nothing, when the pages hold no printed words", async () => {
    const { session, dialogs, ctx } = setup([0, 0], [fakeResult([]), fakeResult(words("  "))]);
    dialogs.answer(BUTTON.continue.id, BUTTON.ok.id);
    await ocrTool.run(ctx);
    expect(dialogs.asked[1]).toEqual(asked(OCR_NO_TEXT_DIALOG));
    expect(session.ops).toEqual([]);
  });

  it("stops at a page the engine cannot read, says why, and changes nothing", async () => {
    const { session, dialogs, ocr, ctx } = setup([0, 0, 0]);
    session.onRender = (page) => { if (page === 2) ocr.failWith = new OcrError("too-large", "Too big"); };
    dialogs.answer(BUTTON.continue.id, BUTTON.ok.id);
    await ocrTool.run(ctx);
    expect(session.rendered.map((r) => r.page)).toEqual([1, 2]);
    expect(dialogs.asked[1]).toEqual(asked(ocrFailedDialog("too-large", "Too big")));
    expect(dialogs.asked[1].title).toBe(OCR_FAILED_TITLE);
    expect(session.ops).toEqual([]);
  });

  it("says why for each kind of failure, in plain words", () => {
    expect(ocrFailedDialog("unavailable", "").body).toMatch(/no OCR language/);
    expect(ocrFailedDialog("too-large", "").body).toMatch(/too large/);
    expect(ocrFailedDialog("failed", "The component cannot be found.").body)
      .toBe("Windows could not read the page. The component cannot be found. Nothing was changed.");
    for (const code of ["unavailable", "too-large", "failed"] as const) {
      expect(ocrFailedDialog(code, "x").body).toMatch(/Nothing was changed\.$/);
    }
  });

  it("treats a page that cannot be drawn like one that cannot be read", async () => {
    const { session, dialogs, ctx } = setup([0]);
    session.renderPageImage = async () => { throw new Error("This page could not be drawn."); };
    dialogs.answer(BUTTON.continue.id, BUTTON.ok.id);
    await ocrTool.run(ctx);
    expect(dialogs.asked[1]).toEqual(asked(ocrFailedDialog("failed", "This page could not be drawn.")));
    expect(session.ops).toEqual([]);
  });

  it("says so when the engine has gone since start-up", async () => {
    const { session, dialogs, ocr, ctx } = setup([0]);
    ocr.available = false;
    dialogs.answer(BUTTON.continue.id, BUTTON.ok.id);
    await ocrTool.run(ctx);
    expect(dialogs.asked[1]).toEqual(asked(ocrFailedDialog("unavailable", "")));
    expect(session.rendered).toEqual([]);
    expect(session.ops).toEqual([]);
  });

  it("adds every page's words in one operation, then says how many and in what language", async () => {
    const first = fakeResult(words("Hello", "there"), { language: "en-GB", textAngle: 0.5 });
    const second = fakeResult([], { language: "en-GB" });
    const third = fakeResult(words("one", "two", "three"), { language: "en-GB" });
    const { session, dialogs, ctx } = setup([0, 80, 0, 0], [first, second, third]);
    dialogs.answer(BUTTON.continue.id, BUTTON.ok.id);
    await ocrTool.run(ctx);

    // One runOp, so a signed file's guard asks at most once, holding every page it read.
    expect(session.ops).toEqual([{
      kind: "ocr.addTextLayer",
      pages: [
        { pageIndex: 0, result: first, transform: TRANSFORM },
        { pageIndex: 2, result: second, transform: TRANSFORM },
        { pageIndex: 3, result: third, transform: TRANSFORM },
      ],
    }]);
    // Five words on two pages: the empty page gained nothing, so it is not counted.
    const language = languageName("en-GB");
    expect(dialogs.asked[1]).toEqual(asked(ocrDoneDialog(5, 2, language)));
    expect(dialogs.asked[1].body).toBe(
      `Added 5 words to 2 pages, read as ${language}. Select some text to check it, then save.`,
    );
  });

  it("says nothing more when the operation did not happen", async () => {
    // For example the user chose Cancel at the digital signature guard, inside runOp.
    const { session, dialogs, ctx } = setup([0]);
    session.runOpResult = false;
    dialogs.answer(BUTTON.continue.id);
    await ocrTool.run(ctx);
    expect(session.ops).toHaveLength(1);
    expect(dialogs.asked).toHaveLength(1);
  });

  it("does nothing without an OCR service, or for a tab that is not ready", async () => {
    const { session, dialogs, ctx } = setup([0]);
    await ocrTool.run({ ...ctx, ocr: null });
    await ocrTool.run({ ...ctx, tabId: "not-ready" });
    expect(dialogs.asked).toEqual([]);
    expect(session.ops).toEqual([]);
  });

  it("names a language the way a person would, and falls back to its tag", () => {
    // The exact words are the browser's (ICU's), and differ between versions: "British
    // English" here for en-GB, "United States English" for en-US. So only their gist is pinned.
    for (const tag of ["en-GB", "en-US"]) {
      expect(languageName(tag)).toMatch(/English/);
      expect(languageName(tag)).not.toBe(tag);
    }
    expect(languageName("")).toBe("an unknown language");
    expect(languageName("not a tag at all")).toBe("not a tag at all");
  });
});
