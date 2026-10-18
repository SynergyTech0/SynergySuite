import { describe, expect, it } from "vitest";
import { isScheduler, schedulers } from "../lib/access";
import { addDays, color, day, minutes, weekStart } from "../lib/util";

describe("shifts helpers", () => {
  it("finds the Monday of a week", () => {
    expect(weekStart("2026-10-18")).toBe("2026-10-12"); // a Sunday
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
    expect(weekStart("2026-03-01")).toBe("2026-02-23");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
  });

  it("reads times of day", () => {
    expect(minutes("09:30")).toBe(570);
    expect(minutes("9:05")).toBe(545);
    expect(minutes("24:00")).toBe(1440);
    expect(minutes(600)).toBe(600);
    expect(() => minutes("24:30")).toThrow();
    expect(() => minutes("9am")).toThrow();
    expect(() => minutes(-5)).toThrow();
  });

  it("accepts only real dates and colours", () => {
    expect(day("2026-02-28")).toBe("2026-02-28");
    expect(() => day("2026-02-30")).toThrow(/date/);
    expect(() => day("tomorrow")).toThrow(/date/);
    expect(color("#ABCDEF")).toBe("#abcdef");
    expect(color("red")).toBe("#4f46e5");
  });

  it("makes everyone a scheduler until schedulers are named", () => {
    expect(isScheduler("anyone@example.com", {})).toBe(true);
    expect(isScheduler("ann@example.com", { ADMIN_EMAILS: "Ann@example.com" })).toBe(true);
    expect(isScheduler("bob@example.com", { ADMIN_EMAILS: "ann@example.com" })).toBe(false);
    expect(isScheduler("bob@example.com", { SHIFTS_ADMIN_EMAILS: "bob@example.com", ADMIN_EMAILS: "ann@example.com" })).toBe(true);
    expect(schedulers({ SHIFTS_ADMIN_EMAILS: " ", ADMIN_EMAILS: "ann@example.com" })).toEqual(["ann@example.com"]);
  });
});
