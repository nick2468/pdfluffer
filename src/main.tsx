// Creates the file adapter, the dialog service and the session manager once, outside React.

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { DialogService } from "./app/dialogService";
import { ServicesContext } from "./app/services";
import { EngineRegistry } from "./engine/engineRegistry";
import { PdfiumAdapter } from "./engine/pdfiumAdapter";
import { PdfLibAdapter } from "./engine/pdfLibAdapter";
import { createFileAdapter, testHookRequested } from "./files";
import { createOcrService } from "./ocr";
import type { OcrService } from "./ocr/OcrService";
import { SessionManager } from "./session/SessionManager";
import { documentTools } from "./tools/documentTools";
import { ocrTool } from "./tools/ocrTool";
import { ToolRegistry } from "./tools/toolRegistry";
import { PdfJsViewer } from "./viewer/PdfJsViewer";
import "./app/app.css";

async function boot(): Promise<void> {
  const files = await createFileAdapter();
  const dialogs = new DialogService();

  // Phase 2 (spec 13.1, 13.2). Registering the adapter costs nothing: it loads pdf-lib
  // itself, on the first operation.
  const engines = new EngineRegistry();
  engines.register(new PdfLibAdapter());
  // Phase 6 (spec 21). Registering it costs nothing either: PDFium and its .wasm load on the
  // first text edit. It reads Windows fonts through the file adapter, so it never imports one.
  // The editor dialog reaches it through the session manager (spec 21.5).
  engines.register(new PdfiumAdapter((fileName) => files.readSystemFont(fileName)));
  const tools = new ToolRegistry();
  for (const tool of documentTools) tools.register(tool);
  // Phase 4 (spec 20.4). Offered only where Windows can read pages: never in the browser
  // harness, and not on a PC with no OCR language installed.
  const ocr = await availableOcr();
  if (ocr) tools.register(ocrTool);

  const manager = new SessionManager(files, () => new PdfJsViewer(), dialogs, { engines });
  files.onCloseRequested(() => manager.confirmCloseAll());

  // The release-build probes call the engines from the page (chip 14, BUILD-NOTES decision
  // 26). Only in a development build, or when the app was launched with PDFLUFFER_TEST_HOOK.
  if (import.meta.env.MODE !== "production" || (await testHookRequested())) {
    (window as unknown as { __pdfluffer_test__: unknown }).__pdfluffer_test__ = { engines, manager };
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ServicesContext.Provider value={{ files, dialogs, manager, engines, tools, ocr }}>
        <App />
      </ServicesContext.Provider>
    </React.StrictMode>,
  );
  await manager.start();
}

/** The OCR service when it can read, else null. A failure only hides the tool. */
async function availableOcr(): Promise<OcrService | null> {
  const ocr = createOcrService();
  if (!ocr) return null;
  try {
    return (await ocr.status()).available ? ocr : null;
  } catch (err) {
    console.warn("OCR is not available:", err);
    return null;
  }
}

boot().catch((err: unknown) => console.error("PDFluffer could not start:", err));
