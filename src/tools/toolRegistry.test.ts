import { describe, expect, it } from "vitest";
import type { Capability, EngineAdapter, EngineResult } from "../engine/EngineAdapter";
import { EngineRegistry } from "../engine/engineRegistry";
import { ToolRegistry, type Tool } from "./toolRegistry";

function adapter(name: string, ...capabilities: Capability[]): EngineAdapter {
  return {
    name,
    capabilities: () => new Set(capabilities),
    run: (): Promise<EngineResult> => Promise.reject(new Error("not called")),
  };
}

function tool(id: string, ...needs: Capability[]): Tool {
  return { id, label: id, needs, run: () => Promise.reject(new Error("not called")) };
}

function withPdfLib(): EngineRegistry {
  const engines = new EngineRegistry();
  engines.register(adapter("pdf-lib", 'pages.insertPdf', 'pages.rotate', 'flatten'));
  return engines;
}

const ids = (tools: Tool[]) => tools.map((t) => t.id);

describe("ToolRegistry", () => {
  it("lists nothing while no tool is registered", () => {
    expect(new ToolRegistry().available(withPdfLib())).toEqual([]);
  });

  it("leaves out a tool whose capability no adapter has", () => {
    const tools = new ToolRegistry();
    tools.register(tool("flatten", 'flatten'));
    tools.register(tool("ocr", 'ocr'));
    tools.register(tool("rotateAndRedact", 'pages.rotate', 'redact'));
    expect(ids(tools.available(withPdfLib()))).toEqual(["flatten"]);
  });

  it("keeps registration order, not capability order", () => {
    const tools = new ToolRegistry();
    tools.register(tool("third", 'flatten'));
    tools.register(tool("first", 'pages.insertPdf'));
    tools.register(tool("second", 'pages.rotate'));
    expect(ids(tools.available(withPdfLib()))).toEqual(["third", "first", "second"]);
  });

  it("always lists a tool that needs nothing", () => {
    const tools = new ToolRegistry();
    tools.register(tool("about"));
    expect(ids(tools.available(new EngineRegistry()))).toEqual(["about"]);
  });

  it("lists nothing that needs an engine when no engine is registered", () => {
    const tools = new ToolRegistry();
    tools.register(tool("flatten", 'flatten'));
    expect(tools.available(new EngineRegistry())).toEqual([]);
  });
});
