import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EngineError, type Capability, type EngineAdapter, type EngineOp, type EngineResult,
} from "../engine/EngineAdapter";
import { EngineRegistry } from "../engine/engineRegistry";
import { FileError, type FileRef } from "../files/FileAdapter";
import { FakeFileAdapter } from "../files/fakeFileAdapter";
import { FakeViewer } from "../viewer/fakeViewer";
import type { ViewState } from "../viewer/Viewer";
import {
  closeDirtyDialog, ENCRYPTED_DIALOG, externalLinkDialog, firstSaveDialog, LOCKED_DIALOG,
  OPEN_ELSEWHERE_DIALOG, OPERATION_FAILED_DIALOG, OPERATION_GUARD_DIALOG, SAVE_FAILED_TITLE,
  SIGNATURE_GUARD_DIALOG, type DialogButton, type Dialogs,
} from "./dialogTexts";
import { SessionManager } from "./SessionManager";
import type { HistoryStateV1, SessionStateV1, SettingsV1 } from "./state";

// Fakes and helpers

interface Asked { title: string; body: string; buttons: string[]; }

class FakeDialogs implements Dialogs {
  readonly asked: Asked[] = [];
  readonly unexpected: string[] = [];
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
    if (id === undefined) {
      this.unexpected.push(title);
      throw new Error(`Unexpected dialog with nothing queued: "${title}"`);
    }
    return id;
  }
}

const HOST = {} as HTMLElement;
const A = "C:\\docs\\a.pdf";
const B = "C:\\docs\\b.pdf";
const C = "C:\\docs\\c.pdf";
const D = "C:\\docs\\d.pdf";
const PLAIN = new TextEncoder().encode("%PDF-1.7 plain");
const SIGNED = new TextEncoder().encode("%PDF-1.7 /ByteRange [0 0 0 0]");
const APPENDED = new TextEncoder().encode("%PDF-1.7 plain appended");
const REWRITTEN = new TextEncoder().encode("%PDF-1.7 rewritten");

let current: FakeDialogs | null = null;

const last = <T>(items: T[]): T | undefined => items[items.length - 1];

interface SetupOptions {
  host?: boolean;
  files?: [FileRef, Uint8Array?][];
  viewer?: (v: FakeViewer) => void;
  engines?: EngineRegistry;
}

function setup(options: SetupOptions = {}) {
  const files = new FakeFileAdapter();
  for (const [ref, bytes] of options.files ?? [[A], [B], [C], [D]]) {
    files.addFile(ref, ref.split("\\").pop() as string, bytes ?? PLAIN);
  }
  const viewers: FakeViewer[] = [];
  const dialogs = new FakeDialogs();
  current = dialogs;
  let ids = 0;
  let seconds = 0;
  const manager = new SessionManager(files, () => {
    const viewer = new FakeViewer();
    options.viewer?.(viewer);
    viewers.push(viewer);
    return viewer;
  }, dialogs, {
    newId: () => `tab-${++ids}`,
    now: () => new Date(Date.UTC(2026, 8, 19) + 1000 * seconds++).toISOString(),
    engines: options.engines,
  });
  if (options.host !== false) manager.setViewerHost(HOST);

  const snap = () => manager.getSnapshot();
  const tab = (i: number) => snap().tabs[i];
  const active = () => snap().tabs.find((t) => t.id === snap().activeTabId);
  return { files, viewers, dialogs, manager, snap, tab, active };
}

function savedSession(refs: FileRef[], activeIndex: number | null): SessionStateV1 {
  return {
    version: 1,
    tabs: refs.map((ref, i) => ({ id: `saved-${i}`, ref, name: ref.split("\\").pop() as string, saveConfirmed: false })),
    activeTabId: activeIndex === null ? null : `saved-${activeIndex}`,
  };
}

