// Spec 11.5, the Settings dialog. Two checkboxes: reopen files at start, and keep a backup.

import { useEffect, useRef } from "react";
import { useServices, useSession } from "./services";

export default function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { manager } = useServices();
  const { settings } = useSession(manager);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog ref={ref} className="choice-dialog" aria-labelledby="settings-title" onClose={onClose}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        onClose();
      }}
    >
      <form method="dialog" onSubmit={(e) => e.preventDefault()}>
        <h2 id="settings-title">Settings</h2>
        <label className="setting">
          <input
            type="checkbox"
            checked={settings.restoreSession}
            onChange={(e) => manager.updateSettings({ restoreSession: e.target.checked })}
          />
          Reopen my files when PDFluffer starts
        </label>
        <label className="setting">
          <input
            type="checkbox"
            checked={settings.keepBackup}
            onChange={(e) => manager.updateSettings({ keepBackup: e.target.checked })}
          />
          Keep a backup of the original the first time I overwrite it
        </label>
        <div className="dialog-buttons">
          <button type="button" className="primary" onClick={onClose}>Close</button>
        </div>
      </form>
    </dialog>
  );
}
