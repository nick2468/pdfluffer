// The session manager (spec 8.5, section 12). A plain TypeScript class. React reads it
// through useSession(), built on useSyncExternalStore, so getSnapshot() must return the same
// object until something changes.

import { EngineError, type EngineAdapter, type EngineOp } from "../engine/EngineAdapter";
import type { EngineRegistry } from "../engine/engineRegistry";
import { FileError, type FileAdapter, type FileRef } from "../files/FileAdapter";
import { hasDigitalSignature } from "../util/hasDigitalSignature";
import type { ShortcutName, Viewer } from "../viewer/Viewer";
import { askToSave, confirmCloseAll, neighbourAfterClose } from "./closeFlow";
import {
  BUTTON, ENCRYPTED_DIALOG, externalLinkDialog, OPEN_ELSEWHERE_DIALOG, OPERATION_FAILED_DIALOG,
  OPERATION_GUARD_DIALOG, REVERT_DIALOG, revertFailedDialog, saveFailedDialog,
  type DialogText, type Dialogs,
} from "./dialogTexts";
import { DocumentSession, type TabSnapshot } from "./DocumentSession";
import { messageOf, saveTab, saveTabAs, type SaveContext } from "./saveFlow";
import {
  createDebouncedSaver, parseHistory, parseSession, parseSettings, recentItems,
  setHistoryView, touchHistory, viewFor,
  type DebouncedSaver, type HistoryItem, type HistoryStateV1, type SessionStateV1, type SettingsV1,
} from "./state";

export type { DialogButton, Dialogs } from "./dialogTexts";

export interface SessionSnapshot {
  tabs: TabSnapshot[];
  activeTabId: string | null;
  /** The first 15 history items, for the Recent menu. */
  recent: HistoryStateV1['items'];
  settings: SettingsV1;
}

export interface SessionManagerOptions {
  now?: () => string;
  newId?: () => string;
  /** Phase 2. Without it `runOp` finds no adapter and changes nothing. */
  engines?: EngineRegistry;
}

const APP_NAME = "PDFluffer";

export class SessionManager {
  private tabs: DocumentSession[] = [];
  private activeTabId: string | null = null;
  private listeners = new Set<() => void>();

  private settings: SettingsV1 = parseSettings(null);
  private history: HistoryItem[] = [];
  private recent: HistoryItem[] | null = null;
  private snapshot: SessionSnapshot = { tabs: [], activeTabId: null, recent: [], settings: this.settings };
  private sessionSaver: DebouncedSaver<SessionStateV1>;
  private historySaver: DebouncedSaver<HistoryStateV1>;
  private lastSessionJson: string | null = null;
  private lastTitle: string | null = null;

  private host: HTMLElement | null = null;
  private hostWaiters: (() => void)[] = [];

  private readonly now: () => string;
  private readonly newId: () => string;
  private readonly engines: EngineRegistry | null;

  constructor(
    private readonly files: FileAdapter,
    private readonly createViewer: () => Viewer,
    private readonly dialogs: Dialogs,
    options: SessionManagerOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.engines = options.engines ?? null;
    this.sessionSaver = createDebouncedSaver<SessionStateV1>(files, "session");
    this.historySaver = createDebouncedSaver<HistoryStateV1>(files, "history");
  }

  // Store

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  // Start (spec 12.6)

  async start(): Promise<void> {
    this.settings = parseSettings(await this.loadState("settings"));
    this.history = parseHistory(await this.loadState("history")).items;
    const session = parseSession(await this.loadState("session"));

    this.files.onOpenRequest((refs) => { void this.openRefs(refs); });

    if (this.settings.restoreSession) {
      for (const saved of session.tabs) {
        if (this.findByRef(saved.ref)) continue;
        this.tabs.push(new DocumentSession(saved.id, saved.ref, saved.name, saved.saveConfirmed));
      }
    }
    this.publish();

    const pending = await this.takePending();
    if (pending.length > 0) {
      await this.openRefs(pending);
      return;
    }
    // An open request that arrived while start() waited has already chosen the active tab.
    if (this.activeTabId !== null) return;
    const saved = this.settings.restoreSession ? this.find(session.activeTabId) : undefined;
    const first = saved ?? this.tabs[0];
    if (first) await this.activate(first.id);
  }

  // Opening (spec 12.1)

  async openRefs(refs: FileRef[]): Promise<void> {
    if (refs.length === 0) return;
    let last: DocumentSession | undefined;
    let history = this.history;
    for (const ref of refs) {
      let tab = this.findByRef(ref);
      if (!tab) {
        tab = new DocumentSession(this.newId(), ref, this.files.nameOf(ref), false);
        this.tabs.push(tab);
      }
      history = touchHistory(history, tab.ref, tab.name, this.now(), this.sameFile);
      last = tab;
    }
    this.setHistory(history);
    this.publish();
    if (last) await this.activate(last.id);
  }

