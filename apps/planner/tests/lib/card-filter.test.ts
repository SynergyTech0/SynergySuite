import { describe, expect, it } from "vitest";
import { EMPTY_FILTER, filterFromParams, filterToParams, isFiltering, matchesFilter, type CardFilter } from "@/lib/card-filter";

const NOW = Date.parse("2026-09-17T12:00:00Z");
const f = (over: Partial<CardFilter>): CardFilter => ({ ...EMPTY_FILTER, ...over });

const card = {
  title: "Fix checkout timeout",
  issueKey: "SHOP-12",
  description: "Gateway returns 504 after 30s",
  labels: [{ id: "L-bug" }],
  members: [{ id: "U-ann" }],
  dueDate: "2026-09-10T00:00:00Z",
  isComplete: false,
  issueType: "bug",
  priority: "high",
};

describe("matchesFilter", () => {
  it("matches everything with no filter", () => {
    expect(matchesFilter(card, EMPTY_FILTER, NOW)).toBe(true);
    expect(isFiltering(EMPTY_FILTER)).toBe(false);
  });

  it("keyword searches title, key and description, every word required", () => {
    expect(matchesFilter(card, f({ q: "shop-12" }), NOW)).toBe(true);
    expect(matchesFilter(card, f({ q: "gateway 504" }), NOW)).toBe(true);
    expect(matchesFilter(card, f({ q: "gateway login" }), NOW)).toBe(false);
  });

  it("choices within a facet are OR", () => {
    expect(matchesFilter(card, f({ labels: ["L-other", "L-bug"] }), NOW)).toBe(true);
    expect(matchesFilter(card, f({ priorities: ["low", "high"] }), NOW)).toBe(true);
  });

  it("facets combine with AND", () => {
    expect(matchesFilter(card, f({ labels: ["L-bug"], members: ["U-bob"] }), NOW)).toBe(false);
    expect(matchesFilter(card, f({ labels: ["L-bug"], members: ["U-ann"], types: ["bug"] }), NOW)).toBe(true);
  });

  it("'none' finds unassigned cards", () => {
    expect(matchesFilter({ ...card, members: [] }, f({ members: ["none"] }), NOW)).toBe(true);
    expect(matchesFilter(card, f({ members: ["none"] }), NOW)).toBe(false);
  });

  it("due facets: overdue, no dates, complete", () => {
    expect(matchesFilter(card, f({ due: ["overdue"] }), NOW)).toBe(true);
    expect(matchesFilter({ ...card, isComplete: true }, f({ due: ["overdue"] }), NOW)).toBe(false);
    expect(matchesFilter({ ...card, isComplete: true }, f({ due: ["complete"] }), NOW)).toBe(true);
    expect(matchesFilter({ ...card, dueDate: null }, f({ due: ["none"] }), NOW)).toBe(true);
  });
});

describe("assignee counts as being on the card", () => {
  it("member filter matches the assignee, and 'none' excludes assigned cards", () => {
    const assigned = { ...card, members: [], assigneeId: "U-zed" };
    expect(matchesFilter(assigned, f({ members: ["U-zed"] }), NOW)).toBe(true);
    expect(matchesFilter(assigned, f({ members: ["none"] }), NOW)).toBe(false);
  });
});

describe("fix version and component facets", () => {
  it("match tagged cards, and 'none' matches untagged ones", () => {
    const tagged = { ...card, fixVersions: [{ id: "V1" }], components: [{ id: "C-api" }] };
    expect(matchesFilter(tagged, f({ versions: ["V1"] }), NOW)).toBe(true);
    expect(matchesFilter(tagged, f({ versions: ["none"] }), NOW)).toBe(false);
    expect(matchesFilter(card, f({ versions: ["none"], components: ["none"] }), NOW)).toBe(true);
    expect(matchesFilter(tagged, f({ versions: ["V1"], components: ["C-web"] }), NOW)).toBe(false);
  });

  it("round-trip through the URL", () => {
    const filter = f({ versions: ["V1", "none"], components: ["C-api"] });
    expect(filterFromParams(filterToParams(filter))).toEqual(filter);
  });
});

describe("quick-filter facets", () => {
  it("blocked matches only cards with an open blocker", () => {
    expect(matchesFilter({ ...card, badges: { blockedBy: 1 } }, f({ blocked: true }), NOW)).toBe(true);
    expect(matchesFilter({ ...card, badges: { blockedBy: 0 } }, f({ blocked: true }), NOW)).toBe(false);
    expect(matchesFilter(card, f({ blocked: true }), NOW)).toBe(false);
  });

  it("recent matches cards touched in the last 7 days", () => {
    expect(matchesFilter({ ...card, updatedAt: "2026-09-15T00:00:00Z" }, f({ recent: true }), NOW)).toBe(true);
    expect(matchesFilter({ ...card, updatedAt: "2026-08-01T00:00:00Z" }, f({ recent: true }), NOW)).toBe(false);
  });

  it("both survive the URL", () => {
    const filter = f({ blocked: true, recent: true });
    expect(filterFromParams(filterToParams(filter))).toEqual(filter);
  });
});

describe("URL round-trip", () => {
  it("survives serialisation, and ignores unknown due values", () => {
    const filter = f({ q: "timeout", labels: ["a", "b"], due: ["overdue"], types: ["bug"] });
    expect(filterFromParams(filterToParams(filter))).toEqual(filter);
    expect(filterFromParams(new URLSearchParams("due=overdue,bogus")).due).toEqual(["overdue"]);
  });

  it("preserves unrelated params such as the open card", () => {
    const p = filterToParams(f({ q: "x" }), new URLSearchParams("card=123"));
    expect(p.get("card")).toBe("123");
    expect(p.get("q")).toBe("x");
  });
});
