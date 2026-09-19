// Spec 11.1, the app frame: tab bar, banner row, and the one viewer host. The host is always
// rendered, so React never unmounts the viewer iframes. Panels (spec 11.4) sit on top of it.

import { useCallback, useEffect, useState } from "react";
import type { TabSnapshot } from "../session/DocumentSession";
import { isReloadKey, shortcutFor } from "../viewer/shortcutFor";
import ChoiceDialog from "./ChoiceDialog";
import SettingsDialog from "./SettingsDialog";
import TabBar from "./TabBar";
import { useServices, useSession } from "./services";

export default function App() {
  const { manager } = useServices();
  const { tabs, activeTabId } = useSession(manager);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const active = tabs.find((t) => t.id === activeTabId);

  const hostRef = useCallback((el: HTMLDivElement | null) => manager.setViewerHost(el), [manager]);

  // Spec 11.6: shortcuts while focus is in the frame. The viewer forwards its own (spec 9.6).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // An open modal dialog owns the keyboard. Ctrl+S there must not start a second save.
      if (document.querySelector("dialog[open]")) return;
      const name = shortcutFor(e);
      if (name) {
        e.preventDefault();
        void manager.handleShortcut(name);
      } else if (import.meta.env.PROD && isReloadKey(e)) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [manager]);

  const showBanner = active?.status === "ready" && active.isXfa && !active.xfaBannerDismissed;

  return (
    <div className="app">
      <TabBar tabs={tabs} activeTabId={activeTabId} onSettings={() => setSettingsOpen(true)} />
      {showBanner && (
        <div className="banner" role="status">
          <span>
            This is an XFA form. PDFluffer's support for XFA is partial. Check the saved file in
            another viewer before you send it.
          </span>
          <button type="button" onClick={() => manager.dismissXfaBanner(active.id)}>Dismiss</button>
        </div>
      )}
      <main className="stage">
        <div className="viewer-host" ref={hostRef} />
        <Panel tabs={tabs} active={active} />
      </main>
      <ChoiceDialog />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

/** Spec 11.4. Nothing when the active tab is ready, so its viewer shows. */
function Panel({ tabs, active }: { tabs: TabSnapshot[]; active: TabSnapshot | undefined }) {
  const { manager, files } = useServices();

  if (tabs.length === 0) return <EmptyState />;
  if (!active) return <div className="panel" />;
  switch (active.status) {
    case "ready":
      return null;
    case "unloaded":
    case "loading":
      return <div className="panel"><p className="panel-quiet">Opening {active.name}...</p></div>;
    case "not-found":
      return (
        <div className="panel">
          <h2>File not found</h2>
          <p className="panel-path">{files.describe(active.ref)}</p>
          <div className="panel-buttons">
            <button type="button" className="primary" onClick={() => void manager.locate(active.id)}>Locate...</button>
            <button type="button" onClick={() => void manager.closeTab(active.id)}>Close tab</button>
          </div>
        </div>
      );
    case "error":
      return (
        <div className="panel">
          <h2>PDFluffer could not open this file</h2>
          <p className="panel-path">{active.errorMessage}</p>
          <div className="panel-buttons">
            <button type="button" onClick={() => void manager.closeTab(active.id)}>Close tab</button>
          </div>
        </div>
      );
  }
}

function EmptyState() {
  const { manager, files } = useServices();
  const { recent } = useSession(manager);
  return (
    <div className="panel">
      <h1 className="empty-title">PDFluffer</h1>
      <button type="button" className="primary" onClick={() => void manager.openWithDialog()}>Open a PDF</button>
      {recent.length > 0 && (
        <section className="empty-recent" aria-label="Recent files">
          <h2>Recent</h2>
          <ul>
            {recent.map((item) => (
              <li key={item.ref}>
                <button type="button" className="link" title={files.describe(item.ref)} onClick={() => void manager.openRefs([item.ref])}>
                  {item.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
