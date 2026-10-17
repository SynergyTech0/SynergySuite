import { describe, expect, it } from "vitest";
import { trustLines } from "../lib/books";
import { matchNames } from "../lib/conflicts";
import { computeDeadline, federalHolidays, isCourtDay } from "../lib/deadlines";
import { cleanAnalysis } from "../lib/documents";
import { JURISDICTIONS, businessDaysBetween, jurisdiction, matterChecks } from "../lib/jurisdictions";
import { normalize, similarity } from "../lib/parties";

describe("party names", () => {
  it("evens out case, punctuation and entity suffixes", () => {
    expect(normalize("Acme, Inc.").normalized).toBe("ACME INC");
    expect(normalize("ACME INCORPORATED").normalized).toBe("ACME INC");
    expect(normalize("The Widget Company").normalized).toBe("WIDGET CO");
    expect(normalize("Smith & Jones LLP").isPerson).toBe(false);
  });

  it("puts people in last-first order whichever way they're written", () => {
    expect(normalize("Jane Q. Doe").normalized).toBe("DOE JANE Q");
    expect(normalize("Doe, Jane Q").normalized).toBe("DOE JANE Q");
    expect(normalize("Dr. Robert Smith Jr.")).toMatchObject({ normalized: "SMITH ROBERT", suffix: "JR", isPerson: true });
  });

  it("keeps doing-business-as names as aliases", () => {
    const n = normalize("Acme Holdings, Inc. d/b/a Acme Supply");
    expect(n.normalized).toBe("ACME HOLDINGS INC");
    expect(n.aliases).toEqual(["ACME SUPPLY"]);
  });

  it("scores close spellings high and different names low", () => {
    expect(similarity("DOE JANE", "DOE JANE")).toBe(100);
    expect(similarity("JOHNSON ROBERT", "JONSON ROBERT")).toBeGreaterThan(75);
    expect(similarity("ACME INC", "ZENITH LLC")).toBeLessThan(40);
  });

  it("finds a name among clients and parties, middle names and aliases included", () => {
    const pool = [
      { source: "client" as const, name: "Jane Q. Doe", normalized: "DOE JANE Q", aliases: [], role: "client", client_id: "c1", client_name: "Jane Q. Doe", matter_id: null, number: null, title: null, status: null, responsible: null },
      { source: "party" as const, name: "Acme Holdings, Inc.", normalized: "ACME HOLDINGS INC", aliases: ["Acme Supply"], role: "adverse", client_id: "c2", client_name: "Bob Roe", matter_id: "m1", number: "2026-0001", title: "Roe v. Acme", status: "open", responsible: "lee@example.com" },
    ];
    const hits = matchNames(["Jane Doe", "acme supply", "Unrelated Person"], pool);
    expect(hits.map((h) => [h.query, h.name])).toEqual([["acme supply", "Acme Holdings, Inc."], ["Jane Doe", "Jane Q. Doe"]]);
    expect(hits[0]).toMatchObject({ score: 100, source: "party", matterNumber: "2026-0001", role: "adverse" });
  });
});

describe("court deadlines", () => {
  it("knows the federal holidays as observed", () => {
    const h = federalHolidays(2026);
    expect(h.has("2026-07-03")).toBe(true); // July 4 is a Saturday
    expect(h.has("2026-11-26")).toBe(true); // Thanksgiving
    expect(h.has("2026-01-19")).toBe(true); // MLK Day
    expect(h.has("2026-05-25")).toBe(true); // Memorial Day
    expect(isCourtDay("2026-11-27")).toBe(true);
    expect(isCourtDay("2026-11-28")).toBe(false);
  });

  it("runs a last day on a holiday or weekend to the next court day", () => {
    expect(computeDeadline("2026-11-05", 21)).toMatchObject({ counted: "2026-11-26", due: "2026-11-27", rolled: true });
    expect(computeDeadline("2026-10-01", 30)).toMatchObject({ due: "2026-11-02", rolled: true }); // Oct 31 is a Saturday
    expect(computeDeadline("2026-10-05", 14)).toMatchObject({ due: "2026-10-19", rolled: false });
  });

  it("adds three days for mail and counts court days when asked", () => {
    expect(computeDeadline("2026-10-05", 14, { mail: true }).due).toBe("2026-10-22");
    // Five court days from Friday Nov 20 skip the weekend and Thanksgiving.
    expect(computeDeadline("2026-11-20", 5, { count: "court" }).due).toBe("2026-11-30");
    expect(computeDeadline("2026-11-20", 5, { count: "court", extra: new Set(["2026-11-30"]) }).due).toBe("2026-12-01");
  });

  it("refuses bad input", () => {
    expect(() => computeDeadline("11/05/2026", 21)).toThrow();
    expect(() => computeDeadline("2026-11-05", -1)).toThrow();
  });
});