  async openWithDialog(): Promise<void> {
    let refs: FileRef[];
    try {
      refs = await this.files.pickFiles();
    } catch (err) {
      console.warn("Could not show the Open dialog:", err);
      return;
    }
    await this.openRefs(refs);
  }

  // Activating and lazy loading (spec 12.2)

  async activate(tabId: string): Promise<void> {
    const tab = this.find(tabId);
    if (!tab) return;
    if (this.activeTabId !== tabId) {
      this.find(this.activeTabId)?.viewer?.setVisible(false);
      this.activeTabId = tabId;
      this.publish();
    }
    if (tab.status === 'unloaded') {
      tab.loading ??= this.load(tab).finally(() => { tab.loading = null; });
    }
    if (tab.loading) await tab.loading;
    this.showIfActive(tab);
  }

  setViewerHost(el: HTMLElement | null): void {
    this.host = el;
    if (!el) return;
    const waiters = this.hostWaiters;
    this.hostWaiters = [];
    for (const wake of waiters) wake();
  }

  private async load(tab: DocumentSession): Promise<void> {
    tab.status = 'loading';
    tab.errorMessage = null;
    this.publish();

    let bytes: Uint8Array;
    try {
      bytes = (await this.files.readFile(tab.ref)).bytes;
    } catch (err) {
      if (!this.has(tab)) return;
      if (err instanceof FileError && err.code === 'not-found') {
        tab.status = 'not-found';
      } else {
        tab.status = 'error';
        tab.errorMessage = messageOf(err);
      }
      this.publish();
      return;
    }
    if (!this.has(tab)) return;
    tab.bytes = bytes;
    tab.hasDigitalSignature = hasDigitalSignature(bytes);

    const host = await this.waitForHost();
    if (!this.has(tab)) return;

    const viewer = this.createViewer();
    tab.viewer = viewer;
    this.listen(tab, viewer);
    try {
      await viewer.mount(host);
      if (!this.has(tab)) return;
      const info = await viewer.load(bytes, tab.name, viewFor(this.history, tab.ref, this.sameFile));
      if (!this.has(tab)) return;
      tab.isXfa = info.isXfa;
      tab.viewerDirty = viewer.hasChanges();
      tab.status = 'ready';
    } catch (err) {
      if (!this.has(tab)) return;
      tab.dropViewer();
      tab.status = 'error';
      tab.errorMessage = messageOf(err);
    }
    this.publish();
  }

  private waitForHost(): Promise<HTMLElement> {
    if (this.host) return Promise.resolve(this.host);
    return new Promise((resolve) => {
      this.hostWaiters.push(() => resolve(this.host as HTMLElement));
    });
  }

  /** Only the tab that is active at this moment is shown and focused. */
  private showIfActive(tab: DocumentSession): void {
    if (!tab.viewer || tab.status !== 'ready') return;
    const active = this.activeTabId === tab.id;
    tab.viewer.setVisible(active);
    if (active) tab.viewer.focus();
  }

  private listen(tab: DocumentSession, viewer: Viewer): void {
    tab.unsubscribe.push(
      viewer.on("dirtychange", (dirty) => {
        tab.viewerDirty = dirty;
        this.publish();
      }),
      viewer.on("viewchange", (view) => {
        tab.view = view;
        this.setHistory(setHistoryView(this.history, tab.ref, view, this.sameFile));
        this.publish();
      }),
      viewer.on("shortcut", (name) => { void this.handleShortcut(name); }),
      viewer.on("externallink", (url) => { void this.confirmExternalLink(url); }),
      viewer.on("error", (message) => { console.error(`Viewer error in ${tab.name}:`, message); }),
    );
  }

  private async confirmExternalLink(url: string): Promise<void> {
    if (await this.ask(externalLinkDialog(url)) !== BUTTON.open.id) return;
    try {
      await this.files.openExternal(url);
    } catch (err) {
      console.warn("Could not open the link:", err);
    }
  }

  // Saving (spec 12.3, 12.4), in saveFlow.ts

  async save(tabId: string): Promise<boolean> {
    const tab = this.find(tabId);
    if (!tab) return false;
    this.commitPendingEdits(tab);
    return saveTab(this.saveContext(), tab);
  }

  async saveAs(tabId: string): Promise<boolean> {
    const tab = this.find(tabId);
    if (!tab) return false;
    this.commitPendingEdits(tab);
    return saveTabAs(this.saveContext(), tab);
  }

