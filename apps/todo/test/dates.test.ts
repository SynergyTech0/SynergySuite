import { describe, expect, it } from "vitest";
import { addDays, isDay, nextDue } from "../lib/dates";

describe("dates", () => {
  it("checks calendar days", () => {
    expect(isDay("2026-02-28")).toBe(true);
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2026-2-1")).toBe(false);
    expect(isDay(null)).toBe(false);
  });

  it("works out when a repeating task is next due", () => {
    expect(nextDue("2026-10-16", "daily")).toBe("2026-10-17");
    expect(nextDue("2026-10-16", "weekdays")).toBe("2026-10-19"); // Friday to Monday
    expect(nextDue("2026-10-17", "weekdays")).toBe("2026-10-19"); // Saturday to Monday
    expect(nextDue("2026-10-16", "weekly")).toBe("2026-10-23");
    expect(nextDue("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextDue("2026-12-15", "monthly")).toBe("2027-01-15");
    expect(nextDue("2028-02-29", "yearly")).toBe("2029-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
