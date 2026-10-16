import { describe, expect, it } from "vitest";
import { concat, decodeWav, durationMs, encodeWav, level, resample, silence, tone } from "../lib/audio";
import { formatNumber, toE164 } from "../lib/numbers";
import { trimSilence } from "../lib/worker";

describe("phone numbers", () => {
  it("reads numbers the way people type them", () => {
    expect(toE164("+1 (555) 123-4567")).toBe("+15551234567");
    expect(toE164("555-123-4567")).toBe("+15551234567");
    expect(toE164("1 555 123 4567")).toBe("+15551234567");
    expect(toE164("0044 20 7946 0958")).toBe("+442079460958");
    expect(toE164("020 7946 0958", "44")).toBe("+442079460958");
    expect(toE164("bob@example.com")).toBeNull();
    expect(toE164("12345")).toBeNull();
    expect(toE164("+0123456789")).toBeNull();
    expect(toE164("")).toBeNull();
  });

  it("shows them in groups", () => {
    expect(formatNumber("+15551234567")).toBe("+1 555 123 4567");
    expect(formatNumber(null)).toBe("");
  });
});

describe("audio", () => {
  it("writes and reads WAV", () => {
    const samples = tone([440], 500, 16000);
    const back = decodeWav(encodeWav({ rate: 16000, samples }))!;
    expect(back.rate).toBe(16000);
    expect(Array.from(back.samples)).toEqual(Array.from(samples));
    expect(durationMs(back)).toBe(500);
    expect(decodeWav(Buffer.from("not audio"))).toBeNull();
  });

  it("resamples and measures loudness", () => {
    const up = resample({ rate: 16000, samples: tone([440], 1000, 16000) }, 48000);
    expect(up.samples.length).toBe(48000);
    expect(level(silence(100, 16000))).toBe(0);
    expect(level(tone([440], 100, 16000))).toBeGreaterThan(0.1);
  });

  it("drops the quiet tail of a message, keeping half a second", () => {
    const msg = concat([tone([300], 1000, 16000), silence(5000, 16000)]);
    expect(trimSilence(msg).length).toBe(16000 + 8000);
  });
});
