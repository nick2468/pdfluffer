// Creates the file adapter, the dialog service and the session manager once, outside React.

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { DialogService } from "./app/dialogService";
import { ServicesContext } from "./app/services";
import { createFileAdapter } from "./files";
import { SessionManager } from "./session/SessionManager";
import { PdfJsViewer } from "./viewer/PdfJsViewer";
import "./app/app.css";

async function boot(): Promise<void> {
  const files = await createFileAdapter();
  const dialogs = new DialogService();
  const manager = new SessionManager(files, () => new PdfJsViewer(), dialogs);
  files.onCloseRequested(() => manager.confirmCloseAll());

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ServicesContext.Provider value={{ files, dialogs, manager }}>
        <App />
      </ServicesContext.Provider>
    </React.StrictMode>,
  );
  await manager.start();
}

boot().catch((err: unknown) => console.error("PDFluffer could not start:", err));
