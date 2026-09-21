// Spec 11.8, the Saved signatures dialog. PDF.js names a saved signature when it is created
// and never again, so this is the one place a name can be changed.
//
// It knows nothing about PDF.js: it holds a SavedSignatureStore over localStorage, and every
// open viewer redraws its own list from the browser's storage event.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_SIGNATURE_NAME, SavedSignatureStore, type SavedSignature,
} from "../viewer/savedSignatures";

const INTRO =
  "Each name appears on its button in the signature tool. Renaming one does not change a " +
  "signature already placed in a document. The list is in the same order as the signature tool.";

const EMPTY =
  "No saved signatures yet. Create one with the signature tool inside a PDF, and leave " +
  "Save signature ticked.";

const UNREADABLE = "PDFluffer cannot read the saved signatures, so it has changed nothing.";

const RENAME_FAILED = "That name could not be saved.";

export default function SavedSignaturesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const store = useMemo(() => new SavedSignatureStore(window.localStorage), []);
  // Null means the stored value is not a shape PDFluffer knows.
  const [list, setList] = useState<SavedSignature[] | null>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [failedFor, setFailedFor] = useState<string | null>(null);

  // The list is read once, as the dialog opens. A signature added in a viewer while it is
  // open does not appear, and rename re-reads the storage anyway, so nothing is lost.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      const current = store.list();
      setList(current);
      setNames(Object.fromEntries((current ?? []).map((item) => [item.uuid, item.description])));
      setFailedFor(null);
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open, store]);

  const rename = (signature: SavedSignature): void => {
    const name = (names[signature.uuid] ?? "").trim();
    if (!name || name === signature.description) return;
    if (!store.rename(signature.uuid, name)) {
      setFailedFor(signature.uuid);
      return;
    }
    setFailedFor(null);
    setNames((old) => ({ ...old, [signature.uuid]: name }));
    setList((old) => old?.map((item) =>
      item.uuid === signature.uuid ? { ...item, description: name } : item) ?? old);
  };

  return (
    <dialog ref={ref} className="choice-dialog signatures-dialog" aria-labelledby="signatures-title"
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        onClose();
      }}
    >
      <form method="dialog" onSubmit={(e) => e.preventDefault()}>
        <h2 id="signatures-title">Saved signatures</h2>
        <p className="dialog-body">{INTRO}</p>
        {list === null && <p className="signature-note">{UNREADABLE}</p>}
        {list !== null && list.length === 0 && <p className="signature-note">{EMPTY}</p>}
        {list?.map((signature, index) => {
          const typed = names[signature.uuid] ?? "";
          const unchanged = typed.trim() === signature.description;
          return (
            <div key={signature.uuid} className="signature-row">
              <span className="signature-number" aria-hidden="true">{index + 1}</span>
              <input
                type="text"
                className="signature-name"
                value={typed}
                maxLength={MAX_SIGNATURE_NAME}
                aria-label={`Name of signature ${index + 1}`}
                onChange={(e) => setNames((old) => ({ ...old, [signature.uuid]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  rename(signature);
                }}
              />
              <button type="button" disabled={!typed.trim() || unchanged} onClick={() => rename(signature)}>
                Rename
              </button>
              {failedFor === signature.uuid && <p className="signature-error">{RENAME_FAILED}</p>}
            </div>
          );
        })}
        <div className="dialog-buttons">
          <button type="button" className="primary" onClick={onClose}>Close</button>
        </div>
      </form>
    </dialog>
  );
}
