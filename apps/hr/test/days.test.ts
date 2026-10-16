import { describe, expect, it } from "vitest";
import { addDays, businessDays, businessDaysWithin, isDay } from "../lib/days";

describe("days", () => {
  it("counts Monday to Friday, both ends included, without holidays", () => {
    expect(businessDays("2026-10-12", "2026-10-16")).toBe(5);
    expect(businessDays("2026-10-16", "2026-10-19")).toBe(2); // Fri and Mon
    expect(businessDays("2026-10-17", "2026-10-18")).toBe(0);
    expect(businessDays("2026-12-21", "2026-12-25", ["2026-12-25"])).toBe(4);
  });

  it("clips a range to a period", () => {
    expect(businessDaysWithin("2026-10-14", "2026-10-21", "2026-10-05", "2026-10-16")).toBe(3);
    expect(businessDaysWithin("2026-11-02", "2026-11-03", "2026-10-05", "2026-10-16")).toBe(0);
  });

  it("checks and moves dates in UTC", () => {
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2026-1-5")).toBe(false);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-08", -7)).toBe("2026-03-01");
  });
});
