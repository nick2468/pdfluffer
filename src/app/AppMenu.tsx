// Spec 11.3, the app menu. A button with a popup list. Escape, a click outside, a click into
// the viewer, or choosing an item closes it. Recent and Document are nested lists, not hover
// submenus.

import { useEffect, useMemo, useRef, useState } from "react";
import { version as appVersion } from "../../package.json";
import { aboutDialog, BUTTON, CLEAR_HISTORY_DIALOG, type DialogText } from "../session/dialogTexts";
import type { TabSnapshot } from "../session/DocumentSession";
import { useServices, useSession } from "./services";

const PDFJS_VERSION = "6.3.289";

export default function AppMenu(
  { active, onSettings, onSavedSignatures }:
  { active: TabSnapshot | undefined; onSettings: () => void; onSavedSignatures: () => void },
) {
  const { manager, dialogs, files, engines, tools } = useServices();
  const { recent } = useSession(manager);
  // Spec 13.2: only the tools some engine can serve. The registries never change.
  const documentTools = useMemo(() => tools.available(engines), [tools, engines]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // A click into a viewer iframe never reaches this document. The window loses focus instead.
    const onBlur = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  const ready = active?.status === "ready";
  const ask = (text: DialogText) => dialogs.ask(text.title, text.body, text.buttons);
  const run = (action: () => unknown) => () => {
    setOpen(false);
    void action();
  };

  const clearHistory = async () => {
    if (await ask(CLEAR_HISTORY_DIALOG) === BUTTON.ok.id) manager.clearHistory();
  };

  return (
    <div className="app-menu" ref={rootRef}>
      <button
        type="button"
        className="menu-button"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Menu"
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div className="menu-list" role="menu" ref={listRef}>
          <Item label="Open..." keys="Ctrl+O" onClick={run(() => manager.openWithDialog())} />
          <div className="menu-heading" role="presentation">Recent</div>
          {recent.length === 0 ? (
            <div className="menu-empty" role="presentation">No recent files</div>
          ) : (
            recent.map((item) => (
              <button
                key={item.ref}
                type="button"
                role="menuitem"
                className="menu-item recent-item"
                title={files.describe(item.ref)}
                onClick={run(() => manager.openRefs([item.ref]))}
              >
                <span className="menu-label">{item.name}</span>
              </button>
            ))
          )}
          <hr />
          <Item label="Save" keys="Ctrl+S" disabled={!ready} onClick={run(() => active && manager.save(active.id))} />
          <Item label="Save As..." keys="Ctrl+Shift+S" disabled={!ready} onClick={run(() => active && manager.saveAs(active.id))} />
          <Item label="Print..." keys="Ctrl+P" disabled={!ready} onClick={run(() => active && manager.print(active.id))} />
          <Item label="Close tab" keys="Ctrl+W" disabled={!active} onClick={run(() => active && manager.closeTab(active.id))} />
          <hr />
          <div className="menu-heading" role="presentation">Document</div>
          {documentTools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              role="menuitem"
              className="menu-item nested-item"
              disabled={!ready}
              onClick={run(() => active && tool.run({ tabId: active.id, session: manager, files, dialogs }))}
            >
              <span className="menu-label">{tool.label}</span>
            </button>
          ))}
          <Item label="Revert to saved" disabled={!ready || !active?.dirty} onClick={run(() => active && manager.revert(active.id))} />
          <hr />
          <Item label="Saved signatures..." onClick={run(onSavedSignatures)} />
          <Item label="Settings..." onClick={run(onSettings)} />
          <Item label="Clear history..." onClick={run(clearHistory)} />
          <Item label="About PDFluffer" onClick={run(() => ask(aboutDialog(appVersion, PDFJS_VERSION)))} />
        </div>
      )}
    </div>
  );
}

function Item(props: { label: string; keys?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" className="menu-item" disabled={props.disabled} onClick={props.onClick}>
      <span className="menu-label">{props.label}</span>
      {props.keys && <span className="menu-keys">{props.keys}</span>}
    </button>
  );
}
