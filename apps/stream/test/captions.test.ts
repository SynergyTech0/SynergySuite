import { describe, expect, it } from "vitest";
import { cleanChapters, clock, normalizeCaptions, parseClock, parseCues, splitIntoCues, timedTranscript, transcriptText, vttTime } from "../lib/captions";

const SRT = `1
00:00:01,000 --> 00:00:04,000
Welcome to the <i>quarterly</i> update.

2
00:00:05,000 --> 00:00:09,500
Revenue grew &amp; costs fell.
Second line.
`;

describe("captions", () => {
  it("reads SubRip and WebVTT, dropping tags", () => {
    expect(parseCues(SRT)).toEqual([
      { start: 1, end: 4, text: "Welcome to the quarterly update." },
      { start: 5, end: 9.5, text: "Revenue grew & costs fell.\nSecond line." },
    ]);
    const vtt = "WEBVTT\n\nNOTE made by hand\n\n00:01.500 --> 00:03.000 align:start\n<v Ann>Hi there\n";
    expect(parseCues(vtt)).toEqual([{ start: 1.5, end: 3, text: "Hi there" }]);
  });

  it("writes clean WebVTT and refuses files with no cues", () => {
    const vtt = normalizeCaptions(SRT)!;
    expect(vtt.startsWith("WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nWelcome")).toBe(true);
    expect(vtt).toContain("Revenue grew &amp; costs fell.");
    expect(parseCues(vtt)).toEqual(parseCues(SRT));
    expect(normalizeCaptions("hello")).toBeNull();
    expect(normalizeCaptions("")).toBeNull();
  });

  it("makes a transcript", () => {
    expect(transcriptText(parseCues(SRT))).toBe("Welcome to the quarterly update. Revenue grew & costs fell. Second line.");
    expect(timedTranscript(parseCues(SRT))).toBe("[0:01] Welcome to the quarterly update.\n[0:05] Revenue grew & costs fell. Second line.\n");
  });

  it("formats and reads times", () => {
    expect(vttTime(3725.5)).toBe("01:02:05.500");
    expect(clock(75.9)).toBe("1:15");
    expect(clock(3725)).toBe("1:02:05");
    expect(parseClock("1:15")).toBe(75);
    expect(parseClock("01:02:05")).toBe(3725);
    expect(parseClock("90")).toBe(90);
    expect(parseClock("soon")).toBeNull();
  });

  it("shares recognised speech out over its piece of time", () => {
    const cues = splitIntoCues("One two three four. Five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen.", 30, 60);
    expect(cues.map((c) => c.text)).toEqual(["One two three four.", "Five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen."]);
    expect(cues[0].start).toBe(30);
    expect(cues[1].end).toBeLessThanOrEqual(60);
    expect(cues[1].start).toBeCloseTo(cues[0].end);
    expect(splitIntoCues("  ", 0, 30)).toEqual([]);
  });

  it("cleans chapters", () => {
    expect(
      cleanChapters([{ t: 90.7, title: " Demo " }, { t: 0, title: "Intro" }, { t: 90, title: "Again" }, { t: -1, title: "x" }, { t: 500, title: "After the end" }, { t: 5, title: "" }], 300),
    ).toEqual([{ t: 0, title: "Intro" }, { t: 90, title: "Demo" }]);
    expect(cleanChapters("nope", null)).toEqual([]);
  });
});
