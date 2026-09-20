// Which engine can do what (spec 13.1). A class, not a module global, so one test cannot
// leave adapters behind for the next one.

import type { Capability, EngineAdapter } from "./EngineAdapter";

export class EngineRegistry {
  private readonly adapters: EngineAdapter[] = [];

  register(adapter: EngineAdapter): void {
    this.adapters.push(adapter);
  }

  /** The first registered adapter that has the capability, else null. */
  findAdapter(capability: Capability): EngineAdapter | null {
    for (const adapter of this.adapters) {
      if (adapter.capabilities().has(capability)) return adapter;
    }
    return null;
  }

  /** True when some adapter has every one of these capabilities. */
  has(capabilities: Capability[]): boolean {
    return capabilities.every((capability) => this.findAdapter(capability) !== null);
  }
}
