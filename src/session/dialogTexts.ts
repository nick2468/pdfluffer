// Every dialog the session manager shows, with the wording of spec 12.3, 12.4, 12.5 and 12.8.
// Tests and the UI share these, so a wording change happens in one place.

export interface DialogButton { id: string; label: string; kind?: "primary" | "danger"; }

/** A long job's dialog: one line of text that changes, and a Cancel button (spec 20.5). */
export interface Progress {
  update(text: string): void;
  /** True once the user chose Cancel. The job checks it and stops at a safe point. */
  readonly cancelled: boolean;
  close(): void;
}

export interface Dialogs {
  ask(title: string, body: string, buttons: DialogButton[]): Promise<string>; // returns id
  /** Shows at once and stays until close(). Modal, so the document cannot change meanwhile. */
  progress(title: string, text: string): Progress;
}

export interface DialogText { title: string; body: string; buttons: DialogButton[]; }

export const BUTTON = {
  overwrite: { id: "overwrite", label: "Overwrite", kind: "primary" },
  saveAs: { id: "saveAs", label: "Save As..." },
  cancel: { id: "cancel", label: "Cancel" },
  save: { id: "save", label: "Save", kind: "primary" },
  discard: { id: "discard", label: "Discard", kind: "danger" },
  continue: { id: "continue", label: "Continue anyway", kind: "danger" },
  saveCopy: { id: "saveCopy", label: "Save As a copy..." },
  open: { id: "open", label: "Open", kind: "primary" },
  ok: { id: "ok", label: "OK", kind: "primary" },
} as const satisfies Record<string, DialogButton>;

/** Spec 12.3, the first save of a tab. */
export function firstSaveDialog(name: string): DialogText {
  return {
    title: `Save changes to ${name}?`,
    body: "Overwrite replaces the original file. PDFluffer will not ask again for this file while its tab stays open.",
    buttons: [BUTTON.overwrite, BUTTON.saveAs, BUTTON.cancel],
  };
}

/** Spec 12.4, before a rewrite of a signed file reaches disk. */
export const SIGNATURE_GUARD_DIALOG: DialogText = {
  title: "This PDF is digitally signed",
  body: "This change rewrites the file. The digital signature will stop verifying.",
  buttons: [BUTTON.saveCopy, BUTTON.continue, BUTTON.cancel],
};

/**
 * Spec 13.3 step 1, before an engine operation rewrites a signed file. Same wording as the
 * save guard above, but "Save As a copy..." makes no sense before the change has happened.
 */
export const OPERATION_GUARD_DIALOG: DialogText = {
  title: SIGNATURE_GUARD_DIALOG.title,
  body: SIGNATURE_GUARD_DIALOG.body,
  buttons: [BUTTON.continue, BUTTON.cancel],
};

export const CANNOT_CHANGE_TITLE = "Cannot change this PDF";

/** Spec 13.3 step 3, the engine could not read the file. */
export const ENCRYPTED_DIALOG: DialogText = {
  title: CANNOT_CHANGE_TITLE,
  body: "This PDF is password-protected. PDFluffer cannot run this operation on it yet.",
  buttons: [BUTTON.ok],
};

/** Any other engine failure. The document is untouched, so the wording says so. */
export const OPERATION_FAILED_DIALOG: DialogText = {
  title: CANNOT_CHANGE_TITLE,
  body: "PDFluffer could not apply that change. The document is unchanged.",
  buttons: [BUTTON.ok],
};

/** Spec 12.5, closing a dirty tab. The spec gives no body. */
export function closeDirtyDialog(name: string): DialogText {
  return {
    title: `Save changes to ${name}?`,
    body: "",
    buttons: [BUTTON.save, BUTTON.discard, BUTTON.cancel],
  };
}

export const SAVE_FAILED_TITLE = "Could not save";

/** Spec 12.3 step 4, the file is locked by another program. */
export const LOCKED_DIALOG: DialogText = {
  title: SAVE_FAILED_TITLE,
  body: "Another program has this file open. Close it there, or use Save As.",
  buttons: [BUTTON.ok],
};

/** A failed export or write. The body is the error message. */
export function saveFailedDialog(message: string): DialogText {
  return { title: SAVE_FAILED_TITLE, body: message, buttons: [BUTTON.ok] };
}

/**
 * Spec 13.5, before Flatten bakes everything into the pages. The wording was rewritten on
 * 2026-09-21: the first user did not know the word flatten, so the dialog explains it and
 * the menu item keeps the name.
 */
export const FLATTEN_DIALOG: DialogText = {
  title: "Flatten this PDF?",
  body: "Flatten makes every filled-in answer, note and signature a permanent part of the page. Afterwards nobody can edit, move or remove them, including you. Use it before you send a signed form to someone. You can still use Revert to saved until you save.",
  buttons: [{ id: BUTTON.continue.id, label: "Flatten", kind: "danger" }, BUTTON.cancel],
};

