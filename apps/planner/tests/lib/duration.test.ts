import { describe, expect, it } from "vitest";
import { formatDuration, parseDuration } from "@/lib/duration";

describe("parseDuration", () => {
  it("reads Jira-style durations into minutes", () => {
    expect(parseDuration("30m")).toBe(30);
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("1d")).toBe(480);          // a working day is 8h, as Jira defaults
    expect(parseDuration("1w")).toBe(2400);         // a working week is 5d
    expect(parseDuration("1d 4h 30m")).toBe(750);
    expect(parseDuration("2h30m")).toBe(150);
  });

  it("accepts a bare number as minutes, and trims", () => {
    expect(parseDuration("  90 ")).toBe(90);
  });

  it("rejects nonsense rather than guessing", () => {
    for (const v of ["", "soon", "3 fortnights", "-2h", "1.5x", "h"]) expect(parseDuration(v)).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(parseDuration("1D 2H")).toBe(600);
  });
});

describe("formatDuration", () => {
  it("writes minutes back in the same shorthand", () => {
    expect(formatDuration(30)).toBe("30m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(750)).toBe("1d 4h 30m");
    expect(formatDuration(2400)).toBe("1w");
    expect(formatDuration(0)).toBe("0m");
  });

  it("round-trips", () => {
    for (const m of [5, 60, 480, 495, 2400, 3000]) expect(parseDuration(formatDuration(m))).toBe(m);
  });
});
