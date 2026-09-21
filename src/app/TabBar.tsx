// Spec 11.2, the tab bar: one tab per open file, the + button, Save and the app menu.

import { useEffect, useRef } from "react";
import type { TabSnapshot } from "../session/DocumentSession";
import AppMenu from "./AppMenu";
import { useServices } from "./services";

const SIGNED_TOOLTIP =
  "This PDF carries a digital signature. A change that rewrites the file will break it. PDFluffer warns you first.";

export default function TabBar(props: {
  tabs: TabSnapshot[];
  activeTabId: string | null;
  onSettings: () => void;
  onSavedSignatures: () => void;
}) {
  const { manager } = useServices();
  const active = props.tabs.find((t) => t.id === props.activeTabId);

  return (
    <header className="tabbar">
      <div className="tabs" role="tablist" aria-label="Open files">
        {props.tabs.map((tab) => (
          <Tab key={tab.id} tab={tab} active={tab.id === props.activeTabId} />
        ))}
        <button
          type="button"
          className="tab-add"
          title="Open a PDF (Ctrl+O)"
          aria-label="Open a PDF"
          onClick={() => void manager.openWithDialog()}
        >
          +
        </button>
      </div>
      <button
        type="button"
        className="save-button"
        disabled={!active?.dirty}
        title="Save (Ctrl+S)"
        onClick={() => { if (active) void manager.save(active.id); }}
      >
        Save
      </button>
      <AppMenu active={active} onSettings={props.onSettings} onSavedSignatures={props.onSavedSignatures} />
    </header>
  );
}

function Tab({ tab, active }: { tab: TabSnapshot; active: boolean }) {
  const { manager, files } = useServices();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <div
      ref={ref}
      role="tab"
      tabIndex={0}
      aria-selected={active}
      className={active ? "tab active" : "tab"}
      title={files.describe(tab.ref)}
      onClick={() => void manager.activate(tab.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void manager.activate(tab.id);
        }
      }}
      // Middle-click closes. Stopping mousedown on the middle button stops the scroll cursor.
      onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        void manager.closeTab(tab.id);
      }}
    >
      <span className="tab-name">{tab.name}</span>
      {tab.dirty && <span className="tab-dirty" role="img" aria-label="Unsaved changes" title="Unsaved changes" />}
      {tab.hasDigitalSignature && <span className="tab-signed" title={SIGNED_TOOLTIP}>Signed</span>}
      <button
        type="button"
        className="tab-close"
        title="Close tab (Ctrl+W)"
        aria-label={`Close ${tab.name}`}
        onClick={(e) => {
          e.stopPropagation();
          void manager.closeTab(tab.id);
        }}
      >
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M1 1 9 9M9 1 1 9" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
    </div>
  );
}