/** Spec 13.6, before Revert throws away everything since the last save. */
export const REVERT_DIALOG: DialogText = {
  title: "Revert to saved?",
  body: "This discards every change since the last save.",
  buttons: [{ id: BUTTON.continue.id, label: "Revert", kind: "danger" }, BUTTON.cancel],
};

export const OPEN_FAILED_TITLE = "Could not open";

/** A file the Insert PDF tool could not read. The body is the error message. */
export function openFailedDialog(message: string): DialogText {
  return { title: OPEN_FAILED_TITLE, body: message, buttons: [BUTTON.ok] };
}

export const REVERT_FAILED_TITLE = "Could not revert";

/** Spec 13.6, re-reading the file failed. The document is left as it was. */
export function revertFailedDialog(message: string): DialogText {
  return { title: REVERT_FAILED_TITLE, body: message, buttons: [BUTTON.ok] };
}

// Spec 20.5, the OCR tool: "Make text selectable (OCR)...".

/** Every page already has text, so there is nothing for OCR to do. */
export const NOTHING_TO_READ_DIALOG: DialogText = {
  title: "Nothing to read",
  body: "Every page already has selectable text.",
  buttons: [BUTTON.ok],
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Before reading: how many pages need it. "1 of 1 page has", "2 of 3 pages have". */
export function ocrConfirmDialog(needed: number, total: number): DialogText {
  return {
    title: "Make text selectable?",
    body: `${needed} of ${plural(total, "page", "pages")} ${needed === 1 ? "has" : "have"} `
      + "no selectable text. PDFluffer will read "
      + `${needed === 1 ? "it" : "them"} and add an invisible text layer. The pages will look exactly `
      + "the same. This can take a few seconds a page.",
    buttons: [{ id: BUTTON.continue.id, label: "Make selectable", kind: "primary" }, BUTTON.cancel],
  };
}

export const OCR_PROGRESS_TITLE = "Reading the pages";

export function ocrProgressText(page: number, of: number): string {
  return `Reading page ${page} of ${of}...`;
}

/** After reading, with the text layer added. `language` is already a name a person reads. */
export function ocrDoneDialog(words: number, pages: number, language: string): DialogText {
  return {
    title: "Text added",
    body: `Added ${plural(words, "word", "words")} to ${plural(pages, "page", "pages")}, read as `
      + `${language}. Select some text to check it, then save.`,
    buttons: [BUTTON.ok],
  };
}

/** Pages were read, and none of them held printed text. Nothing is changed. */
export const OCR_NO_TEXT_DIALOG: DialogText = {
  title: "No text found",
  body: "PDFluffer found no printed text on those pages. Handwriting cannot be read.",
  buttons: [BUTTON.ok],
};

export const OCR_FAILED_TITLE = "Could not read the page";

/** One page could not be read. The run stops and nothing is changed. */
export function ocrFailedDialog(code: 'unavailable' | 'too-large' | 'failed', detail: string): DialogText {
  const why = {
    'unavailable': "Windows has no OCR language installed, so this computer cannot read pages.",
    'too-large': "The page is too large for Windows to read.",
    'failed': detail ? `Windows could not read the page. ${detail}` : "Windows could not read the page.",
  }[code];
  return { title: OCR_FAILED_TITLE, body: `${why} Nothing was changed.`, buttons: [BUTTON.ok] };
}

/** Spec 12.3, Save As onto a file that is open in another tab. */
export const OPEN_ELSEWHERE_DIALOG: DialogText = {
  title: "File is open elsewhere",
  body: "That file is open in another tab.",
  buttons: [BUTTON.ok],
};

/** Spec 12.8, the body is the full URL. */
export function externalLinkDialog(url: string): DialogText {
  return {
    title: "Open this link in your browser?",
    body: url,
    buttons: [BUTTON.open, BUTTON.cancel],
  };
}

/** Spec 11.5, the app menu's Clear history item. */
export const CLEAR_HISTORY_DIALOG: DialogText = {
  title: "Clear history?",
  body: "This empties the Recent list and forgets the page and zoom of every file. Open tabs stay open.",
  buttons: [{ id: BUTTON.ok.id, label: "Clear history", kind: "danger" }, BUTTON.cancel],
};

/** Spec 11.5, About PDFluffer. The body keeps its line breaks. */
export function aboutDialog(appVersion: string, pdfJsVersion: string): DialogText {
  return {
    title: "About PDFluffer",
    body: `Version ${appVersion}\nPDF.js ${pdfJsVersion}\nNo ads. No account. No network.`,
    buttons: [BUTTON.ok],
  };
}
