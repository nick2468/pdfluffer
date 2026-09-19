import { describe, expect, it } from "vitest";
import { BUTTON } from "../session/dialogTexts";
import { DialogService, escapeId } from "./dialogService";

describe("DialogService", () => {
  it("shows one dialog at a time, in order, and resolves each with its answer", async () => {
    const dialogs = new DialogService();
    let notified = 0;
    dialogs.subscribe(() => notified++);
    expect(dialogs.current()).toBeNull();

    const first = dialogs.ask("One", "", [BUTTON.ok]);
    const second = dialogs.ask("Two", "", [BUTTON.open, BUTTON.cancel]);
    expect(notified).toBe(1);
    const shown = dialogs.current();
    expect(shown?.title).toBe("One");
    expect(dialogs.current()).toBe(shown);

    dialogs.answer("ok");
    expect(await first).toBe("ok");
    expect(dialogs.current()?.title).toBe("Two");
    dialogs.answer("cancel");
    expect(await second).toBe("cancel");
    expect(dialogs.current()).toBeNull();
    expect(notified).toBe(3);
  });

  it("ignores an answer with nothing on screen", () => {
    const dialogs = new DialogService();
    dialogs.answer("ok");
    expect(dialogs.current()).toBeNull();
  });
});

describe("escapeId", () => {
  it("is cancel when that button exists, otherwise the last button", () => {
    expect(escapeId([BUTTON.save, BUTTON.discard, BUTTON.cancel])).toBe("cancel");
    expect(escapeId([BUTTON.cancel, BUTTON.open])).toBe("cancel");
    expect(escapeId([BUTTON.ok])).toBe("ok");
    expect(escapeId([BUTTON.overwrite, BUTTON.saveAs])).toBe("saveAs");
  });
});
