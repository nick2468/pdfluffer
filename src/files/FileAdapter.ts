// The file adapter contract (spec 8.1). Only file adapters look inside a FileRef.

export type FileRef = string;

export interface OpenedFile {
  ref: FileRef;
  name: string;          // file name with extension, for the tab label
  bytes: Uint8Array;
}

export type FileErrorCode = 'not-found' | 'not-pdf' | 'locked' | 'io';

export class FileError extends Error {
  constructor(public code: FileErrorCode, message: string) { super(message); }
}

export interface WriteOptions { keepBackup: boolean; }

export interface FileAdapter {
  /** Show the Open dialog. Multi-select, PDF filter. Empty array if cancelled. */
  pickFiles(): Promise<FileRef[]>;
  /** Read a file. Throws FileError. */
  readFile(ref: FileRef): Promise<OpenedFile>;
  /** Write bytes over the file. Must be atomic (section 10.3). Throws FileError. */
  writeFile(ref: FileRef, bytes: Uint8Array, options: WriteOptions): Promise<void>;
  /** Show the Save As dialog. Null if cancelled. The result always ends in .pdf. */
  pickSaveTarget(suggestedName: string, near: FileRef | null): Promise<FileRef | null>;
  nameOf(ref: FileRef): string;        // "form.pdf"
  describe(ref: FileRef): string;      // full path, for tooltips
  sameFile(a: FileRef, b: FileRef): boolean;   // case-insensitive on Windows

  /** Files the operating system asked us to open at launch. Returns them once. */
  takePendingOpenRequests(): Promise<FileRef[]>;
  /** Files the OS asks us to open while running: second launch, drag and drop. */
  onOpenRequest(listener: (refs: FileRef[]) => void): () => void;

  loadState<T>(key: string): Promise<T | null>;
  saveState<T>(key: string, value: T): Promise<void>;

  /** Called when the user tries to close the window. Resolve false to keep it open. */
  onCloseRequested(handler: () => Promise<boolean>): () => void;
  setWindowTitle(title: string): Promise<void>;
  openExternal(url: string): Promise<void>;
}
