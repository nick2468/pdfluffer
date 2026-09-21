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

describe("DialogService progress (spec 20.5)", () => {
  it("shows at once with its title and text, and changes the text in place", () => {
    const dialogs = new DialogService();
    let notified = 0;
    dialogs.subscribe(() => notified++);
    expect(dialogs.currentProgress()).toBeNull();

    const progress = dialogs.progress("Reading the pages", "Reading page 1 of 3...");
    expect(dialogs.currentProgress()).toEqual({ title: "Reading the pages", text: "Reading page 1 of 3...", cancelling: false });
    const shown = dialogs.currentProgress();
    expect(dialogs.currentProgress()).toBe(shown);   // one object until it changes

    progress.update("Reading page 2 of 3...");
    expect(dialogs.currentProgress()?.text).toBe("Reading page 2 of 3...");
    expect(notified).toBe(2);

    progress.close();
    expect(dialogs.currentProgress()).toBeNull();
    expect(notified).toBe(3);
  });

  it("tells the job the user chose Cancel, and says it is stopping", () => {
    const dialogs = new DialogService();
    const progress = dialogs.progress("Reading the pages", "Reading page 1 of 3...");
    expect(progress.cancelled).toBe(false);
    dialogs.cancelProgress();
    expect(progress.cancelled).toBe(true);
    // The job finishes the page it is on, so the dialog stays until it closes, and says so.
    expect(dialogs.currentProgress()).toMatchObject({ cancelling: true });
    progress.update("Reading page 2 of 3...");
    expect(dialogs.currentProgress()?.text).toBe("Reading page 2 of 3...");
    expect(progress.cancelled).toBe(true);
    progress.close();
    expect(dialogs.currentProgress()).toBeNull();
  });

  it("does nothing once closed, and a closed one cannot touch the next", () => {
    const dialogs = new DialogService();
    const first = dialogs.progress("First", "one");
    first.close();
    const second = dialogs.progress("Second", "two");
    first.update("stale");
    first.close();
    expect(dialogs.currentProgress()).toMatchObject({ title: "Second", text: "two" });
    dialogs.cancelProgress();
    expect(first.cancelled).toBe(false);
    expect(second.cancelled).toBe(true);
    second.close();
  });

  it("ignores Cancel with no progress on screen", () => {
    const dialogs = new DialogService();
    dialogs.cancelProgress();
    expect(dialogs.currentProgress()).toBeNull();
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
