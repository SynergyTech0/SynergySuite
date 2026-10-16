import { describe, expect, it } from "vitest";
import { cardDayKey, monthGrid, sortCards, timelineSpan, barFor } from "@/lib/views";

/**
 * FAILING-FIRST for the table, calendar and timeline views.
 *
 * The maths lives outside the components so the awkward cases — a month that starts on a Sunday,
 * a card with only a due date, sorting a column where half the values are missing — can be asserted
 * without rendering anything.
 */

const cards = [
  { id: "a", title: "Beta", priority: "low", points: 3, dueDate: "2026-09-20", issueKey: "SYN-2" },
  { id: "b", title: "alpha", priority: "highest", points: null, dueDate: null, issueKey: "SYN-10" },
  { id: "c", title: "Gamma", priority: "medium", points: 8, dueDate: "2026-09-02", issueKey: "SYN-1" },
];

describe("sortCards", () => {
  it("sorts titles case-insensitively, not by ASCII", () => {
    expect(sortCards(cards, "title", "asc").map((c) => c.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts issue keys by their number, so SYN-10 comes after SYN-2", () => {
    expect(sortCards(cards, "issueKey", "asc").map((c) => c.issueKey)).toEqual(["SYN-1", "SYN-2", "SYN-10"]);
  });

  it("orders priority by severity and puts missing values last in both directions", () => {
    expect(sortCards(cards, "priority", "asc").map((c) => c.id)).toEqual(["b", "c", "a"]);
    const byPoints = sortCards(cards, "points", "desc");
    expect(byPoints.map((c) => c.id)).toEqual(["c", "a", "b"]);   // the card with no points is last
    expect(sortCards(cards, "dueDate", "asc").map((c) => c.id)).toEqual(["c", "a", "b"]);
    expect(sortCards(cards, "dueDate", "desc").map((c) => c.id)).toEqual(["a", "c", "b"]);
  });

  it("does not mutate the array it was given", () => {
    const original = [...cards];
    sortCards(cards, "title", "desc");
    expect(cards).toEqual(original);
  });
});

describe("monthGrid", () => {
  it("returns whole weeks starting Monday, padded from the neighbouring months", () => {
    const weeks = monthGrid(2026, 8);                       // September 2026: the 1st is a Tuesday
    expect(weeks[0]).toHaveLength(7);
    expect(weeks[0][0].date.getDate()).toBe(31);            // Monday 31 August
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks[0][1].date.getDate()).toBe(1);
    expect(weeks[0][1].inMonth).toBe(true);
    expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(30);
    expect(weeks.flat().length % 7).toBe(0);
  });

  it("a month that begins on a Monday is not given a blank leading week", () => {
    const weeks = monthGrid(2026, 5);                       // June 2026 begins on a Monday
    expect(weeks[0][0].date.getDate()).toBe(1);
    expect(weeks[0][0].inMonth).toBe(true);
  });
});

describe("timeline", () => {
  const dated = [
    { id: "a", startDate: "2026-09-01", dueDate: "2026-09-10" },
    { id: "b", startDate: null, dueDate: "2026-09-30" },
    { id: "c", startDate: null, dueDate: null },
  ];

  it("spans only the cards that have dates, and ignores the ones that have none", () => {
    const span = timelineSpan(dated)!;
    expect(span.start.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(span.end.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(timelineSpan([{ id: "c", startDate: null, dueDate: null }])).toBeNull();
  });

  it("places a bar as a percentage of the span, and gives a dateless-start card a single-day bar", () => {
    const span = timelineSpan(dated)!;
    const a = barFor(dated[0], span)!;
    expect(a.left).toBe(0);
    expect(Math.round(a.width)).toBe(31);                   // 9 of 29 days ≈ 31%
    const b = barFor(dated[1], span)!;
    expect(Math.round(b.left + b.width)).toBe(100);         // ends at the right edge
    expect(b.width).toBeGreaterThan(0);                     // a due-date-only card is still visible
    expect(barFor(dated[2], span)).toBeNull();
  });
});

describe("day keys", () => {
  /**
   * A due date is stored as UTC midnight of the day the picker offered, so it must be read back in
   * UTC. Reading it locally showed every card one day early in the table and dropped it in the wrong
   * calendar cell for anyone west of Greenwich — which is what actually happened.
   */
  it("a card's UTC-midnight due date keeps its own day", () => {
    expect(cardDayKey("2026-09-14T00:00:00.000Z")).toBe("2026-09-14");
    expect(cardDayKey(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01");
  });

  it("calendar cells are local days, so a card lands in the cell that shows its date", () => {
    const sept = monthGrid(2026, 8).flat().filter((d) => d.inMonth);
    expect(sept[13].key).toBe("2026-09-14");
    expect(sept[13].date.getDate()).toBe(14);
    expect(sept.map((d) => d.key)).toContain(cardDayKey("2026-09-14T00:00:00.000Z"));
  });
});
