import { describe, expect, it } from "vitest";
import { dueState } from "@/lib/due";

const NOW = Date.parse("2026-09-17T15:00:00Z");

describe("dueState", () => {
  it("is nothing without a due date", () => {
    expect(dueState(null, false, NOW)).toBeNull();
  });

  it("complete wins over overdue", () => {
    expect(dueState("2026-09-01T00:00:00Z", true, NOW)).toBe("complete");
  });

  it("a card due today is due soon, not overdue, until the day ends", () => {
    expect(dueState("2026-09-17T00:00:00Z", false, NOW)).toBe("soon");
  });

  it("yesterday is overdue", () => {
    expect(dueState("2026-09-16T00:00:00Z", false, NOW)).toBe("overdue");
  });

  it("next week is later", () => {
    expect(dueState("2026-09-24T00:00:00Z", false, NOW)).toBe("later");
  });
});
