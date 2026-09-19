// Spec 11.5. One reusable modal dialog. It shows the DialogService queue one question at a
// time. A modal <dialog> makes the viewer iframes inert while it is open, which is wanted.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { escapeId } from "./dialogService";
import { useServices } from "./services";

export default function ChoiceDialog() {
  const { dialogs } = useServices();
  const current = useSyncExternalStore(dialogs.subscribe, dialogs.current);
  const ref = useRef<HTMLDialogElement>(null);
  const defaultRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (current && !el.open) el.showModal();
    if (!current && el.open) el.close();
    if (current) defaultRef.current?.focus();
  }, [current]);

  const escape = current ? escapeId(current.buttons) : "cancel";
  // Focus the primary button. With none, focus the Escape button, never a danger button.
  const primary = current ? current.buttons.findIndex((b) => b.kind === "primary") : -1;
  const defaultIndex = primary >= 0 ? primary : current?.buttons.findIndex((b) => b.id === escape) ?? 0;

  return (
    <dialog
      ref={ref}
      className="choice-dialog"
      aria-labelledby="choice-dialog-title"
      onKeyDown={(e) => {
        // Escape is handled here rather than left to the browser's cancel event, which some
        // key paths never fire. Stopping the default also stops the browser closing it.
        if (e.key !== "Escape") return;
        e.preventDefault();
        dialogs.answer(escape);
      }}
      onCancel={(e) => {
        // Any other close request. Answer, and keep the element open for the next question.
        e.preventDefault();
        dialogs.answer(escape);
      }}
      onClose={() => {
        // The browser may close the dialog itself after repeated Escapes. Still answer.
        if (dialogs.current() === current && current) dialogs.answer(escape);
      }}
    >
      {current && (
        <form method="dialog" onSubmit={(e) => e.preventDefault()}>
          <h2 id="choice-dialog-title">{current.title}</h2>
          {current.body && <p className="dialog-body">{current.body}</p>}
          <div className="dialog-buttons">
            {current.buttons.map((button, i) => (
              <button
                key={button.id}
                type="button"
                ref={i === defaultIndex ? defaultRef : undefined}
                className={button.kind ?? ""}
                onClick={() => dialogs.answer(button.id)}
              >
                {button.label}
              </button>
            ))}
          </div>
        </form>
      )}
    </dialog>
  );
}
