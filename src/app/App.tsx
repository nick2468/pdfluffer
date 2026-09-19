// Throwaway spike page for plan P0.10 and P0.11. Chip 3 deletes it.

import { useEffect, useRef, useState } from "react";
import { PdfJsViewer } from "../viewer/PdfJsViewer";
import type { DocInfo, ViewState } from "../viewer/Viewer";

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PdfJsViewer | null>(null);
  const loadedRef = useRef<{ bytes: Uint8Array; name: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState<DocInfo | null>(null);
  const [view, setView] = useState<ViewState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [exportText, setExportText] = useState("");
  const [exported, setExported] = useState<Uint8Array | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewer = new PdfJsViewer();
    viewerRef.current = viewer;
    const offs = [
      viewer.on("viewchange", setView),
      viewer.on("dirtychange", setDirty),
    ];
    viewer.mount(container).then(
      () => setReady(true),
      (err: Error) => console.info("Spike mount ended:", err.message),
    );
    return () => {
      offs.forEach((off) => off());
      viewer.destroy();
      viewerRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); }, [downloadUrl]);

  async function load(bytes: Uint8Array, name: string, state: ViewState | null) {
    const viewer = viewerRef.current;
    if (!viewer) return;
    loadedRef.current = { bytes, name };
    try {
      setInfo(await viewer.load(bytes, name, state));
    } catch (err) {
      setExportText(`Load failed: ${(err as Error).message}`);
    }
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await load(new Uint8Array(await file.arrayBuffer()), file.name, null);
    event.target.value = "";
  }

  async function onExport() {
    const viewer = viewerRef.current;
    const loaded = loadedRef.current;
    if (!viewer || !loaded) return;
    try {
      const result = await viewer.exportBytes();
      if (result.mode === "none") {
        setExportText("mode none");
        return;
      }
      const differs = !sameBytes(result.bytes, loaded.bytes);
      setExportText(`mode ${result.mode}, ${result.bytes.length} bytes, differs from loaded: ${differs}`);
      setExported(result.bytes);
      setDownloadUrl(URL.createObjectURL(new Blob([result.bytes.slice()], { type: "application/pdf" })));
    } catch (err) {
      setExportText(`Export failed: ${(err as Error).message}`);
    }
  }

  async function onReload() {
    const viewer = viewerRef.current;
    const loaded = loadedRef.current;
    if (!viewer || !loaded || !exported) return;
    await load(exported, loaded.name, viewer.getViewState());
  }

  return (
    <main style={{ display: "flex", flexDirection: "column", height: "100vh", margin: 0 }}>
      <div style={{ padding: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input type="file" accept=".pdf" onChange={onFile} disabled={!ready} />
        <button onClick={onExport} disabled={!info}>Export</button>
        <button onClick={onReload} disabled={!exported}>Reload from export</button>
        {downloadUrl && <a href={downloadUrl} download="export.pdf">Download export</a>}
      </div>
      <div id="spike-status" style={{ padding: "0 6px 6px", fontFamily: "monospace", fontSize: 12 }}>
        ready: {String(ready)} | pages: {info?.pageCount ?? "-"} | isXfa: {info ? String(info.isXfa) : "-"}
        {" | "}view: {view ? `${view.page} / ${view.scale} / ${view.rotation}` : "-"}
        {" | "}dirty: {String(dirty)} | export: {exportText || "-"}
      </div>
      <div ref={containerRef} style={{ position: "relative", flex: 1 }} />
    </main>
  );
}

export default App;
