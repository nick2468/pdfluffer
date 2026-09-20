import { describe, expect, it } from "vitest";
import type { Capability, EngineAdapter, EngineResult } from "./EngineAdapter";
import { EngineRegistry } from "./engineRegistry";

/** The five capability names spec 13.1 reserves for engines that do not exist yet. */
const RESERVED: Capability[] = ['text.edit', 'redact', 'ocr', 'sign.verify', 'sign.certificate'];

function adapter(name: string, ...capabilities: Capability[]): EngineAdapter {
  return {
    name,
    capabilities: () => new Set(capabilities),
    run: (): Promise<EngineResult> => Promise.reject(new Error("not called")),
  };
}

describe("EngineRegistry", () => {
  it("finds nothing while no adapter is registered", () => {
    const engines = new EngineRegistry();
    expect(engines.findAdapter('flatten')).toBeNull();
    expect(engines.has(['flatten'])).toBe(false);
  });

  it("gives the first registered adapter that has the capability", () => {
    const engines = new EngineRegistry();
    const first = adapter("first", 'pages.rotate', 'flatten');
    const second = adapter("second", 'flatten', 'pages.insertPdf');
    engines.register(first);
    engines.register(second);
    expect(engines.findAdapter('flatten')).toBe(first);
    expect(engines.findAdapter('pages.rotate')).toBe(first);
    expect(engines.findAdapter('pages.insertPdf')).toBe(second);
  });

  it("skips an adapter that does not have the capability", () => {
    const engines = new EngineRegistry();
    engines.register(adapter("empty"));
    const real = adapter("real", 'flatten');
    engines.register(real);
    expect(engines.findAdapter('flatten')).toBe(real);
  });

  it("has() needs every capability, and an empty list needs none", () => {
    const engines = new EngineRegistry();
    engines.register(adapter("pdf-lib", 'pages.rotate', 'flatten'));
    expect(engines.has([])).toBe(true);
    expect(engines.has(['flatten'])).toBe(true);
    expect(engines.has(['pages.rotate', 'flatten'])).toBe(true);
    expect(engines.has(['pages.rotate', 'ocr'])).toBe(false);
  });

  it("matches none of the five reserved capability names", () => {
    const engines = new EngineRegistry();
    engines.register(adapter("pdf-lib", 'pages.insertPdf', 'pages.rotate', 'flatten'));
    for (const capability of RESERVED) {
      expect(engines.findAdapter(capability)).toBeNull();
      expect(engines.has([capability])).toBe(false);
    }
  });

  it("keeps one registry clear of another", () => {
    const a = new EngineRegistry();
    const b = new EngineRegistry();
    a.register(adapter("only-a", 'flatten'));
    expect(b.findAdapter('flatten')).toBeNull();
  });
});
