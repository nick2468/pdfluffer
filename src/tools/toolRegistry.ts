// The tools the Document submenu offers (spec 13.2). A tool is a small script over the
// session, the files and the dialogs. Chip 9 registers the first ones; this file only holds
// the list and the rule that hides a tool no engine can serve.

import type { Capability } from "../engine/EngineAdapter";
import type { EngineRegistry } from "../engine/engineRegistry";
import type { FileAdapter } from "../files/FileAdapter";
import type { Dialogs } from "../session/dialogTexts";
import type { SessionManager } from "../session/SessionManager";

export interface ToolContext {
  tabId: string;
  session: SessionManager;
  files: FileAdapter;
  dialogs: Dialogs;
}

export interface Tool {
  id: string;
  label: string;
  needs: Capability[];
  run(ctx: ToolContext): Promise<void>;
}

export class ToolRegistry {
  private readonly tools: Tool[] = [];

  register(tool: Tool): void {
    this.tools.push(tool);
  }

  /** In registration order, the tools whose every capability some adapter has. */
  available(engines: EngineRegistry): Tool[] {
    return this.tools.filter((tool) => engines.has(tool.needs));
  }
}
