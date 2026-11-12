import { describe, expect, it } from "vitest";
import { aboutDialog, BUTTON, LICENCES } from "./dialogTexts";

describe("About and Licences (spec 11.5, 22.3)", () => {
  it("About offers Licences beside OK", () => {
    const about = aboutDialog("0.2.0", "6.3.289");
    expect(about.buttons).toEqual([BUTTON.licences, BUTTON.ok]);
    expect(BUTTON.licences.label).toBe("Licences");
    expect(about.body).toBe("Version 0.2.0\nPDF.js 6.3.289\nNo ads. No account. No network.");
  });

  it("the Licences dialog reads the notices from the app's own origin, with the chip's words", () => {
    expect(LICENCES.url).toBe("./licences.txt");
    expect(LICENCES.loading).toBe("Loading the licences...");
    expect(LICENCES.failed).toBe("PDFluffer could not load its licence notices.");
  });
});
