// Creates the file adapter, the dialog service and the session manager once, outside React.

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { DialogService } from "./app/dialogService";
import { ServicesContext } from "./app/services";
import { EngineRegistry } from "./engine/engineRegistry";
import { PdfLibAdapter } from "./engine/pdfLibAdapter";
import { createFileAdapter } from "./files";
import { SessionManager } from "./session/SessionManager";
import { documentTools } from "./tools/documentTools";
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
  const tools = new ToolRegistry();
  for (const tool of documentTools) tools.register(tool);

  const manager = new SessionManager(files, () => new PdfJsViewer(), dialogs, { engines });
  files.onCloseRequested(() => manager.confirmCloseAll());

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ServicesContext.Provider value={{ files, dialogs, manager, engines, tools }}>
        <App />
      </ServicesContext.Provider>
    </React.StrictMode>,
  );
  await manager.start();
}

boot().catch((err: unknown) => console.error("PDFluffer could not start:", err));
