import { describe, expect, it } from "vitest";
import { cleanHours, dayIn, defaultHours, freeStarts, isDay, offsetMs, zonedTime } from "../lib/time";

const rules = { tz: "America/New_York", durationMin: 30, bufferBeforeMin: 0, bufferAfterMin: 0, stepMin: 30, minNoticeMin: 0, maxDaysAhead: 365 };
const iso = (t: number) => new Date(t).toISOString();

describe("time zones", () => {
  it("turns wall-clock times into UTC, through daylight saving", () => {
    expect(iso(zonedTime("2026-07-01", 9 * 60, "America/New_York"))).toBe("2026-07-01T13:00:00.000Z");
    expect(iso(zonedTime("2026-12-01", 9 * 60, "America/New_York"))).toBe("2026-12-01T14:00:00.000Z");
    // The morning after clocks go back (Nov 1, 2026).
    expect(iso(zonedTime("2026-11-01", 9 * 60, "America/New_York"))).toBe("2026-11-01T14:00:00.000Z");
    expect(iso(zonedTime("2026-10-16", 0, "Asia/Kolkata"))).toBe("2026-10-15T18:30:00.000Z");
    expect(offsetMs(Date.parse("2026-07-01T00:00:00Z"), "Europe/London")).toBe(3_600_000);
    expect(dayIn(Date.parse("2026-10-16T02:00:00Z"), "America/Los_Angeles")).toBe("2026-10-15");
  });

  it("checks days and hours", () => {
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2028-02-29")).toBe(true);
    expect(cleanHours(defaultHours())).toEqual(defaultHours());
    expect(cleanHours([[], [[600, 540]], [], [], [], [], []])).toBeNull();
    expect(cleanHours([[], [[540, 720], [700, 800]], [], [], [], [], []])).toBeNull();
    expect(cleanHours([[], [[780, 1020], [540, 720]], [], [], [], [], []])![1]).toEqual([[540, 720], [780, 1020]]);
  });
});

describe("free times", () => {
  // Mon-Fri 9-5 New York; 2026-10-19 is a Monday.
  const hours = defaultHours();
  const now = Date.parse("2026-10-16T12:00:00Z");

  it("offers the grid inside opening hours only", () => {
    const starts = freeStarts(hours, [], rules, "2026-10-17", "2026-10-19", now);
    expect(starts.length).toBe(16); // Saturday and Sunday closed; 9:00 to 4:30 on Monday
    expect(iso(starts[0])).toBe("2026-10-19T13:00:00.000Z");
    expect(iso(starts.at(-1)!)).toBe("2026-10-19T20:30:00.000Z");
  });

  it("keeps clear of busy times and buffers", () => {
    const busy = [{ start: Date.parse("2026-10-19T14:00:00Z"), end: Date.parse("2026-10-19T15:00:00Z") }];
    const starts = freeStarts(hours, busy, { ...rules, bufferAfterMin: 15, bufferBeforeMin: 15 }, "2026-10-19", "2026-10-19", now).map(iso);
    expect(starts).not.toContain("2026-10-19T13:30:00.000Z"); // its after-buffer runs into 10:00
    expect(starts).not.toContain("2026-10-19T14:30:00.000Z");
    expect(starts).not.toContain("2026-10-19T15:00:00.000Z"); // its before-buffer reaches back into 11:00
    expect(starts).toContain("2026-10-19T13:00:00.000Z");
    expect(starts).toContain("2026-10-19T15:30:00.000Z");
  });

  it("respects notice and how far ahead people can book", () => {
    const monday9 = Date.parse("2026-10-19T13:00:00Z");
    const starts = freeStarts(hours, [], { ...rules, minNoticeMin: 90 }, "2026-10-19", "2026-10-19", monday9);
    expect(iso(starts[0])).toBe("2026-10-19T14:30:00.000Z");
    expect(freeStarts(hours, [], { ...rules, maxDaysAhead: 2 }, "2026-10-19", "2026-10-19", now)).toEqual([]);
  });

  it("fits long services into the window", () => {
    const starts = freeStarts(hours, [], { ...rules, durationMin: 120, stepMin: 60 }, "2026-10-19", "2026-10-19", now);
    expect(starts.map((t) => new Date(t).getUTCHours())).toEqual([13, 14, 15, 16, 17, 18, 19]);
  });
});
