import { describe, expect, it } from "vitest";
import { Segmenter } from "../lib/audio";
import { asText, cleanText, emailOf, transcribeEveryMeeting } from "../lib/transcripts";

const RATE = 16_000;
const tone = (ms: number, amp = 6000) => Int16Array.from({ length: (RATE * ms) / 1000 }, (_, i) => Math.round(amp * Math.sin((2 * Math.PI * 220 * i) / RATE)));
const quiet = (ms: number) => new Int16Array((RATE * ms) / 1000);

describe("Segmenter", () => {
  it("cuts speech at a pause and keeps a little lead-in", () => {
    const seg = new Segmenter(RATE);
    const out = [...seg.push(quiet(500)), ...seg.push(tone(1200)), ...seg.push(quiet(1000))];
    expect(out).toHaveLength(1);
    expect(out[0].startMs).toBe(320); // 500 ms of quiet, less the 180 ms of preroll before the first loud frame
    const ms = (out[0].samples.length / RATE) * 1000;
    expect(ms).toBeGreaterThan(1200 + 900 - 40);
    expect(ms).toBeLessThan(1200 + 900 + 260);
  });

  it("drops a click too short to be speech", () => {
    const seg = new Segmenter(RATE);
    expect([...seg.push(tone(100)), ...seg.push(quiet(1200))]).toHaveLength(0);
  });

  it("splits a long monologue and flushes what is left", () => {
    const seg = new Segmenter(RATE);
    const out = seg.push(tone(65_000));
    expect(out).toHaveLength(2);
    const last = seg.flush();
    expect(last && last.samples.length / RATE).toBeCloseTo(5, 0);
    expect(seg.flush()).toBeNull();
  });

  it("works on frames of any size", () => {
    const seg = new Segmenter(RATE);
    const audio = [quiet(300), tone(800), quiet(1000)];
    const out = [];
    for (const a of audio) for (let i = 0; i < a.length; i += 333) out.push(...seg.push(a.subarray(i, i + 333)));
    expect(out).toHaveLength(1);
  });
});

describe("transcripts", () => {
  it("drops what speech models invent from silence", () => {
    expect(cleanText(" Thank you. ")).toBeNull();
    expect(cleanText("[Music]")).toBeNull();
    expect(cleanText("you")).toBeNull();
    expect(cleanText("  Let's ship it   on Friday. ")).toBe("Let's ship it on Friday.");
  });

  it("knows staff from guests and phones", () => {
    expect(emailOf("Dana@Acme.com")).toBe("dana@acme.com");
    expect(emailOf("guest:Sam#ab12")).toBeNull();
    expect(emailOf("tel:+15551234567")).toBeNull();
  });

  it("is on only when MEET_TRANSCRIBE is always", () => {
    expect(transcribeEveryMeeting({ MEET_TRANSCRIBE: "always" })).toBe(true);
    expect(transcribeEveryMeeting({ MEET_TRANSCRIBE: "" })).toBe(false);
    expect(transcribeEveryMeeting({})).toBe(false);
  });

  it("writes plain text with times on the reader's clock", () => {
    const txt = asText(
      { title: "Weekly sync", started_at: "2026-10-20T14:00:00Z" },
      [{ name: "Dana", email: "dana@acme.com", spoken_at: "2026-10-20T14:03:10Z", text: "I'll send the deck by Friday." }],
      "America/New_York",
    );
    expect(txt).toContain("Weekly sync\nTuesday, October 20, 2026 at 10:00 AM");
    expect(txt).toContain("[10:03] Dana: I'll send the deck by Friday.");
  });
});
