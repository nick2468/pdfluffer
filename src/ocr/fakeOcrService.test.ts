import { describe, expect, it } from "vitest";
import { FakeOcrService, fakeResult } from "./fakeOcrService";
import { OcrError } from "./OcrService";

const WORD = { text: "Hello", x: 10, y: 20, w: 40, h: 12 };

describe("FakeOcrService", () => {
  it("answers queued results in order and repeats the last one", async () => {
    const ocr = new FakeOcrService();
    ocr.results = [fakeResult([WORD]), fakeResult([{ ...WORD, text: "World" }])];
    expect((await ocr.recognise(new Uint8Array([1]))).lines[0].words[0].text).toBe("Hello");
    expect((await ocr.recognise(new Uint8Array([2]))).lines[0].words[0].text).toBe("World");
    // A test that hands it five pages should not have to queue five identical results.
    expect((await ocr.recognise(new Uint8Array([3]))).lines[0].words[0].text).toBe("World");
  });

  it("remembers every picture it was given, in order", async () => {
    const ocr = new FakeOcrService();
    ocr.results = [fakeResult([WORD])];
    await ocr.recognise(new Uint8Array([1, 2]));
    await ocr.recognise(new Uint8Array([3]));
    expect(ocr.seen).toEqual([new Uint8Array([1, 2]), new Uint8Array([3])]);
  });

  it("reports what it was told about the engine", async () => {
    const ocr = new FakeOcrService();
    expect(await ocr.status()).toEqual({ available: true, language: "en-GB", maxImageDimension: 4000 });
    ocr.available = false;
    expect(await ocr.status()).toEqual({ available: false, language: null, maxImageDimension: 4000 });
    expect(ocr.statusCalls).toBe(2);
  });

  it("throws unavailable when it has no engine", async () => {
    const ocr = new FakeOcrService();
    ocr.available = false;
    ocr.results = [fakeResult([WORD])];
    await expect(ocr.recognise(new Uint8Array([1]))).rejects.toMatchObject({ code: "unavailable" });
  });

  it("throws whatever failure it was told to", async () => {
    const ocr = new FakeOcrService();
    ocr.results = [fakeResult([WORD])];
    ocr.failWith = new OcrError("too-large", "Too big");
    await expect(ocr.recognise(new Uint8Array([1]))).rejects.toBe(ocr.failWith);
  });

  it("gives a whole result, with the page size and the angle", () => {
    expect(fakeResult([WORD], { textAngle: 1.5, width: 800 })).toEqual({
      language: "en-GB",
      width: 800,
      height: 1400,
      textAngle: 1.5,
      lines: [{ words: [WORD] }],
    });
  });
});