  /**
   * Spec 8.3. The viewer holds an open text box or drawing outside its change store, so
   * every decision that reads `dirty` commits first. Losing that work is worse than a
   * dialog the user did not expect.
   */
  private commitPendingEdits(tab: DocumentSession): void {
    const viewer = tab.viewer;
    if (!viewer || tab.status !== 'ready') return;
    viewer.commitPendingEdits();
    const dirty = viewer.hasChanges();
    if (dirty === tab.viewerDirty) return;
    tab.viewerDirty = dirty;
    this.publish();
  }

  private saveContext(): SaveContext {
    return {
      files: this.files,
      keepBackup: this.settings.keepBackup,
      ask: (text) => this.ask(text),
      has: (tab) => this.has(tab),
      openElsewhere: (tab, ref) => {
        const other = this.findByRef(ref);
        return other !== undefined && other !== tab;
      },
      publish: () => this.publish(),
      touchHistory: (tab) => {
        this.setHistory(touchHistory(this.history, tab.ref, tab.name, this.now(), this.sameFile));
        this.publish();
      },
    };
  }

  // Running an engine operation (spec 13.3)

  /**
   * The page the tab is showing, 1-based, for a tool that works on one page (spec 13.5).
   * Null when the tab is not ready, so the tool does nothing rather than guessing.
   */
  currentPage(tabId: string): number | null {
    const tab = this.find(tabId);
    if (!tab || tab.status !== 'ready') return null;
    // The stored view state, which lags by one event at most, then the viewer's own. A tab
    // that has never fired viewchange still has a page, and it is the one on screen.
    return tab.view?.page ?? tab.viewer?.getViewState().page ?? null;
  }

  /**
   * Runs one document operation over the tab's bytes. True when the document changed.
   * Nothing reaches disk: the tab goes dirty and the user saves when they choose to.
   * A user-level failure shows a dialog and returns false. It never rejects.
   */
  async runOp(tabId: string, op: EngineOp): Promise<boolean> {
    const tab = this.find(tabId);
    if (!tab || tab.status !== 'ready' || !tab.viewer || tab.busy) return false;

    // Before any dialog: an operation no engine can run must not nag the user first.
    const adapter = this.engines?.findAdapter(op.kind) ?? null;
    if (!adapter) {
      console.warn(`No engine can run ${op.kind}. The document is unchanged.`);
      return false;
    }
    tab.busy = true;
    try {
      return await this.runOpOnce(tab, adapter, op);
    } finally {
      tab.busy = false;
    }
  }

  private async runOpOnce(tab: DocumentSession, adapter: EngineAdapter, op: EngineOp): Promise<boolean> {
    this.commitPendingEdits(tab);
    if (tab.hasDigitalSignature && !tab.rewriteAcknowledged) {
      const choice = await this.ask(OPERATION_GUARD_DIALOG);
      if (choice !== BUTTON.continue.id || !this.has(tab)) return false;
      tab.rewriteAcknowledged = true;
    }

    // Export first (spec 13.3 step 2), so form values the user typed are in the bytes the
    // engine reads. Whatever comes back is held as a rewrite until a save puts it on disk.
    const viewer = tab.viewer;
    if (!viewer) return false;
    let exported;
    try {
      exported = await viewer.exportBytes();
    } catch (err) {
      await this.ask(saveFailedDialog(messageOf(err)));
      return false;
    }
    if (!this.has(tab)) return false;
    if (exported.mode !== 'none') {
      tab.bytes = exported.bytes;
      tab.unsavedMode = 'rewrite';
      this.publish();
    }

    // The adapter gets a copy, so a failed run cannot leave the tab's own bytes changed.
    let result;
    try {
      result = await adapter.run(op, (tab.bytes ?? new Uint8Array()).slice());
    } catch (err) {
      const encrypted = err instanceof EngineError && err.code === 'encrypted';
      console.warn(`${adapter.name} could not run ${op.kind}:`, err);
      await this.ask(encrypted ? ENCRYPTED_DIALOG : OPERATION_FAILED_DIALOG);
      return false;
    }
    if (!this.has(tab)) return false;

    tab.bytes = result.bytes;
    tab.pendingEngineChanges = true;   // makes the tab dirty, and makes the next save a rewrite
    tab.hasDigitalSignature = hasDigitalSignature(result.bytes);
    this.publish();
    await this.reload(tab, viewer);
    return true;
  }

