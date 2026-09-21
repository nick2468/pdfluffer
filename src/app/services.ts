// The objects main.tsx creates once, outside React, and the one hook that reads the manager.

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import type { EngineRegistry } from "../engine/engineRegistry";
import type { FileAdapter } from "../files/FileAdapter";
import type { OcrService } from "../ocr/OcrService";
import type { SessionManager, SessionSnapshot } from "../session/SessionManager";
import type { ToolRegistry } from "../tools/toolRegistry";
import type { DialogService } from "./dialogService";

export interface Services {
  files: FileAdapter;
  dialogs: DialogService;
  manager: SessionManager;
  /** Phase 2. The menu asks the tool registry which tools these engines can serve. */
  engines: EngineRegistry;
  tools: ToolRegistry;
  /** Phase 4. Null in the browser harness and on a PC with no OCR language (spec 20.4). */
  ocr: OcrService | null;
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("useServices needs a ServicesContext provider.");
  return services;
}

/** Spec 8.5. Re-renders when the manager publishes a new snapshot. */
export function useSession(manager: SessionManager): SessionSnapshot {
  const subscribe = useCallback((listener: () => void) => manager.subscribe(listener), [manager]);
  const getSnapshot = useCallback(() => manager.getSnapshot(), [manager]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
