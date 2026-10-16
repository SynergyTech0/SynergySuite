import { describe, expect, it } from "vitest";
import { bucketMyDay } from "../lib/myday";

describe("My Day buckets", () => {
  // 2:30 pm local time; the buckets go by local calendar day.
  const now = new Date(2026, 9, 16, 14, 30);
  const at = (d: number, h = 9, m = 0) => new Date(2026, 9, d, h, m);

  it("splits items into overdue, today, upcoming and no date", () => {
    const items = [
      { id: "yesterday", dueAt: at(15, 23, 59) },
      { id: "this-morning", dueAt: at(16, 0, 0) },
      { id: "tonight", dueAt: at(16, 23, 59) },
      { id: "tomorrow", dueAt: at(17, 0, 0) },
      { id: "later", dueAt: at(30).toISOString() },
      { id: "none", dueAt: null },
      { id: "blank", dueAt: "" },
    ];
    const b = bucketMyDay(items, now);
    const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
    expect(ids(b.overdue)).toEqual(["yesterday"]);
    expect(ids(b.today)).toEqual(["this-morning", "tonight"]);
    expect(ids(b.upcoming)).toEqual(["tomorrow", "later"]);
    expect(ids(b.noDate)).toEqual(["none", "blank"]);
  });

  it("counts something due earlier today as today, not overdue", () => {
    expect(bucketMyDay([{ dueAt: at(16, 8) }], now).today.length).toBe(1);
  });

  it("treats an unreadable date as no date", () => {
    expect(bucketMyDay([{ dueAt: "not a date" }], now).noDate.length).toBe(1);
  });
});
