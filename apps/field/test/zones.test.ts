import { describe, expect, it } from "vitest";
import { zoneOffset, zonedDay, zonedTime } from "../lib/schedule";

describe("time zones", () => {
  it("finds the instant of a local hour, across a clock change", () => {
    expect(zonedTime("2026-10-19", 8, "America/Chicago").toISOString()).toBe("2026-10-19T13:00:00.000Z");
    expect(zonedTime("2026-11-02", 8, "America/Chicago").toISOString()).toBe("2026-11-02T14:00:00.000Z");
    expect(zonedTime("2026-10-19", 8, "UTC").toISOString()).toBe("2026-10-19T08:00:00.000Z");
    expect(zoneOffset(new Date("2026-07-01T12:00:00Z"), "Asia/Kolkata")).toBe(330);
  });

  it("says what day it is there", () => {
    expect(zonedDay(new Date("2026-10-20T03:00:00Z"), "America/Chicago")).toBe("2026-10-19");
    expect(zonedDay(new Date("2026-10-20T03:00:00Z"), "Asia/Tokyo")).toBe("2026-10-20");
  });
});
