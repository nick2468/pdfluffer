// One DocumentSession per tab (spec 8.4). It owns the bytes (D8).
// Pure TypeScript. Only SessionManager changes it.

import type { FileRef } from "../files/FileAdapter";
import type { Viewer, ViewState } from "../viewer/Viewer";

export type TabStatus = 'unloaded' | 'loading' | 'ready' | 'not-found' | 'error';

export interface TabSnapshot {
  id: string;                  // crypto.randomUUID()
  ref: FileRef;
  name: string;
  status: TabStatus;
  errorMessage: string | null;
  dirty: boolean;              // viewer has changes OR pendingEngineChanges
  hasDigitalSignature: boolean;
  isXfa: boolean;
  xfaBannerDismissed: boolean;
  saveConfirmed: boolean;      // D9: the user already chose Overwrite for this tab
}

export class DocumentSession {
  status: TabStatus = 'unloaded';
  errorMessage: string | null = null;
  viewerDirty = false;
  hasDigitalSignature = false;
  isXfa = false;
  xfaBannerDismissed = false;

  // The spec 8.4 private fields. They are public to TypeScript so SessionManager can reach
  // them, but no snapshot ever carries them.
  bytes: Uint8Array | null = null;
  viewer: Viewer | null = null;
  view: ViewState | null = null;
  pendingEngineChanges = false;
  rewriteAcknowledged = false;

  /** Set when an export succeeded but its bytes are not on disk yet (the user cancelled). */
  unsavedMode: 'append' | 'rewrite' | null = null;
  /** True while an engine operation or a revert is running on this tab (spec 13.3). */
  busy = false;
  /** The in-flight load, so a second activate does not load twice. */
  loading: Promise<void> | null = null;
  /** Unsubscribes the viewer's event listeners. */
  unsubscribe: (() => void)[] = [];

  private cached: TabSnapshot | null = null;

  constructor(readonly id: string, public ref: FileRef, public name: string, public saveConfirmed: boolean) {}

  get dirty(): boolean {
    return this.viewerDirty || this.pendingEngineChanges || this.unsavedMode !== null;
  }

  /** The same object until a field in it changes. */
  snapshot(): TabSnapshot {
    const next: TabSnapshot = {
      id: this.id,
      ref: this.ref,
      name: this.name,
      status: this.status,
      errorMessage: this.errorMessage,
      dirty: this.dirty,
      hasDigitalSignature: this.hasDigitalSignature,
      isXfa: this.isXfa,
      xfaBannerDismissed: this.xfaBannerDismissed,
      saveConfirmed: this.saveConfirmed,
    };
    const old = this.cached;
    if (old && (Object.keys(next) as (keyof TabSnapshot)[]).every((k) => old[k] === next[k])) return old;
    this.cached = next;
    return next;
  }

  /** Destroys the viewer, if any, and drops its listeners. */
  dropViewer(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.viewer?.destroy();
    this.viewer = null;
  }
}
