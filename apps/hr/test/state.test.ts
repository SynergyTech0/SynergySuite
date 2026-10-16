import { describe, expect, it } from "vitest";
import { STATE_TABLES } from "../lib/payroll/state-tables";
import { type StateTable, stateWithholding } from "../lib/payroll/state";

const single = { filingStatus: "single" as const, allowances: 0, extraWithholding: 0 };

describe("state withholding arithmetic", () => {
  const flat: StateTable = { year: 2026, source: "test", method: "flat", flatRate: 0.05, allowance: 1_000 };
  const graduated: StateTable = {
    year: 2026, source: "test", method: "brackets",
    brackets: { single: [{ over: 0, rate: 0.01 }, { over: 10_000, rate: 0.05 }], married: [{ over: 0, rate: 0.01 }, { over: 20_000, rate: 0.05 }] },
    standardDeduction: { single: 5_000, married: 10_000 }, allowanceCredit: 100,
  };

  it("annualizes, takes off allowances and divides back", () => {
    // $2,000 biweekly = $52,000 a year; 2 allowances of $1,000 leave $50,000 at 5% = $2,500 / 26.
    expect(stateWithholding(200_000, 26, { ...single, allowances: 2 }, flat)).toBe(9_615);
  });

  it("brackets by filing status, standard deduction and allowance credits", () => {
    // 52,000 - 5,000 = 47,000: 10,000 at 1% + 37,000 at 5% = 1,950; less 1 credit of 100 = 1,850 / 26.
    expect(stateWithholding(200_000, 26, { ...single, allowances: 1 }, graduated)).toBe(7_115);
    // Married: 52,000 - 10,000 = 42,000: 200 + 1,100 = 1,300 / 26.
    expect(stateWithholding(200_000, 26, { ...single, filingStatus: "married" }, graduated)).toBe(5_000);
  });

  it("adds extra withholding, honors exemption and never goes below zero", () => {
    expect(stateWithholding(200_000, 26, { ...single, extraWithholding: 10 }, flat)).toBe(10_000 + 1_000);
    expect(stateWithholding(200_000, 26, { ...single, exempt: true }, flat)).toBe(0);
    expect(stateWithholding(10_000, 26, { ...single, allowances: 30 }, graduated)).toBe(0);
  });

  it("subtracts federal withholding in states whose formula does", () => {
    const t: StateTable = { ...flat, federalDeduction: true };
    // 52,000 - 26 x 150 = 48,100 at 5% = 2,405 / 26.
    expect(stateWithholding(200_000, 26, single, t, 15_000)).toBe(9_250);
  });
});

describe("state tables", () => {
  it("cover every state and DC with a dated source", () => {
    const codes = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
    for (const c of codes) {
      const t = STATE_TABLES[c];
      expect(t, c).toBeTruthy();
      expect(t.year, c).toBeGreaterThanOrEqual(2025);
      expect(t.source, c).toMatch(/^https?:\/\//);
      if (t.method === "flat") expect(t.flatRate, c).toBeGreaterThan(0);
      if (t.method === "brackets") expect(t.brackets?.single?.length, c).toBeGreaterThan(0);
    }
    for (const c of ["AK", "FL", "NV", "SD", "TN", "TX", "WA", "WY"]) expect(STATE_TABLES[c].method, c).toBe("none");
  });

  it("no wage tax in Texas", () => {
    expect(stateWithholding(200_000, 26, single, STATE_TABLES.TX)).toBe(0);
  });
});