afterEach(() => {
  // Every dialog a test reached had an answer queued, and every queued answer was used.
  expect(current?.unexpected ?? []).toEqual([]);
  expect(current?.unanswered ?? []).toEqual([]);
  current = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Spec 15 item 4: open, activate, close, restore, history

describe("SessionManager opening and activating", () => {
  it("opening adds a tab and activates it", async () => {
    const { manager, viewers, snap, active } = setup();
    await manager.start();
    await manager.openRefs([A]);
    expect(snap().tabs).toHaveLength(1);
    expect(active()).toMatchObject({ ref: A, name: "a.pdf", status: "ready", dirty: false });
    expect(viewers).toHaveLength(1);
    expect(viewers[0].mounted).toBe(true);
    expect(viewers[0].loads).toEqual([{ bytes: PLAIN, filename: "a.pdf", view: null }]);
    expect(viewers[0].visible).toBe(true);
    expect(viewers[0].focusCount).toBe(1);
  });

  it("opening the same file twice activates the existing tab", async () => {
    const { manager, snap, active, viewers } = setup();
    await manager.start();
    await manager.openRefs([A, B]);
    await manager.openRefs(["c:\\DOCS\\A.PDF"]);
    expect(snap().tabs.map((t) => t.ref)).toEqual([A, B]);
    expect(active()?.ref).toBe(A);
    // Only B loaded first, so viewers[0] is B's and viewers[1] is A's.
    expect(viewers).toHaveLength(2);
    expect(viewers[0].visible).toBe(false);
    expect(viewers[1].visible).toBe(true);
  });

  it("openRefs activates the tab for the last ref", async () => {
    const { manager, active, snap } = setup();
    await manager.start();
    await manager.openRefs([A, B, C]);
    expect(active()?.ref).toBe(C);
    expect(snap().tabs.map((t) => t.status)).toEqual(["unloaded", "unloaded", "ready"]);
  });

  it("closing activates the right neighbour, else the left", async () => {
    const { manager, active, snap } = setup();
    await manager.start();
    await manager.openRefs([A, B, C]);
    await manager.activate(snap().tabs[1].id);
    expect(await manager.closeTab(snap().tabs[1].id)).toBe(true);
    expect(active()?.ref).toBe(C);
    expect(await manager.closeTab(snap().tabs[1].id)).toBe(true);
    expect(active()?.ref).toBe(A);
    expect(await manager.closeTab(snap().tabs[0].id)).toBe(true);
    expect(snap()).toMatchObject({ tabs: [], activeTabId: null });
  });

  it("closing a tab destroys its viewer, and closing an inactive tab keeps the active one", async () => {
    const { manager, viewers, snap, active } = setup();
    await manager.start();
    await manager.openRefs([A]);
    await manager.openRefs([B]);
    await manager.closeTab(snap().tabs[0].id);
    expect(viewers[0].destroyed).toBe(true);
    expect(active()?.ref).toBe(B);
    expect(viewers[1].destroyed).toBe(false);
  });

  it("a missing file becomes not-found only when activated", async () => {
    const { manager, files, snap, tab, viewers } = setup();
    await files.saveState("session", savedSession([A, "C:\\gone\\x.pdf"], 0));
    await manager.start();
    expect(tab(1).status).toBe("unloaded");
    await manager.activate(tab(1).id);
    expect(tab(1).status).toBe("not-found");
    expect(snap().activeTabId).toBe(tab(1).id);
    expect(viewers).toHaveLength(1);
  });

  it("any other read error sets status error with the message", async () => {
    const { manager, files, tab } = setup();
    await manager.start();
    files.failNext("read", A, new FileError("io", "Disk on fire"));
    await manager.openRefs([A]);
    expect(tab(0)).toMatchObject({ status: "error", errorMessage: "Disk on fire" });
  });

  it("a viewer whose load throws gives status error", async () => {
    const files = new FakeFileAdapter();
    files.addFile(A, "a.pdf", PLAIN);
    const viewer = new FakeViewer();
    viewer.loadError = "Invalid PDF structure.";
    const dialogs = new FakeDialogs();
    current = dialogs;
    const manager = new SessionManager(files, () => viewer, dialogs, { newId: () => "t" });
    manager.setViewerHost(HOST);
    await manager.openRefs([A]);
    expect(manager.getSnapshot().tabs[0]).toMatchObject({ status: "error", errorMessage: "Invalid PDF structure." });
    expect(viewer.destroyed).toBe(true);
  });

  it("dirtychange updates the tab", async () => {
    const { manager, viewers, tab } = setup();
    await manager.start();
    await manager.openRefs([A]);
    viewers[0].setDirty(true);
    expect(tab(0).dirty).toBe(true);
    viewers[0].setDirty(false);
    expect(tab(0).dirty).toBe(false);
  });
});

describe("SessionManager snapshots", () => {
  it("a snapshot is reference-stable when nothing changed, and new after a change", async () => {
    const { manager, viewers } = setup();
    await manager.start();
    await manager.openRefs([A, B]);
    const before = manager.getSnapshot();
    expect(manager.getSnapshot()).toBe(before);
    viewers[0].setDirty(false); // no change
    await manager.activate(before.activeTabId as string); // already active and ready
    expect(manager.getSnapshot()).toBe(before);

    let notified = 0;
    const off = manager.subscribe(() => notified++);
    viewers[0].setDirty(true);
    const after = manager.getSnapshot();
    expect(after).not.toBe(before);
    expect(notified).toBe(1);
    // The unchanged tab keeps its object, so React can skip it.
    expect(after.tabs[0]).toBe(before.tabs[0]);
    expect(after.tabs[1]).not.toBe(before.tabs[1]);
    off();
    viewers[0].setDirty(false);
    expect(notified).toBe(1);
  });
});

describe("SessionManager snapshot recent and settings (spec 8.5)", () => {
  it("start puts the stored settings and the first 15 history items in the snapshot", async () => {
    const { manager, files, snap } = setup();
    const items: HistoryStateV1["items"] = Array.from({ length: 20 }, (_, i) => ({
      ref: `C:\old\${i}.pdf`, name: `${i}.pdf`, lastOpened: "2026-01-01T00:00:00.000Z", view: null,
    }));
    await files.saveState<HistoryStateV1>("history", { version: 1, items });
    await files.saveState<SettingsV1>("settings", { version: 1, restoreSession: false, keepBackup: false });
    await manager.start();
    expect(snap().settings).toEqual({ version: 1, restoreSession: false, keepBackup: false });
    expect(snap().recent).toHaveLength(15);
    expect(snap().recent).toBe(manager.getRecent());
    expect(snap().settings).toBe(manager.getSettings());
  });

  it("opening a file gives a new snapshot with the file first in recent", async () => {
    const { manager, snap } = setup();
    await manager.start();
    const before = snap();
    expect(before.recent).toEqual([]);
    await manager.openRefs([A]);
    expect(snap()).not.toBe(before);
    expect(snap().recent.map((i) => i.ref)).toEqual([A]);
  });

  it("clearHistory gives a new snapshot with an empty recent list and notifies", async () => {
    const { manager, snap } = setup();
    await manager.start();
    await manager.openRefs([A, B]);
    const before = snap();
    let notified = 0;
    manager.subscribe(() => notified++);
    manager.clearHistory();
    expect(snap()).not.toBe(before);
    expect(snap().recent).toEqual([]);
    expect(snap().tabs).toHaveLength(2);
    expect(notified).toBe(1);
  });

  it("updateSettings gives a new snapshot with the new settings and notifies", async () => {
    const { manager, snap } = setup();
    await manager.start();
    const before = snap();
    let notified = 0;
    manager.subscribe(() => notified++);
    manager.updateSettings({ restoreSession: false });
    expect(snap()).not.toBe(before);
    expect(snap().settings).toEqual({ version: 1, restoreSession: false, keepBackup: false });
    expect(notified).toBe(1);
  });

  it("viewchange gives a new snapshot whose recent item carries the view", async () => {
    const { manager, viewers, snap } = setup();
    await manager.start();
    await manager.openRefs([A]);
    const before = snap();
    const view: ViewState = { page: 2, scale: "page-width", rotation: 0 };
    viewers[0].emit("viewchange", view);
    expect(snap()).not.toBe(before);
    expect(snap().recent[0].view).toEqual(view);
    expect(snap().tabs[0]).toBe(before.tabs[0]);
  });

  it("Save As gives a new snapshot with the new file first in recent", async () => {
    const { manager, files, snap, viewer, id } = await openDirty();
    files.queueSaveTarget("C:\docs\copy.pdf");
    const before = snap();
    expect(await manager.saveAs(id)).toBe(true);
    expect(snap()).not.toBe(before);
    expect(snap().recent[0].ref).toBe("C:\docs\copy.pdf");
    expect(viewer.loads).toHaveLength(1);
  });
});

describe("SessionManager lazy loading and races", () => {
  it("three restored tabs create exactly one viewer until another is activated", async () => {
    const { manager, files, viewers, snap, tab } = setup();
    await files.saveState("session", savedSession([A, B, C], 1));
    await manager.start();
    expect(snap().tabs.map((t) => t.status)).toEqual(["unloaded", "ready", "unloaded"]);
    expect(viewers).toHaveLength(1);
    await manager.activate(tab(2).id);
    expect(viewers).toHaveLength(2);
    expect(viewers[0].visible).toBe(false);
    expect(viewers[1].visible).toBe(true);
  });

  it("activating while the host is null loads once the host is set", async () => {
    const { manager, viewers, tab } = setup({ host: false });
    await manager.start();
    const opening = manager.openRefs([A]);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(tab(0).status).toBe("loading");
    expect(viewers).toHaveLength(0);
    manager.setViewerHost(HOST);
    await opening;
    expect(tab(0).status).toBe("ready");
    expect(viewers).toHaveLength(1);
    expect(viewers[0].visible).toBe(true);
  });

  it("a second activate of a loading tab does not read the file twice", async () => {
    const { manager, files, viewers, tab } = setup();
    await files.saveState("session", savedSession([A, B], 0));
    await manager.start();
    const read = vi.spyOn(files, "readFile");
    const first = manager.activate(tab(1).id);
    // The second call waits for the load the first one started.
    await manager.activate(tab(1).id);
    expect(tab(1).status).toBe("ready");
    expect(viewers[1].focusCount).toBeGreaterThan(0);
    await first;
    expect(read).toHaveBeenCalledTimes(1);
    expect(viewers).toHaveLength(2);
  });

  it("closing a tab while its viewer mounts does not load the document", async () => {
    let manager: SessionManager | null = null;
    const env = setup({
      viewer: (v) => {
        const mount = v.mount.bind(v);
        v.mount = async (container) => {
          await manager?.closeTab(env.tab(0).id);
          return mount(container);
        };
      },
    });
    manager = env.manager;
    await env.manager.start();
    await env.manager.openRefs([A]);
    expect(env.snap().tabs).toEqual([]);
    expect(env.viewers[0].destroyed).toBe(true);
    expect(env.viewers[0].loads).toEqual([]);
  });

  it("only the tab active when its load finishes is shown and focused", async () => {
    const { manager, files, viewers, tab } = setup();
    await files.saveState("session", savedSession([A, B, C], 0));
    await manager.start();
    const slow = manager.activate(tab(1).id);
    const fast = manager.activate(tab(2).id);
    await Promise.all([slow, fast]);
    const [, b, c] = viewers;
    expect(b.visible).toBe(false);
    expect(b.focusCount).toBe(0);
    expect(c.visible).toBe(true);
    expect(c.focusCount).toBe(1);
  });

  it("closing a tab while it loads leaves no viewer behind", async () => {
    const { manager, viewers, snap } = setup({ host: false });
    await manager.start();
    const opening = manager.openRefs([A]);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await manager.closeTab(snap().tabs[0].id);
    manager.setViewerHost(HOST);
    await opening;
    expect(viewers).toHaveLength(0);
    expect(snap().tabs).toHaveLength(0);
  });
});

describe("SessionManager window title (spec 11.7)", () => {
  it("follows the active tab, with ' *' when dirty", async () => {
    const { manager, files, viewers, snap } = setup();
    await manager.start();
    expect(last(files.titles)).toBe("PDFluffer");
    await manager.openRefs([A]);
    expect(last(files.titles)).toBe("a.pdf - PDFluffer");
    viewers[0].setDirty(true);
    expect(last(files.titles)).toBe("a.pdf * - PDFluffer");
    await manager.openRefs([B]);
    expect(last(files.titles)).toBe("b.pdf - PDFluffer");
    await manager.closeTab(snap().tabs[1].id);
    expect(last(files.titles)).toBe("a.pdf * - PDFluffer");
  });
});

describe("SessionManager start and restore (spec 12.6)", () => {
  it("restore rebuilds the saved tabs as unloaded and activates the saved active tab", async () => {
    const { manager, files, snap, tab } = setup();
    await files.saveState("session", savedSession([A, B, C], 2));
    await manager.start();
    expect(snap().tabs.map((t) => [t.id, t.ref])).toEqual([["saved-0", A], ["saved-1", B], ["saved-2", C]]);
    expect(snap().activeTabId).toBe("saved-2");
    expect(tab(0).status).toBe("unloaded");
    expect(tab(1).status).toBe("unloaded");
    expect(tab(2).status).toBe("ready");
  });

  it("restore activates the first tab when the saved active tab is gone", async () => {
    const { manager, files, snap } = setup();
    await files.saveState("session", { ...savedSession([A, B], null), activeTabId: "nope" });
    await manager.start();
    expect(snap().activeTabId).toBe("saved-0");
  });

  it("pending files win the active tab", async () => {
    const { manager, files, snap, active, viewers } = setup();
    await files.saveState("session", savedSession([A, B], 0));
    files.setPending([C]);
    await manager.start();
    expect(snap().tabs.map((t) => t.ref)).toEqual([A, B, C]);
    expect(active()?.ref).toBe(C);
    expect(viewers).toHaveLength(1);
  });

  it("a pending file already in the session activates that tab without a duplicate", async () => {
    const { manager, files, snap, active } = setup();
    await files.saveState("session", savedSession([A, B], 0));
    files.setPending(["c:\\docs\\B.pdf"]);
    await manager.start();
    expect(snap().tabs.map((t) => t.ref)).toEqual([A, B]);
    expect(active()?.ref).toBe(B);
  });

  it("subscribes to open requests before taking pending ones", async () => {
    const { manager, files, active } = setup();
    await files.saveState("session", savedSession([A], 0));
    vi.spyOn(files, "takePendingOpenRequests").mockImplementation(async () => {
      files.emitOpenRequest([D]);
      return [];
    });
    await manager.start();
    expect(active()?.ref).toBe(D);
    await vi.waitFor(() => expect(active()?.status).toBe("ready"));
  });

  it("an open request while running opens the file", async () => {
    const { manager, files, active } = setup();
    await manager.start();
    files.emitOpenRequest([B]);
    await vi.waitFor(() => expect(active()).toMatchObject({ ref: B, status: "ready" }));
  });

  it("restoreSession false starts empty but opens pending files", async () => {
    const { manager, files, snap, active } = setup();
    await files.saveState<SettingsV1>("settings", { version: 1, restoreSession: false, keepBackup: false });
    await files.saveState("session", savedSession([A, B], 0));
    files.setPending([C]);
    await manager.start();
    expect(snap().tabs.map((t) => t.ref)).toEqual([C]);
    expect(active()?.ref).toBe(C);
  });

  it("restoreSession false with nothing pending shows the empty state", async () => {
    const { manager, files, snap, viewers } = setup();
    await files.saveState<SettingsV1>("settings", { version: 1, restoreSession: false, keepBackup: false });
    await files.saveState("session", savedSession([A, B], 0));
    await manager.start();
    expect(snap()).toMatchObject({ tabs: [], activeTabId: null });
    expect(viewers).toHaveLength(0);
  });

  it("a not-found tab stays in the bar and in the saved session", async () => {
    const { manager, files, tab } = setup();
    await files.saveState("session", savedSession(["C:\\gone\\x.pdf"], 0));
    await manager.start();
    expect(tab(0).status).toBe("not-found");
    expect(await manager.confirmCloseAll()).toBe(true);
    const saved = await files.loadState<SessionStateV1>("session");
    expect(saved?.tabs.map((t) => t.ref)).toEqual(["C:\\gone\\x.pdf"]);
  });
});

describe("SessionManager locate (spec 12.6)", () => {
  it("locate replaces the ref and name, then loads the tab", async () => {
    const { manager, files, tab, viewers } = setup();
    await files.saveState("session", savedSession(["C:\\gone\\x.pdf"], 0));
    await manager.start();
    files.queuePickFiles([D, A]);
    await manager.locate(tab(0).id);
    expect(tab(0)).toMatchObject({ id: "saved-0", ref: D, name: "d.pdf", status: "ready" });
    expect(viewers).toHaveLength(1);
    expect(manager.getRecent()[0].ref).toBe(D);
  });

  it("locate does nothing when the dialog is cancelled", async () => {
    const { manager, files, tab } = setup();
    await files.saveState("session", savedSession(["C:\\gone\\x.pdf"], 0));
    await manager.start();
    await manager.locate(tab(0).id);
    expect(tab(0)).toMatchObject({ ref: "C:\\gone\\x.pdf", status: "not-found" });
  });

  it("locate onto a file open in another tab is refused", async () => {
    const { manager, files, tab, dialogs } = setup();
    await files.saveState("session", savedSession(["C:\\gone\\x.pdf", A], 0));
    await manager.start();
    files.queuePickFiles([A]);
    dialogs.answer("ok");
    await manager.locate(tab(0).id);
    expect(dialogs.asked).toEqual([asked(OPEN_ELSEWHERE_DIALOG)]);
    expect(tab(0).ref).toBe("C:\\gone\\x.pdf");
  });
});

describe("SessionManager history", () => {
  it("history moves the opened file to the front and caps at 100", async () => {
    const { manager, files } = setup();
    const items: HistoryStateV1["items"] = Array.from({ length: 100 }, (_, i) => ({
      ref: `C:\\old\\${i}.pdf`, name: `${i}.pdf`, lastOpened: "2026-01-01T00:00:00.000Z", view: null,
    }));
    const oldView: ViewState = { page: 3, scale: "page-fit", rotation: 90 };
    items[50].view = oldView;
    await files.saveState<HistoryStateV1>("history", { version: 1, items });
    await manager.start();

    await manager.openRefs([A]);
    expect(manager.getRecent()).toHaveLength(15);
    expect(manager.getRecent()[0]).toMatchObject({ ref: A, name: "a.pdf", lastOpened: "2026-09-19T00:00:00.000Z" });

    await manager.openRefs(["C:\\old\\50.pdf"]);
    expect(manager.getRecent()[0]).toMatchObject({ ref: "C:\\old\\50.pdf", view: oldView });

    await manager.confirmCloseAll();
    const saved = await files.loadState<HistoryStateV1>("history");
    expect(saved?.items).toHaveLength(100);
    expect(saved?.items.slice(0, 3).map((i) => i.ref)).toEqual(["C:\\old\\50.pdf", A, "C:\\old\\0.pdf"]);
    expect(last(saved?.items ?? [])?.ref).toBe("C:\\old\\98.pdf");
  });

  it("getRecent returns the same array until the history changes", async () => {
    const { manager } = setup();
    await manager.start();
    await manager.openRefs([A]);
    const recent = manager.getRecent();
    expect(manager.getRecent()).toBe(recent);
    await manager.openRefs([B]);
    expect(manager.getRecent()).not.toBe(recent);
  });

  it("viewchange reaches history, and a reopened file loads with that view", async () => {
    const { manager, viewers, snap, files } = setup();
    await manager.start();
    await manager.openRefs([A]);
    const view: ViewState = { page: 4, scale: "1.25", rotation: 180 };
    viewers[0].emit("viewchange", view);
    expect(manager.getRecent()[0].view).toEqual(view);
    await manager.closeTab(snap().tabs[0].id);
    await manager.openRefs([A]);
    expect(viewers[1].loads[0].view).toEqual(view);
    await manager.confirmCloseAll();
    expect((await files.loadState<HistoryStateV1>("history"))?.items[0].view).toEqual(view);
  });

  it("clearHistory empties the history but keeps the tabs open", async () => {
    const { manager, files, snap } = setup();
    await manager.start();
    await manager.openRefs([A, B]);
    manager.clearHistory();
    expect(manager.getRecent()).toEqual([]);
    expect(snap().tabs).toHaveLength(2);
    await manager.confirmCloseAll();
    expect(await files.loadState("history")).toEqual({ version: 1, items: [] });
  });
});

// Spec 15 item 5: the save flow

function asked(text: { title: string; body: string; buttons: DialogButton[] }): Asked {
  return { title: text.title, body: text.body, buttons: text.buttons.map((b) => b.id) };
}

async function openDirty(files: [FileRef, Uint8Array?][] = [[A], [B], [C], [D]]) {
  const env = setup({ files });
  await env.manager.start();
  await env.manager.openRefs([A]);
  const viewer = env.viewers[0];
  viewer.setDirty(true);
  viewer.nextExport = { mode: "append", bytes: APPENDED };
  return { ...env, viewer, id: env.tab(0).id };
}

describe("SessionManager save (spec 12.3)", () => {
  it("the first save asks, Overwrite sets saveConfirmed, and the second save does not ask", async () => {
    const { manager, files, dialogs, viewer, id, tab } = await openDirty();
    dialogs.answer("overwrite");
    expect(await manager.save(id)).toBe(true);
    expect(dialogs.asked).toEqual([asked(firstSaveDialog("a.pdf"))]);
    expect(files.writes).toEqual([{ ref: A, bytes: APPENDED, options: { keepBackup: false } }]);
    expect(tab(0)).toMatchObject({ saveConfirmed: true, dirty: false });

    viewer.setDirty(true);
    expect(await manager.save(id)).toBe(true);
    expect(dialogs.asked).toHaveLength(1);
    expect(files.writes).toHaveLength(2);
  });

  it("Cancel writes nothing, and the tab stays dirty until a later save", async () => {
    const { manager, files, dialogs, viewer, id, tab } = await openDirty();
    dialogs.answer("cancel");
    expect(await manager.save(id)).toBe(false);
    expect(files.writes).toEqual([]);
    expect(tab(0)).toMatchObject({ dirty: true, saveConfirmed: false });

    // The viewer is clean after the export, but the exported bytes are not on disk yet.
    viewer.nextExport = { mode: "none" };
    dialogs.answer("overwrite");
    expect(await manager.save(id)).toBe(true);
    expect(files.writes.map((w) => w.bytes)).toEqual([APPENDED]);
    expect(tab(0).dirty).toBe(false);
  });

  it("a throwing exportBytes writes nothing and shows the message", async () => {
    const { manager, files, dialogs, viewer, id, tab } = await openDirty();
    viewer.nextExport = new Error("Export broke");
    dialogs.answer("ok");
    expect(await manager.save(id)).toBe(false);
    expect(files.writes).toEqual([]);
    expect(dialogs.asked).toEqual([{ title: SAVE_FAILED_TITLE, body: "Export broke", buttons: ["ok"] }]);
    expect(tab(0).dirty).toBe(true);
  });

  it("a locked file writes nothing and returns false", async () => {
    const { manager, files, dialogs, id, tab } = await openDirty();
    files.failNext("write", A, new FileError("locked", "locked"));
    dialogs.answer("overwrite", "ok");
    expect(await manager.save(id)).toBe(false);
    expect(files.writes).toEqual([]);
    expect(dialogs.asked[1]).toEqual(asked(LOCKED_DIALOG));
    expect(tab(0).dirty).toBe(true);
  });

  it("any other write error shows the message and returns false", async () => {
    const { manager, files, dialogs, id } = await openDirty();
    files.failNext("write", A, new FileError("io", "Disk full"));
    dialogs.answer("overwrite", "ok");
    expect(await manager.save(id)).toBe(false);
    expect(dialogs.asked[1]).toEqual({ title: SAVE_FAILED_TITLE, body: "Disk full", buttons: ["ok"] });
  });

  it("saving a clean tab writes nothing and asks nothing", async () => {
    const { manager, files, tab } = setup();
    await manager.start();
    await manager.openRefs([A]);
    expect(await manager.save(tab(0).id)).toBe(true);
    expect(files.writes).toEqual([]);
  });

  it("the keepBackup setting reaches writeFile", async () => {
    const { manager, files, dialogs, id } = await openDirty();
    manager.updateSettings({ keepBackup: true });
    dialogs.answer("overwrite");
    await manager.save(id);
    expect(files.writes[0].options).toEqual({ keepBackup: true });
  });

  it("after an append save the viewer is not reloaded, after a rewrite save it is", async () => {
    const { manager, dialogs, viewer, id } = await openDirty();
    dialogs.answer("overwrite");
    await manager.save(id);
    expect(viewer.loads).toHaveLength(1);

    viewer.setDirty(true);
    viewer.nextExport = { mode: "rewrite", bytes: REWRITTEN };
    viewer.viewState = { page: 2, scale: "page-width", rotation: 0 };
    await manager.save(id);
    expect(viewer.loads).toHaveLength(2);
    expect(viewer.loads[1]).toEqual({ bytes: REWRITTEN, filename: "a.pdf", view: { page: 2, scale: "page-width", rotation: 0 } });
  });
});

describe("SessionManager Save As (spec 12.3)", () => {
  it("Save As onto a file open in another tab is refused", async () => {
    const { manager, files, dialogs, id } = await openDirty();
    await manager.openRefs([B]);
    files.queueSaveTarget("c:\\docs\\B.PDF");
    dialogs.answer("ok");
    expect(await manager.saveAs(id)).toBe(false);
    expect(dialogs.asked).toEqual([asked(OPEN_ELSEWHERE_DIALOG)]);
    expect(files.writes).toEqual([]);
  });

  it("Save As works on a clean tab with no dialog, and repoints the tab", async () => {
    const { manager, files, tab, dialogs } = setup();
    await manager.start();
    await manager.openRefs([A]);
    files.queueSaveTarget("C:\\docs\\copy.pdf");
    expect(await manager.saveAs(tab(0).id)).toBe(true);
    expect(dialogs.asked).toEqual([]);
    expect(files.writes).toEqual([{ ref: "C:\\docs\\copy.pdf", bytes: PLAIN, options: { keepBackup: false } }]);
    expect(tab(0)).toMatchObject({ ref: "C:\\docs\\copy.pdf", name: "copy.pdf", saveConfirmed: true, dirty: false });
    expect(manager.getRecent()[0].ref).toBe("C:\\docs\\copy.pdf");
    expect(last(files.titles)).toBe("copy.pdf - PDFluffer");
  });

  it("Save As onto the tab's own file is allowed", async () => {
    const { manager, files, id } = await openDirty();
    files.queueSaveTarget("c:\\DOCS\\a.pdf");
    expect(await manager.saveAs(id)).toBe(true);
    expect(files.writes).toHaveLength(1);
  });

  it("a cancelled Save As dialog writes nothing", async () => {
    const { manager, files, id, tab } = await openDirty();
    expect(await manager.saveAs(id)).toBe(false);
    expect(files.writes).toEqual([]);
    expect(tab(0).dirty).toBe(true);
  });

  it("Save As... in the first-save dialog switches to Save As", async () => {
    const { manager, files, dialogs, id, tab } = await openDirty();
    files.queueSaveTarget("C:\\docs\\other.pdf");
    dialogs.answer("saveAs");
    expect(await manager.save(id)).toBe(true);
    expect(files.writes.map((w) => [w.ref, w.bytes])).toEqual([["C:\\docs\\other.pdf", APPENDED]]);
    expect(tab(0).ref).toBe("C:\\docs\\other.pdf");
  });
});

describe("SessionManager signature guard (spec 12.4)", () => {
  // The rewritten bytes still carry the key, so the tab stays signed after the first save.
  const REWRITTEN_SIGNED = new TextEncoder().encode("%PDF-1.7 rewritten /ByteRange [1 2 3 4]");

  async function openSigned() {
    const env = await openDirty([[A, SIGNED], [B]]);
    env.viewer.nextExport = { mode: "rewrite", bytes: REWRITTEN_SIGNED };
    return env;
  }

  it("marks a signed file", async () => {
    const { tab } = await openSigned();
    expect(tab(0).hasDigitalSignature).toBe(true);
  });

  it("a rewrite on a signed file asks, Continue proceeds, and it does not ask twice", async () => {
    const { manager, files, dialogs, viewer, id, tab } = await openSigned();
    dialogs.answer("continue", "overwrite");
    expect(await manager.save(id)).toBe(true);
    expect(dialogs.asked).toEqual([asked(SIGNATURE_GUARD_DIALOG), asked(firstSaveDialog("a.pdf"))]);
    expect(files.writes.map((w) => w.bytes)).toEqual([REWRITTEN_SIGNED]);
    expect(tab(0).hasDigitalSignature).toBe(true);

    viewer.setDirty(true);
    expect(await manager.save(id)).toBe(true);
    expect(dialogs.asked).toHaveLength(2);
    expect(files.writes).toHaveLength(2);
  });

  it("Save As a copy goes to Save As", async () => {
    const { manager, files, dialogs, id, tab } = await openSigned();
    files.queueSaveTarget("C:\\docs\\copy.pdf");
    dialogs.answer("saveCopy");
    expect(await manager.save(id)).toBe(true);
    expect(dialogs.asked).toEqual([asked(SIGNATURE_GUARD_DIALOG)]);
    expect(files.writes.map((w) => w.ref)).toEqual(["C:\\docs\\copy.pdf"]);
    expect(tab(0).ref).toBe("C:\\docs\\copy.pdf");
  });

  it("Cancel writes nothing", async () => {
    const { manager, files, dialogs, id, tab } = await openSigned();
    dialogs.answer("cancel");
    expect(await manager.save(id)).toBe(false);
    expect(files.writes).toEqual([]);
    expect(tab(0).dirty).toBe(true);
  });

  it("an append on a signed file never shows the guard", async () => {
    const { manager, dialogs, viewer, id } = await openSigned();
    viewer.nextExport = { mode: "append", bytes: APPENDED };
    dialogs.answer("overwrite");
    expect(await manager.save(id)).toBe(true);
    expect(dialogs.asked).toEqual([asked(firstSaveDialog("a.pdf"))]);
  });
});

// Spec 15 item 6: the close flow

describe("SessionManager close (spec 12.5)", () => {
  it("Save saves, then closes", async () => {
    const { manager, files, dialogs, id, snap, viewer } = await openDirty();
    dialogs.answer("save", "overwrite");
    expect(await manager.closeTab(id)).toBe(true);
    expect(dialogs.asked[0]).toEqual(asked(closeDirtyDialog("a.pdf")));
    expect(files.writes).toHaveLength(1);
    expect(snap().tabs).toEqual([]);
    expect(viewer.destroyed).toBe(true);
  });

  it("Save that does not complete keeps the tab open", async () => {
    const { manager, files, dialogs, id, snap } = await openDirty();
    dialogs.answer("save", "cancel");
    expect(await manager.closeTab(id)).toBe(false);
    expect(files.writes).toEqual([]);
    expect(snap().tabs).toHaveLength(1);
  });

  it("Discard closes without writing", async () => {
    const { manager, files, dialogs, id, snap, viewer } = await openDirty();
    dialogs.answer("discard");
    expect(await manager.closeTab(id)).toBe(true);
    expect(files.writes).toEqual([]);
    expect(snap().tabs).toEqual([]);
    expect(viewer.destroyed).toBe(true);
  });

  it("Cancel keeps the tab open and dirty", async () => {
    const { manager, files, dialogs, id, tab, viewer } = await openDirty();
    dialogs.answer("cancel");
    expect(await manager.closeTab(id)).toBe(false);
    expect(files.writes).toEqual([]);
    expect(tab(0).dirty).toBe(true);
    expect(viewer.destroyed).toBe(false);
  });

  it("confirmCloseAll activates each dirty tab in order and stops at the first Cancel", async () => {
    const { manager, dialogs, viewers, active } = setup();
    await manager.start();
    for (const ref of [A, B, C, D]) await manager.openRefs([ref]);
    viewers[0].setDirty(true);
    viewers[2].setDirty(true);
    viewers[3].setDirty(true);
    dialogs.answer("discard", "cancel");
    expect(await manager.confirmCloseAll()).toBe(false);
    expect(dialogs.asked.map((a) => a.title)).toEqual(["Save changes to a.pdf?", "Save changes to c.pdf?"]);
    expect(active()?.ref).toBe(C);
  });

  it("confirmCloseAll returns true when every dirty tab passes", async () => {
    const { manager, dialogs, viewers } = setup();
    await manager.start();
    for (const ref of [A, B]) await manager.openRefs([ref]);
    viewers[0].setDirty(true);
    viewers[1].setDirty(true);
    dialogs.answer("discard", "discard");
    expect(await manager.confirmCloseAll()).toBe(true);
  });

  it("confirmCloseAll that returns true destroys every viewer first (chip 6 ruling 3)", async () => {
    const { manager, dialogs, viewers } = setup();
    await manager.start();
    for (const ref of [A, B, C]) await manager.openRefs([ref]);
    viewers[1].setDirty(true);
    dialogs.answer("discard");
    expect(await manager.confirmCloseAll()).toBe(true);
    expect(viewers.length).toBe(3);
    expect(viewers.map((v) => v.destroyed)).toEqual([true, true, true]);
  });

  it("confirmCloseAll that returns false destroys no viewer", async () => {
    const { manager, dialogs, viewers } = setup();
    await manager.start();
    for (const ref of [A, B, C]) await manager.openRefs([ref]);
    viewers[1].setDirty(true);
    dialogs.answer("cancel");
    expect(await manager.confirmCloseAll()).toBe(false);
    expect(viewers.map((v) => v.destroyed)).toEqual([false, false, false]);
  });

  it("confirmCloseAll flushes the savers, and the session holds only its schema fields", async () => {
    vi.useFakeTimers();
    const { manager, files } = setup();
    await manager.start();
    await manager.openRefs([A]);
    await vi.advanceTimersByTimeAsync(100);
    expect(await files.loadState("session")).toBeNull();
    expect(await files.loadState("history")).toBeNull();

    expect(await manager.confirmCloseAll()).toBe(true);
    const session = await files.loadState<SessionStateV1>("session");
    expect(session).toEqual({
      version: 1, tabs: [{ id: "tab-1", ref: A, name: "a.pdf", saveConfirmed: false }], activeTabId: "tab-1",
    });
    expect(Object.keys(session?.tabs[0] ?? {}).sort()).toEqual(["id", "name", "ref", "saveConfirmed"]);
    expect((await files.loadState<HistoryStateV1>("history"))?.items.map((i) => i.ref)).toEqual([A]);
  });

  it("the savers write session and history 500 ms after the last change", async () => {
    vi.useFakeTimers();
    const { manager, files } = setup();
    await manager.start();
    await manager.openRefs([A]);
    await vi.advanceTimersByTimeAsync(499);
    expect(await files.loadState("session")).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(await files.loadState("session")).not.toBeNull();
    expect(await files.loadState("history")).not.toBeNull();
  });
});

// Shortcuts, links, settings, the XFA banner

// Chip 7 question 1, ruled option A on 2026-09-20. PDF.js holds a text box that is still
// being typed, and a drawing in progress, outside its change store. Every decision that
// reads dirty must commit that work first, or a close or a save silently loses it.

describe("SessionManager pending editor work", () => {
  /** One open tab whose viewer looks clean but holds uncommitted work. */
  async function openPending() {
    const env = setup();
    await env.manager.start();
    await env.manager.openRefs([A]);
    const viewer = env.viewers[0];
    viewer.pendingEdit = true;
    viewer.nextExport = { mode: "append", bytes: APPENDED };
    return { ...env, viewer, id: env.tab(0).id };
  }

  it("closing a tab commits first, so the work is not lost without a word", async () => {
    const { manager, dialogs, viewer, id, tab, snap } = await openPending();
    expect(tab(0).dirty).toBe(false);
    dialogs.answer("cancel");
    expect(await manager.closeTab(id)).toBe(false);
    expect(dialogs.asked).toEqual([asked(closeDirtyDialog("a.pdf"))]);
    expect(viewer.commitCount).toBe(1);
    expect(snap().tabs).toHaveLength(1);
    expect(tab(0).dirty).toBe(true);
  });

  it("a clean tab still closes without a dialog", async () => {
    const { manager, viewers, snap } = setup();
    await manager.start();
    await manager.openRefs([A]);
    expect(await manager.closeTab(snap().tabs[0].id)).toBe(true);
    expect(viewers[0].commitCount).toBe(1);
    expect(snap().tabs).toEqual([]);
  });

  it("closing the window commits every tab, not only the ones already dirty", async () => {
    const { manager, dialogs, viewers } = setup();
    await manager.start();
    for (const ref of [A, B, C]) await manager.openRefs([ref]);
    viewers[2].pendingEdit = true;
    dialogs.answer("discard");
    expect(await manager.confirmCloseAll()).toBe(true);
    expect(dialogs.asked.map((a) => a.title)).toEqual(["Save changes to c.pdf?"]);
    expect(viewers.map((v) => v.commitCount)).toEqual([1, 1, 1]);
  });

  it("saving commits first, so the open text box reaches the file", async () => {
    const { manager, files, dialogs, viewer, id, tab } = await openPending();
    dialogs.answer("overwrite");
    expect(await manager.save(id)).toBe(true);
    expect(viewer.commitCount).toBe(1);
    expect(files.writes).toEqual([{ ref: A, bytes: APPENDED, options: { keepBackup: false } }]);
    expect(tab(0).dirty).toBe(false);
  });

  it("Save As commits first too", async () => {
    const { manager, files, viewer, id } = await openPending();
    files.queueSaveTarget(B);
    expect(await manager.saveAs(id)).toBe(true);
    expect(viewer.commitCount).toBe(1);
    expect(files.writes.map((w) => w.ref)).toEqual([B]);
  });
});

// Spec 13.3: running an engine operation

const ENGINE_BYTES = new TextEncoder().encode("%PDF-1.7 rotated by the engine");
const ROTATE: EngineOp = { kind: "pages.rotate", pages: "all", degrees: 90 };

/** Records what it was asked to do. It never looks at the bytes it is given. */
class FakeEngine implements EngineAdapter {
  readonly name = "fake";
  readonly runs: { op: EngineOp; bytes: Uint8Array }[] = [];
  result: EngineResult | Error = { bytes: ENGINE_BYTES, mode: "rewrite" };

  capabilities(): ReadonlySet<Capability> {
    return new Set<Capability>(["pages.rotate", "flatten"]);
  }

  async run(op: EngineOp, bytes: Uint8Array): Promise<EngineResult> {
    this.runs.push({ op, bytes: bytes.slice() });
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

describe("SessionManager runOp (spec 13.3)", () => {
  /** One ready tab, one engine that can rotate and flatten, and no viewer changes yet. */
  async function openWithEngine(files: [FileRef, Uint8Array?][] = [[A], [B]]) {
    const engine = new FakeEngine();
    const engines = new EngineRegistry();
    engines.register(engine);
    const env = setup({ files, engines });
    await env.manager.start();
    await env.manager.openRefs([A]);
    return { ...env, engine, viewer: env.viewers[0], id: env.tab(0).id };
  }

  it("a successful operation marks the tab dirty and reloads the viewer once", async () => {
    const { manager, engine, viewer, id, tab } = await openWithEngine();
    viewer.viewState = { page: 3, scale: "page-width", rotation: 90 };
    expect(await manager.runOp(id, ROTATE)).toBe(true);
    expect(engine.runs.map((r) => r.op)).toEqual([ROTATE]);
    expect(tab(0).dirty).toBe(true);
    expect(viewer.loads).toHaveLength(2);
    expect(viewer.loads[1]).toEqual({
      bytes: ENGINE_BYTES, filename: "a.pdf", view: { page: 3, scale: "page-width", rotation: 90 },
    });
  });

  it("the engine reads the bytes the tab holds", async () => {
    const { manager, engine, id } = await openWithEngine();
    await manager.runOp(id, ROTATE);
    expect(engine.runs[0].bytes).toEqual(PLAIN);
  });

  it("saving afterwards writes the engine's bytes as a rewrite and clears the flag", async () => {
    const { manager, files, dialogs, viewer, id, tab } = await openWithEngine();
    await manager.runOp(id, ROTATE);
    dialogs.answer("overwrite");
    expect(await manager.save(id)).toBe(true);
    expect(files.writes).toEqual([{ ref: A, bytes: ENGINE_BYTES, options: { keepBackup: false } }]);
    expect(tab(0).dirty).toBe(false);
    // A rewrite reloads the viewer after the write. An append would not.
    expect(viewer.loads).toHaveLength(3);
    expect(viewer.loads[2].bytes).toEqual(ENGINE_BYTES);

    // The flag is gone, so a second save has nothing to write.
    expect(await manager.save(id)).toBe(true);
    expect(files.writes).toHaveLength(1);
  });

  it("commits and exports pending form edits into the bytes the engine receives", async () => {
    const { manager, engine, viewer, id } = await openWithEngine();
    viewer.pendingEdit = true;
    viewer.nextExport = { mode: "append", bytes: APPENDED };
    expect(await manager.runOp(id, ROTATE)).toBe(true);
    expect(viewer.commitCount).toBe(1);
    expect(engine.runs[0].bytes).toEqual(APPENDED);
  });

  it("asks before changing a signed file, and Cancel runs nothing", async () => {
    const { manager, dialogs, engine, viewer, id, tab } = await openWithEngine([[A, SIGNED]]);
    dialogs.answer("cancel");
    expect(await manager.runOp(id, ROTATE)).toBe(false);
    expect(dialogs.asked).toEqual([asked(OPERATION_GUARD_DIALOG)]);
    expect(engine.runs).toEqual([]);
    expect(tab(0).dirty).toBe(false);
    expect(viewer.loads).toHaveLength(1);
  });

  it("Continue anyway runs the operation, and the later save does not ask again", async () => {
    const { manager, files, dialogs, engine, id } = await openWithEngine([[A, SIGNED]]);
    dialogs.answer("continue");
    expect(await manager.runOp(id, ROTATE)).toBe(true);
    expect(dialogs.asked).toEqual([asked(OPERATION_GUARD_DIALOG)]);
    expect(engine.runs).toHaveLength(1);

    dialogs.answer("overwrite");
    expect(await manager.save(id)).toBe(true);
    expect(dialogs.asked.map((a) => a.title)).toEqual([
      OPERATION_GUARD_DIALOG.title, firstSaveDialog("a.pdf").title,
    ]);
    expect(files.writes.map((w) => w.bytes)).toEqual([ENGINE_BYTES]);
  });

  it("an unsigned file is never guarded", async () => {
    const { manager, dialogs, id } = await openWithEngine();
    expect(await manager.runOp(id, ROTATE)).toBe(true);
    expect(dialogs.asked).toEqual([]);
  });

  it("an encrypted file shows its own dialog and leaves the bytes alone", async () => {
    const { manager, files, dialogs, engine, viewer, id, tab } = await openWithEngine();
    viewer.setDirty(true);
    viewer.nextExport = { mode: "append", bytes: APPENDED };
    engine.result = new EngineError("encrypted", "password-protected");
    dialogs.answer("ok");
    expect(await manager.runOp(id, ROTATE)).toBe(false);
    expect(dialogs.asked).toEqual([asked(ENCRYPTED_DIALOG)]);
    expect(viewer.loads).toHaveLength(1);
    expect(tab(0).dirty).toBe(true);

    // The tab still holds exactly the bytes the engine was handed.
    dialogs.answer("overwrite");
    expect(await manager.save(id)).toBe(true);
    expect(files.writes.map((w) => w.bytes)).toEqual([engine.runs[0].bytes]);
  });

  it("any other engine failure shows the general dialog and leaves the bytes alone", async () => {
    const { manager, files, dialogs, engine, viewer, id } = await openWithEngine();
    viewer.setDirty(true);
    viewer.nextExport = { mode: "append", bytes: APPENDED };
    engine.result = new EngineError("failed", "page 9 is not in this document");
    dialogs.answer("ok");
    expect(await manager.runOp(id, ROTATE)).toBe(false);
    expect(dialogs.asked).toEqual([asked(OPERATION_FAILED_DIALOG)]);

    dialogs.answer("overwrite");
    expect(await manager.save(id)).toBe(true);
    expect(files.writes.map((w) => w.bytes)).toEqual([engine.runs[0].bytes]);
  });

  it("a failing export shows the save error and runs nothing", async () => {
    const { manager, dialogs, engine, viewer, id } = await openWithEngine();
    viewer.nextExport = new Error("Export broke");
    dialogs.answer("ok");
    expect(await manager.runOp(id, ROTATE)).toBe(false);
    expect(dialogs.asked).toEqual([{ title: SAVE_FAILED_TITLE, body: "Export broke", buttons: ["ok"] }]);
    expect(engine.runs).toEqual([]);
  });

  it("a capability no adapter has returns false and asks nothing", async () => {
    const { manager, dialogs, engine, id, tab } = await openWithEngine();
    const insert: EngineOp = { kind: "pages.insertPdf", other: PLAIN };
    expect(await manager.runOp(id, insert)).toBe(false);
    expect(engine.runs).toEqual([]);
    expect(dialogs.asked).toEqual([]);
    expect(tab(0).dirty).toBe(false);
  });

  it("a manager with no engine registry returns false", async () => {
    const { manager, tab } = setup();
    await manager.start();
    await manager.openRefs([A]);
    expect(await manager.runOp(tab(0).id, ROTATE)).toBe(false);
    expect(tab(0).dirty).toBe(false);
  });

  it("a tab that is not ready returns false", async () => {
    const engines = new EngineRegistry();
    engines.register(new FakeEngine());
    const { manager, files, tab } = setup({ engines });
    await files.saveState("session", savedSession([A, "C:\\gone\\x.pdf"], 0));
    await manager.start();
    expect(await manager.runOp(tab(1).id, ROTATE)).toBe(false);   // unloaded
    await manager.activate(tab(1).id);
    expect(tab(1).status).toBe("not-found");
    expect(await manager.runOp(tab(1).id, ROTATE)).toBe(false);
    expect(await manager.runOp("no-such-tab", ROTATE)).toBe(false);
  });

  it("a reload that fails leaves the tab in error, with the change still held", async () => {
    const { manager, viewer, id, tab } = await openWithEngine();
    viewer.loadError = "Broken PDF";
    expect(await manager.runOp(id, ROTATE)).toBe(true);
    expect(tab(0)).toMatchObject({ status: "error", errorMessage: "Broken PDF", dirty: true });
  });

  it("closing a tab changed by an operation asks Save, Discard, Cancel", async () => {
    const { manager, dialogs, id, snap } = await openWithEngine();
    await manager.runOp(id, ROTATE);
    dialogs.answer("cancel");
    expect(await manager.closeTab(id)).toBe(false);
    expect(dialogs.asked).toEqual([asked(closeDirtyDialog("a.pdf"))]);
    expect(snap().tabs).toHaveLength(1);

    dialogs.answer("discard");
    expect(await manager.closeTab(id)).toBe(true);
    expect(snap().tabs).toEqual([]);
  });
});

describe("SessionManager shortcuts (spec 11.6)", () => {
  it("nextTab and prevTab wrap around", async () => {
    const { manager, active } = setup();
    await manager.start();
    await manager.openRefs([A, B, C]);
    await manager.handleShortcut("nextTab");
    expect(active()?.ref).toBe(A);
    await manager.handleShortcut("prevTab");
    expect(active()?.ref).toBe(C);
    await manager.handleShortcut("prevTab");
    expect(active()?.ref).toBe(B);
  });

  it("handleShortcut('save') saves the active tab", async () => {
    const { manager, files, dialogs } = await openDirty();
    dialogs.answer("overwrite");
    await manager.handleShortcut("save");
    expect(files.writes).toHaveLength(1);
  });

  it("saveAs and closeTab act on the active tab", async () => {
    const { manager, files, snap } = setup();
    await manager.start();
    await manager.openRefs([A]);
    files.queueSaveTarget("C:\\docs\\copy.pdf");
    await manager.handleShortcut("saveAs");
    expect(files.writes.map((w) => w.ref)).toEqual(["C:\\docs\\copy.pdf"]);
    await manager.handleShortcut("closeTab");
    expect(snap().tabs).toEqual([]);
  });

  it("with no active tab only open does anything", async () => {
    const { manager, files, snap } = setup();
    await manager.start();
    for (const name of ["save", "saveAs", "closeTab", "nextTab", "prevTab"] as const) {
      await manager.handleShortcut(name);
    }
    expect(snap()).toMatchObject({ tabs: [], activeTabId: null });
    files.queuePickFiles([A, B]);
    await manager.handleShortcut("open");
    expect(snap().tabs.map((t) => t.ref)).toEqual([A, B]);
  });

  it("the viewer's shortcut event reaches handleShortcut", async () => {
    const { manager, viewers, active } = setup();
    await manager.start();
    await manager.openRefs([A, B]);
    viewers[0].emit("shortcut", "nextTab");
    await vi.waitFor(() => expect(active()?.ref).toBe(A));
  });
});

describe("SessionManager external links (spec 12.8)", () => {
  const LINK = "https://example.com/terms?x=1";

  it("Open calls openExternal", async () => {
    const { manager, files, dialogs, viewers } = setup();
    await manager.start();
    await manager.openRefs([A]);
    dialogs.answer("open");
    viewers[0].emit("externallink", LINK);
    await vi.waitFor(() => expect(files.opened).toEqual([LINK]));
    expect(dialogs.asked).toEqual([asked(externalLinkDialog(LINK))]);
  });

  it("Cancel does not", async () => {
    const { manager, files, dialogs, viewers } = setup();
    await manager.start();
    await manager.openRefs([A]);
    dialogs.answer("cancel");
    viewers[0].emit("externallink", LINK);
    await vi.waitFor(() => expect(dialogs.asked).toHaveLength(1));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(files.opened).toEqual([]);
  });
});

describe("SessionManager settings and the XFA banner", () => {
  it("updateSettings saves at once and getSettings is stable between updates", async () => {
    const { manager, files } = setup();
    await manager.start();
    const settings = manager.getSettings();
    expect(settings).toEqual({ version: 1, restoreSession: true, keepBackup: false });
    expect(manager.getSettings()).toBe(settings);
    manager.updateSettings({ restoreSession: false });
    expect(await files.loadState("settings")).toEqual({ version: 1, restoreSession: false, keepBackup: false });
    expect(manager.getSettings()).not.toBe(settings);
  });

  it("an XFA file sets isXfa, and dismissXfaBanner hides it for that tab", async () => {
    const { manager, tab } = setup({ viewer: (v) => { v.docInfo = { pageCount: 2, isXfa: true }; } });
    await manager.start();
    await manager.openRefs([A]);
    expect(tab(0)).toMatchObject({ isXfa: true, xfaBannerDismissed: false });
    manager.dismissXfaBanner(tab(0).id);
    expect(tab(0).xfaBannerDismissed).toBe(true);
  });
});

describe("SessionManager print", () => {
  it("prints the tab's viewer only when the tab is ready", async () => {
    const { manager, viewers, snap } = setup({ files: [[A]] });
    await manager.start();
    await manager.openRefs([A, B]);
    const [a, b] = snap().tabs;
    expect(b.status).toBe("not-found");
    manager.print(b.id);
    manager.print("no-such-tab");
    expect(viewers).toHaveLength(0);
    await manager.activate(a.id);
    manager.print(a.id);
    expect(viewers[0].printCount).toBe(1);
  });
});