describe("state rules", () => {
  it("has every state and DC", () => {
    expect(JURISDICTIONS).toHaveLength(51);
    expect(jurisdiction("ny")).toMatchObject({ name: "New York", retentionYears: 7, writtenFeeOver: 3000 });
    expect(jurisdiction("FED")).toBeNull();
  });

  it("flags a contingency fee without a signed agreement, or above the guide's cap", () => {
    const base = { jurisdiction: "AL", fee_type: "contingency", contingency_pct: 45, flat_cents: null, engagement_signed_on: null };
    expect(matterChecks(base).map((c) => c.rule)).toEqual(["Contingency fee in writing", "Contingency percentage"]);
    expect(matterChecks({ ...base, contingency_pct: 33, engagement_signed_on: "2026-10-01" })).toEqual([]);
  });

  it("asks for a written fee agreement once fees pass the state's line", () => {
    const m = { jurisdiction: "NY", fee_type: "hourly", contingency_pct: null, flat_cents: null, engagement_signed_on: null };
    expect(matterChecks({ ...m, billed_cents: 100_000 })).toEqual([]);
    expect(matterChecks({ ...m, billed_cents: 400_000 })[0].rule).toBe("Written fee agreement");
    expect(matterChecks({ ...m, jurisdiction: "FED", billed_cents: 400_000 })).toEqual([]);
  });

  it("counts business days for deposit timing", () => {
    expect(businessDaysBetween("2026-10-16", "2026-10-19")).toBe(1); // Friday to Monday
    expect(businessDaysBetween("2026-10-16", "2026-10-21")).toBe(3);
    expect(businessDaysBetween("2026-10-16", "2026-10-16")).toBe(0);
  });
});

describe("books postings", () => {
  const env = (e: Record<string, string> = {}) => e as unknown as NodeJS.ProcessEnv;
  const sum = (l: { debit: number; credit: number }[]) => l.reduce((a, x) => a + Math.round(x.debit * 100) - Math.round(x.credit * 100), 0);
  it("balances every kind of trust entry and its void", () => {
    for (const kind of ["deposit", "disbursement", "fee_transfer"]) {
      expect(sum(trustLines(kind, 12345, "x", false, env()))).toBe(0);
      expect(sum(trustLines(kind, 12345, "x", true, env()))).toBe(0);
    }
    expect(trustLines("deposit", 5000, "x", false, env())).toMatchObject([{ account: "1015", debit: 50 }, { account: "2150", credit: 50 }]);
    expect(trustLines("fee_transfer", 5000, "x", false, env({ LAW_BOOKS_OPERATING: "1000" })).map((l) => l.account)).toEqual(["2150", "1015", "1000", "1100"]);
    expect(trustLines("deposit", 5000, "x", true, env())[0]).toMatchObject({ account: "1015", debit: 0, credit: 50 });
  });
});

describe("AI answers", () => {
  it("keeps only the expected shape", () => {
    const a = cleanAnalysis({ documentType: "motion", documentDate: "March 3", keyPoints: ["a", 2 as unknown as string], parties: [{ name: "X", role: "plaintiff", extra: 1 } as never], timeline: "no" as never });
    expect(a).toMatchObject({ documentType: "motion", documentDate: "", keyPoints: ["a", "2"], parties: [{ name: "X", role: "plaintiff" }], timeline: [], deadlines: [] });
  });
});