  /** Shows the changed bytes. The bytes are already the tab's, so a failure only loses the view. */
  private async reload(tab: DocumentSession, viewer: Viewer): Promise<void> {
    if (tab.viewer !== viewer || !tab.bytes) return;
    try {
      const info = await viewer.load(tab.bytes, tab.name, viewer.getViewState());
      if (!this.has(tab) || tab.viewer !== viewer) return;
      tab.isXfa = info.isXfa;
      tab.viewerDirty = viewer.hasChanges();
    } catch (err) {
      if (!this.has(tab) || tab.viewer !== viewer) return;
      tab.dropViewer();
      tab.status = 'error';
      tab.errorMessage = messageOf(err);
    }
    this.publish();
  }

  // Revert (spec 13.6)

  /**
   * Throws away every change since the last save and reads the file again. The tab ends
   * clean, on the same page. `saveConfirmed` is kept: the user already said Overwrite for
   * this file, and reverting is not a reason to ask again.
   */
  async revert(tabId: string): Promise<void> {
    const tab = this.find(tabId);
    if (!tab || tab.status !== 'ready' || !tab.viewer || tab.busy) return;
    if (await this.ask(REVERT_DIALOG) !== BUTTON.continue.id || !this.has(tab)) return;

    tab.busy = true;
    try {
      let bytes: Uint8Array;
      try {
        bytes = (await this.files.readFile(tab.ref)).bytes;
      } catch (err) {
        await this.ask(revertFailedDialog(messageOf(err)));
        return;
      }
      const viewer = tab.viewer;
      if (!this.has(tab) || !viewer) return;
      tab.bytes = bytes;
      tab.pendingEngineChanges = false;
      tab.unsavedMode = null;
      tab.rewriteAcknowledged = false;
      tab.hasDigitalSignature = hasDigitalSignature(bytes);
      this.publish();
      await this.reload(tab, viewer);
    } finally {
      tab.busy = false;
    }
  }

  // Closing (spec 12.5), in closeFlow.ts

  async closeTab(tabId: string): Promise<boolean> {
    const tab = this.find(tabId);
    if (!tab) return true;
    this.commitPendingEdits(tab);
    if (tab.dirty && !(await this.askToSave(tab))) return false;
    if (!this.has(tab)) return true;

    const index = this.tabs.indexOf(tab);
    tab.dropViewer();
    this.tabs.splice(index, 1);
    if (this.activeTabId !== tab.id) {
      this.publish();
      return true;
    }
    const neighbour = neighbourAfterClose(this.tabs, index);
    this.activeTabId = null;
    this.publish();
    if (neighbour) await this.activate(neighbour.id);
    return true;
  }

  async confirmCloseAll(): Promise<boolean> {
    const ok = await confirmCloseAll({
      tabs: () => this.tabs,
      has: (tab) => this.has(tab),
      commitPendingEdits: (tab) => this.commitPendingEdits(tab),
      activate: (tab) => this.activate(tab.id),
      askToSave: (tab) => this.askToSave(tab),
      flush: async () => {
        await Promise.all([this.flush(this.sessionSaver, "session"), this.flush(this.historySaver, "history")]);
      },
    });
    // Chip 6 ruling: no modified PDF.js frame may be alive when the window goes, or PDF.js
    // raises its own "Leave site?" prompt. Removing an iframe does not raise it.
    if (ok) for (const tab of this.tabs) tab.dropViewer();
    return ok;
  }

  private askToSave(tab: DocumentSession): Promise<boolean> {
    return askToSave((text) => this.ask(text), tab, () => this.save(tab.id));
  }

  private async flush(saver: DebouncedSaver<unknown>, key: string): Promise<void> {
    try {
      await saver.flush();
    } catch (err) {
      console.warn(`Could not save ${key} state:`, err);
    }
  }

  // Locate (spec 12.6)

  async locate(tabId: string): Promise<void> {
    const tab = this.find(tabId);
    if (!tab || tab.status !== 'not-found') return;
    let refs: FileRef[];
    try {
      refs = await this.files.pickFiles();
    } catch (err) {
      console.warn("Could not show the Open dialog:", err);
      return;
    }
    const ref = refs[0];
    if (ref === undefined || !this.has(tab)) return;
    const other = this.findByRef(ref);
    if (other && other !== tab) {
      await this.ask(OPEN_ELSEWHERE_DIALOG);
      return;
    }
    tab.ref = ref;
    tab.name = this.files.nameOf(ref);
    tab.status = 'unloaded';
    tab.saveConfirmed = false;
    this.setHistory(touchHistory(this.history, ref, tab.name, this.now(), this.sameFile));
    this.publish();
    await this.activate(tab.id);
  }

  // Shortcuts (spec 11.6)

