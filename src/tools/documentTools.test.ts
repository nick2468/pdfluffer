import { afterEach, describe, expect, it } from "vitest";
import type { EngineOp } from "../engine/EngineAdapter";
import { FakeFileAdapter } from "../files/fakeFileAdapter";
import { FileError, type FileRef } from "../files/FileAdapter";
import {
  BUTTON, FLATTEN_DIALOG, OPEN_FAILED_TITLE, type DialogButton, type Dialogs,
} from "../session/dialogTexts";
import type { SessionManager } from "../session/SessionManager";
import {
  documentTools, flatten, insertPdf, rotateAllLeft, rotateAllRight, rotatePageRight,
} from "./documentTools";
import type { Tool, ToolContext } from "./toolRegistry";

const TAB = "tab-1";
const A = "C:\\docs\\a.pdf";
const B = "C:\\docs\\b.pdf";
const BYTES_A = new TextEncoder().encode("%PDF-1.7 a");
const BYTES_B = new TextEncoder().encode("%PDF-1.7 b");

interface Asked { title: string; body: string; buttons: string[]; }

class FakeDialogs implements Dialogs {
  readonly asked: Asked[] = [];
  private queue: string[] = [];

  answer(...ids: string[]): void {
    this.queue.push(...ids);
  }

  get unanswered(): string[] {
    return [...this.queue];
  }

  async ask(title: string, body: string, buttons: DialogButton[]): Promise<string> {
    this.asked.push({ title, body, buttons: buttons.map((b) => b.id) });
    const id = this.queue.shift();
    if (id === undefined) throw new Error(`Unexpected dialog with nothing queued: "${title}"`);
    return id;
  }
}

/**
 * The tools only ever call two methods on the manager. Spec 13.2 types the context's
 * `session` as the whole `SessionManager`, so this stands in for it through one cast,
 * here. The manager's own behaviour has its own tests.
 */
function fakeSession() {
  const api = {
    ops: [] as EngineOp[],
    result: true,
    page: 1 as number | null,
    runOp(_tabId: string, op: EngineOp): Promise<boolean> {
      api.ops.push(op);
      return Promise.resolve(api.result);
    },
    currentPage(): number | null {
      return api.page;
    },
  };
  return api;
}

let current: FakeDialogs | null = null;

function setup(files: [FileRef, Uint8Array][] = [[A, BYTES_A], [B, BYTES_B]]) {
  const adapter = new FakeFileAdapter();
  for (const [ref, bytes] of files) adapter.addFile(ref, ref.split("\\").pop() as string, bytes);
  const session = fakeSession();
  const dialogs = new FakeDialogs();
  current = dialogs;
  const ctx: ToolContext = {
    tabId: TAB,
    session: session as unknown as SessionManager,
    files: adapter,
    dialogs,
  };
  return { files: adapter, session, dialogs, ctx };
}

afterEach(() => {
  expect(current?.unanswered ?? []).toEqual([]);
  current = null;
});

describe("the Document tools match spec 13.5", () => {
  it("lists five tools in menu order", () => {
    expect(documentTools.map((t) => [t.id, t.label])).toEqual([
      ["insertPdf", "Insert PDF at end..."],
      ["rotateAllRight", "Rotate all pages right"],
      ["rotateAllLeft", "Rotate all pages left"],
      ["rotatePageRight", "Rotate this page right"],
      ["flatten", "Flatten..."],
    ]);
  });

  it("asks for the capability each one needs", () => {
    const needs = (tool: Tool) => tool.needs;
    expect(needs(insertPdf)).toEqual(['pages.insertPdf']);
    expect(needs(rotateAllRight)).toEqual(['pages.rotate']);
    expect(needs(rotateAllLeft)).toEqual(['pages.rotate']);
    expect(needs(rotatePageRight)).toEqual(['pages.rotate']);
    expect(needs(flatten)).toEqual(['flatten']);
  });
});

describe("Insert PDF at end", () => {
  it("runs one operation per chosen file, in order", async () => {
    const { files, session, ctx } = setup();
    files.queuePickFiles([B, A]);
    await insertPdf.run(ctx);
    expect(session.ops).toEqual([
      { kind: 'pages.insertPdf', other: BYTES_B },
      { kind: 'pages.insertPdf', other: BYTES_A },
    ]);
  });

  it("does nothing when the user picks nothing", async () => {
    const { session, dialogs, ctx } = setup();
    await insertPdf.run(ctx);
    expect(session.ops).toEqual([]);
    expect(dialogs.asked).toEqual([]);
  });

  it("stops at the first operation that fails", async () => {
    const { files, session, ctx } = setup();
    files.queuePickFiles([A, B]);
    session.result = false;
    await insertPdf.run(ctx);
    expect(session.ops).toHaveLength(1);
  });

  it("shows Could not open for a file it cannot read, and stops", async () => {
    const { files, session, dialogs, ctx } = setup();
    files.queuePickFiles([A, B]);
    files.failNext("read", A, new FileError("io", "Disk is asleep"));
    dialogs.answer("ok");
    await insertPdf.run(ctx);
    expect(dialogs.asked).toEqual([{ title: OPEN_FAILED_TITLE, body: "Disk is asleep", buttons: ["ok"] }]);
    expect(session.ops).toEqual([]);
  });

  it("does nothing when the Open dialog itself fails", async () => {
    const { session, dialogs, ctx } = setup();
    ctx.files.pickFiles = () => Promise.reject(new Error("no picker"));
    await insertPdf.run(ctx);
    expect(session.ops).toEqual([]);
    expect(dialogs.asked).toEqual([]);
  });
});

describe("the rotate tools", () => {
  it("turn every page right or left", async () => {
    const { session, ctx } = setup();
    await rotateAllRight.run(ctx);
    await rotateAllLeft.run(ctx);
    expect(session.ops).toEqual([
      { kind: 'pages.rotate', pages: 'all', degrees: 90 },
      { kind: 'pages.rotate', pages: 'all', degrees: -90 },
    ]);
  });

  it("turn the page the viewer is showing", async () => {
    const { session, ctx } = setup();
    session.page = 4;
    await rotatePageRight.run(ctx);
    expect(session.ops).toEqual([{ kind: 'pages.rotate', pages: [4], degrees: 90 }]);
  });

  it("do nothing when the current page is unknown", async () => {
    const { session, ctx } = setup();
    session.page = null;
    await rotatePageRight.run(ctx);
    expect(session.ops).toEqual([]);
  });
});

describe("Flatten", () => {
  it("asks first and runs nothing on Cancel", async () => {
    const { session, dialogs, ctx } = setup();
    dialogs.answer(BUTTON.cancel.id);
    await flatten.run(ctx);
    expect(dialogs.asked).toEqual([{
      title: FLATTEN_DIALOG.title,
      body: FLATTEN_DIALOG.body,
      buttons: ["continue", "cancel"],
    }]);
    expect(session.ops).toEqual([]);
  });

  it("runs the operation once the user confirms", async () => {
    const { session, dialogs, ctx } = setup();
    dialogs.answer(BUTTON.continue.id);
    await flatten.run(ctx);
    expect(session.ops).toEqual([{ kind: 'flatten' }]);
  });
});
