import { describe, expect, it } from "vitest";
import { dedupe, queryTerms, rank, recency, score } from "../lib/rank";

const now = Date.parse("2026-10-16T12:00:00Z");
const h = (app: string, id: string, title: string, snippet = "", date = "2026-01-01T00:00:00Z") => ({ app, id, title, snippet, date });

describe("ranking", () => {
  it("takes the query's positive terms", () => {
    expect(queryTerms('budget "q3 plan" OR forecast -draft')).toEqual(["budget", "q3 plan", "forecast"]);
    expect(queryTerms("a b", "b c")).toEqual(["a", "b", "c"]);
  });

  it("weighs a title match over a snippet match", () => {
    const terms = queryTerms("budget");
    const inTitle = h("mail", "1", "Budget review");
    const inSnippet = h("drive", "2", "Notes", "the budget is due");
    expect(score(inTitle, terms, now)).toBeGreaterThan(score(inSnippet, terms, now));
    expect(rank([inSnippet, inTitle], terms, now).map((x) => x.id)).toEqual(["1", "2"]);
  });

  it("rewards a title with every term and the whole phrase", () => {
    const terms = queryTerms("budget review");
    const all = h("mail", "a", "Budget review notes");
    const some = h("mail", "b", "Budget for travel", "review later");
    expect(rank([some, all], terms, now)[0].id).toBe("a");
  });

  it("gives recent and upcoming items a bonus that fades", () => {
    expect(recency("2026-10-16T12:00:00Z", now)).toBeCloseTo(2);
    expect(recency("2026-10-30T12:00:00Z", now)).toBeCloseTo(1);
    expect(recency("2026-10-02T12:00:00Z", now)).toBeCloseTo(1);
    expect(recency("", now)).toBe(0);
    const terms = queryTerms("plan");
    const old = h("mail", "old", "Plan", "", "2024-01-01T00:00:00Z");
    const fresh = h("mail", "new", "Plan", "", "2026-10-15T00:00:00Z");
    expect(rank([old, fresh], terms, now).map((x) => x.id)).toEqual(["new", "old"]);
  });

  it("breaks ties by date, then app order, then input order, and is stable", () => {
    const terms = queryTerms("zzz");
    const a = h("drive", "a", "x", "", "");
    const b = h("mail", "b", "x", "", "");
    const c = h("mail", "c", "x", "", "");
    expect(rank([a, b, c], terms, now, ["mail", "drive"]).map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect(rank([c, b, a], terms, now, ["mail", "drive"]).map((x) => x.id)).toEqual(["c", "b", "a"]);
    const input = [a, b, c];
    rank(input, terms, now);
    expect(input.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("dedupes by app and id", () => {
    expect(dedupe([h("mail", "1", "x"), h("drive", "1", "y"), h("mail", "1", "z")]).map((x) => x.title)).toEqual(["x", "y"]);
  });
});