  async handleShortcut(name: ShortcutName): Promise<void> {
    if (name === 'open') return this.openWithDialog();
    const active = this.activeTabId;
    if (active === null) return;
    switch (name) {
      case 'save': await this.save(active); return;
      case 'saveAs': await this.saveAs(active); return;
      case 'closeTab': await this.closeTab(active); return;
      case 'nextTab': return this.step(active, 1);
      case 'prevTab': return this.step(active, -1);
    }
  }

  private async step(activeId: string, by: 1 | -1): Promise<void> {
    const n = this.tabs.length;
    const index = this.tabs.findIndex((t) => t.id === activeId);
    if (index < 0 || n < 2) return;
    await this.activate(this.tabs[(index + by + n) % n].id);
  }

  // Small state

  /** The app menu's Print item. PDF.js shows its own print routine. */
  print(tabId: string): void {
    const tab = this.find(tabId);
    if (tab?.status === 'ready') tab.viewer?.print();
  }

  dismissXfaBanner(tabId: string): void {
    const tab = this.find(tabId);
    if (!tab) return;
    tab.xfaBannerDismissed = true;
    this.publish();
  }

  getSettings(): SettingsV1 {
    return this.settings;
  }

  updateSettings(patch: Partial<Omit<SettingsV1, 'version'>>): void {
    this.settings = { ...this.settings, ...patch, version: 1 };
    this.publish();
    this.files.saveState("settings", this.settings)
      .catch((err: unknown) => console.warn("Could not save settings state:", err));
  }

  /** The first 15 history items. The same array until the history changes. */
  getRecent(): HistoryStateV1['items'] {
    this.recent ??= recentItems(this.history);
    return this.recent;
  }

  clearHistory(): void {
    this.setHistory([]);
    this.publish();
  }

  // Internals

  /**
   * Sets the window title, then builds the snapshot. Only when the snapshot changed does it
   * notify listeners and feed the session saver. The title check runs first so the first
   * call, with no tabs, still sets "PDFluffer".
   */
  private publish(): void {
    this.updateTitle();
    const tabs = this.tabs.map((t) => t.snapshot());
    const recent = this.getRecent();
    const old = this.snapshot;
    const same = old.activeTabId === this.activeTabId
      && old.recent === recent
      && old.settings === this.settings
      && old.tabs.length === tabs.length
      && old.tabs.every((t, i) => t === tabs[i]);
    if (same) return;
    this.snapshot = { tabs, activeTabId: this.activeTabId, recent, settings: this.settings };

    const state: SessionStateV1 = {
      version: 1,
      tabs: this.tabs.map((t) => ({ id: t.id, ref: t.ref, name: t.name, saveConfirmed: t.saveConfirmed })),
      activeTabId: this.activeTabId,
    };
    const json = JSON.stringify(state);
    if (json !== this.lastSessionJson) {
      this.lastSessionJson = json;
      this.sessionSaver.set(state);
    }
    for (const listener of [...this.listeners]) listener();
  }

  /** Spec 11.7. */
  private updateTitle(): void {
    const active = this.find(this.activeTabId);
    const title = active ? `${active.name}${active.dirty ? " *" : ""} - ${APP_NAME}` : APP_NAME;
    if (title === this.lastTitle) return;
    this.lastTitle = title;
    this.files.setWindowTitle(title)
      .catch((err: unknown) => console.warn("Could not set the window title:", err));
  }

  private setHistory(items: HistoryItem[]): void {
    this.history = items;
    this.recent = null;
    this.historySaver.set({ version: 1, items });
  }

  private ask(text: DialogText): Promise<string> {
    return this.dialogs.ask(text.title, text.body, text.buttons);
  }

  private async loadState(key: string): Promise<unknown> {
    try {
      return await this.files.loadState<unknown>(key);
    } catch (err) {
      console.warn(`Could not load ${key} state:`, err);
      return null;
    }
  }

  private async takePending(): Promise<FileRef[]> {
    try {
      return await this.files.takePendingOpenRequests();
    } catch (err) {
      console.warn("Could not read the files to open:", err);
      return [];
    }
  }

  private readonly sameFile = (a: FileRef, b: FileRef): boolean => this.files.sameFile(a, b);

  private find(tabId: string | null): DocumentSession | undefined {
    return tabId === null ? undefined : this.tabs.find((t) => t.id === tabId);
  }

  private findByRef(ref: FileRef): DocumentSession | undefined {
    return this.tabs.find((t) => this.sameFile(t.ref, ref));
  }

  private has(tab: DocumentSession): boolean {
    return this.tabs.includes(tab);
  }
}
