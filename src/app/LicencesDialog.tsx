// Spec 22.3, the Licences dialog, opened from About. It shows public/licences.txt, fetched
// from the app's own origin (the CSP's connect-src 'self' allows it), in a scrolling
// monospace box. scripts/make-notices.mjs writes that file.

import { useEffect, useRef, useState } from "react";
import { LICENCES } from "../session/dialogTexts";

type Shown =
  | { kind: "loading" }
  | { kind: "loaded"; text: string }
  | { kind: "failed"; reason: string };

export default function LicencesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [shown, setShown] = useState<Shown>({ kind: "loading" });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!open) {
      if (el.open) el.close();
      return;
    }
    if (!el.open) el.showModal();
    // Fetched on every opening, so a failure is never remembered. Small, and from disk.
    let current = true;
    setShown({ kind: "loading" });
    (async () => {
      try {
        const response = await fetch(LICENCES.url);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
        const text = await response.text();
        if (current) setShown({ kind: "loaded", text });
      } catch (err) {
        if (current) setShown({ kind: "failed", reason: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => { current = false; };
  }, [open]);

  return (
    <dialog ref={ref} className="choice-dialog licences-dialog" aria-labelledby="licences-title"
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        onClose();
      }}
    >
      <form method="dialog" onSubmit={(e) => e.preventDefault()}>
        <h2 id="licences-title">{LICENCES.title}</h2>
        {shown.kind === "loading" && <p className="dialog-body">{LICENCES.loading}</p>}
        {shown.kind === "failed" && (
          <p className="dialog-body" role="alert">{LICENCES.failed}{"\n"}{shown.reason}</p>
        )}
        {shown.kind === "loaded" && (
          <pre className="licences-text" tabIndex={0} aria-label={LICENCES.title}>{shown.text}</pre>
        )}
        <div className="dialog-buttons">
          <button type="button" className="primary" onClick={onClose}>{LICENCES.close}</button>
        </div>
      </form>
    </dialog>
  );
}
