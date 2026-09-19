// In-memory file adapter for unit tests only (spec 8.2).

import { FileError, type FileAdapter, type FileRef, type OpenedFile, type WriteOptions } from "./FileAdapter";

export interface FakeWrite { ref: FileRef; bytes: Uint8Array; options: WriteOptions; }

type FakeOp = "read" | "write";

export class FakeFileAdapter implements FileAdapter {
  private files = new Map<FileRef, { name: string; bytes: Uint8Array }>();
  private state = new Map<string, unknown>();
  private failures = new Map<string, FileError>();
  private pickQueue: FileRef[][] = [];
  private saveTargetQueue: (FileRef | null)[] = [];
  private pending: FileRef[] = [];
  private openListeners = new Set<(refs: FileRef[]) => void>();
  private closeHandler: (() => Promise<boolean>) | null = null;

  /** Every successful writeFile call, in order. */
  readonly writes: FakeWrite[] = [];
  /** Every setWindowTitle call, in order. */
  readonly titles: string[] = [];
  /** Every openExternal call, in order. */
  readonly opened: string[] = [];

  // Test helpers

  addFile(ref: FileRef, name: string, bytes: Uint8Array): void {
    this.files.set(ref, { name, bytes: bytes.slice() });
  }

  removeFile(ref: FileRef): void {
    this.files.delete(ref);
  }

  /** The next read or write of ref throws error, once. */
  failNext(op: FakeOp, ref: FileRef, error: FileError): void {
    this.failures.set(failureKey(op, ref), error);
  }

  /** The next pickFiles call returns refs. With nothing queued it returns []. */
  queuePickFiles(refs: FileRef[]): void {
    this.pickQueue.push([...refs]);
  }

  /** The next pickSaveTarget call returns ref. With nothing queued it returns null. */
  queueSaveTarget(ref: FileRef | null): void {
    this.saveTargetQueue.push(ref);
  }

  setPending(refs: FileRef[]): void {
    this.pending = [...refs];
  }

  emitOpenRequest(refs: FileRef[]): void {
    for (const listener of [...this.openListeners]) listener([...refs]);
  }

  /** Runs the registered close handler. Resolves true (close) if none is registered. */
  requestClose(): Promise<boolean> {
    return this.closeHandler ? this.closeHandler() : Promise.resolve(true);
  }

  // FileAdapter

  async pickFiles(): Promise<FileRef[]> {
    return this.pickQueue.shift() ?? [];
  }

  async readFile(ref: FileRef): Promise<OpenedFile> {
    this.throwIfFailing("read", ref);
    const file = this.files.get(ref);
    if (!file) throw new FileError("not-found", `File not found: ${ref}`);
    return { ref, name: file.name, bytes: file.bytes.slice() };
  }

  async writeFile(ref: FileRef, bytes: Uint8Array, options: WriteOptions): Promise<void> {
    this.throwIfFailing("write", ref);
    const name = this.files.get(ref)?.name ?? lastSegment(ref);
    this.files.set(ref, { name, bytes: bytes.slice() });
    this.writes.push({ ref, bytes: bytes.slice(), options: { ...options } });
  }

  async pickSaveTarget(_suggestedName: string, _near: FileRef | null): Promise<FileRef | null> {
    return this.saveTargetQueue.shift() ?? null;
  }

  nameOf(ref: FileRef): string {
    return this.files.get(ref)?.name ?? lastSegment(ref);
  }

  describe(ref: FileRef): string {
    return ref;
  }

  sameFile(a: FileRef, b: FileRef): boolean {
    return a.toLowerCase() === b.toLowerCase();
  }

  async takePendingOpenRequests(): Promise<FileRef[]> {
    const refs = this.pending;
    this.pending = [];
    return refs;
  }

  onOpenRequest(listener: (refs: FileRef[]) => void): () => void {
    this.openListeners.add(listener);
    return () => { this.openListeners.delete(listener); };
  }

  async loadState<T>(key: string): Promise<T | null> {
    return this.state.has(key) ? (structuredClone(this.state.get(key)) as T) : null;
  }

  async saveState<T>(key: string, value: T): Promise<void> {
    this.state.set(key, structuredClone(value));
  }

  onCloseRequested(handler: () => Promise<boolean>): () => void {
    this.closeHandler = handler;
    return () => { if (this.closeHandler === handler) this.closeHandler = null; };
  }

  async setWindowTitle(title: string): Promise<void> {
    this.titles.push(title);
  }

  async openExternal(url: string): Promise<void> {
    this.opened.push(url);
  }

  private throwIfFailing(op: FakeOp, ref: FileRef): void {
    const key = failureKey(op, ref);
    const error = this.failures.get(key);
    if (!error) return;
    this.failures.delete(key);
    throw error;
  }
}

function failureKey(op: FakeOp, ref: FileRef): string {
  return `${op}:${ref}`;
}

function lastSegment(ref: FileRef): string {
  const parts = ref.split(/[\\/]/);
  return parts[parts.length - 1] || ref;
}
