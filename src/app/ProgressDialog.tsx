// Spec 20.5. A long job's dialog: a title, one line that changes, and Cancel. It is modal,
// like ChoiceDialog, so the viewer iframes are inert while it shows and the document cannot
// change under the job. Cancel does not close it at once: the job finishes the step it is on,
// then closes it, and until then the dialog says it is stopping.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useServices } from "./services";

export default function ProgressDialog() {
  const { dialogs } = useServices();
  const current = useSyncExternalStore(dialogs.subscribe, dialogs.currentProgress);
  const ref = useRef<HTMLDialogElement>(null);
  const shown = current !== null;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (shown && !el.open) el.showModal();
    if (!shown && el.open) el.close();
  }, [shown]);

  return (
    <dialog
      ref={ref}
      className="choice-dialog"
      aria-labelledby="progress-dialog-title"
      aria-describedby="progress-dialog-text"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        dialogs.cancelProgress();
      }}
      onCancel={(e) => {
        // The job closes this dialog, never the browser.
        e.preventDefault();
        dialogs.cancelProgress();
      }}
    >
      {current && (
        <form method="dialog" onSubmit={(e) => e.preventDefault()}>
          <h2 id="progress-dialog-title">{current.title}</h2>
          <p id="progress-dialog-text" className="dialog-body" role="status" aria-live="polite">
            {current.cancelling ? "Stopping..." : current.text}
          </p>
          <div className="dialog-buttons">
            <button type="button" disabled={current.cancelling} onClick={() => dialogs.cancelProgress()}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
