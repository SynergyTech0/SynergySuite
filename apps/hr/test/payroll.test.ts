import { describe, expect, it } from "vitest";
import { DEFAULT_W4, TAX_YEARS, federalWithholding, futa, medicare, socialSecurity, taxYear } from "../lib/payroll/federal";
import { type Deduction, type Hours, type PayProfile, EMPTY_YTD, addToYtd, computePaycheck, standardHours } from "../lib/payroll/calc";
import { DEFAULT_ACCOUNTS, payrollJournal, runTotals } from "../lib/payroll/journal";

const T = TAX_YEARS[2026];

describe("federal withholding (2026, percentage method)", () => {
  it("single, every two weeks, $2,000", () => {
    // (2,000 × 26 − 16,100) = 35,900 taxable: 1,240 + 12% × 23,500 = 4,060 a year, ÷ 26.
    expect(federalWithholding(200_000, 26, DEFAULT_W4, T)).toBe(15_615);
  });

  it("married filing jointly with the Step 2 box: half the standard deduction and half-width brackets", () => {
    // 120,000 − 16,100 = 103,900: 1,240 + 4,560 + 22% × 53,500 = 17,570 a year, ÷ 12.
    expect(federalWithholding(1_000_000, 12, { ...DEFAULT_W4, filingStatus: "married", multipleJobs: true }, T)).toBe(146_417);
  });

  it("dependent credits never go below zero, and Step 4(c) is added on top", () => {
    const w4 = { ...DEFAULT_W4, filingStatus: "head" as const, dependents: 4_000, extraWithholding: 10 };
    expect(federalWithholding(100_000, 52, w4, T)).toBe(1_000);
  });

  it("Step 4(a) other income raises and 4(b) deductions lower the tax", () => {
    const base = federalWithholding(200_000, 26, DEFAULT_W4, T);
    expect(federalWithholding(200_000, 26, { ...DEFAULT_W4, otherIncome: 2_600 }, T)).toBe(base + 1_200); // 12% of 2,600 ÷ 26
    expect(federalWithholding(200_000, 26, { ...DEFAULT_W4, deductions: 2_600 }, T)).toBe(base - 1_200);
  });

  it("exempt or nothing earned means nothing withheld", () => {
    expect(federalWithholding(200_000, 26, { ...DEFAULT_W4, exempt: true, extraWithholding: 50 }, T)).toBe(0);
    expect(federalWithholding(0, 26, { ...DEFAULT_W4, extraWithholding: 50 }, T)).toBe(0);
  });

  it("a year without figures uses the latest one", () => {
    expect(taxYear(2026).exact).toBe(true);
    expect(taxYear(2027)).toEqual({ table: T, exact: false });
  });
});

describe("FICA and FUTA", () => {
  it("Social Security stops at the wage base", () => {
    expect(socialSecurity(200_000, 0, T)).toBe(12_400);
    expect(socialSecurity(200_000, 18_400_000, T)).toBe(3_100); // only $500 of room left
    expect(socialSecurity(200_000, 18_450_000, T)).toBe(0);
  });

  it("additional Medicare applies to the employee only, past $200,000", () => {
    expect(medicare(200_000, 0, T)).toEqual({ employee: 2_900, employer: 2_900 });
    expect(medicare(200_000, 19_900_000, T)).toEqual({ employee: 3_800, employer: 2_900 });
    expect(medicare(200_000, 30_000_000, T)).toEqual({ employee: 4_700, employer: 2_900 });
  });

  it("FUTA stops at $7,000", () => {
    expect(futa(200_000, 600_000, T)).toBe(600);
    expect(futa(200_000, 700_000, T)).toBe(0);
  });
});

const rules = { frequency: "biweekly" as const, overtimeMultiplier: 1.5, sutaRatePercent: 2.7, sutaWageBaseCents: 700_000 };
const hours = (h: Partial<Hours> = {}): Hours => ({ regular: 80, overtime: 0, pto: 0, holiday: 0, sick: 0, bonusCents: 0, ...h });
const ded = (d: Partial<Deduction>): Deduction => ({
  id: d.name ?? "d", name: "d", kind: "posttax", amountCents: null, percent: null, matchPercent: 0, matchCapPercent: 0, annualLimitCents: 0, ...d,
});
const salary = (p: Partial<PayProfile> = {}): PayProfile => ({
  payType: "salary", annualSalaryCents: 5_200_000, hourlyRateCents: 0, w4: DEFAULT_W4, state: "TX", stateRatePercent: 0, deductions: [], ...p,
});

describe("paychecks", () => {
  it("a plain salaried paycheck", () => {
    const pc = computePaycheck(salary(), hours(), rules, EMPTY_YTD, "2026-10-16");
    expect(pc.grossCents).toBe(200_000);
    expect(pc.taxes.map((t) => [t.code, t.amountCents])).toEqual([["federal", 15_615], ["social_security", 12_400], ["medicare", 2_900]]);
    expect(pc.netCents).toBe(200_000 - 15_615 - 12_400 - 2_900);
    expect(pc.employerTaxes.map((t) => [t.code, t.amountCents])).toEqual([
      ["social_security", 12_400], ["medicare", 2_900], ["futa", 1_200], ["suta", 5_400],
    ]);
    expect(pc.warnings).toEqual([]);
  });

  it("401(k) lowers income tax wages only; Section 125 lowers FICA too; the match stops at its cap", () => {
    const pc = computePaycheck(salary({
      deductions: [
        ded({ id: "k", name: "401(k)", kind: "pretax_retirement", percent: 5, matchPercent: 100, matchCapPercent: 4 }),
        ded({ id: "m", name: "Medical", kind: "pretax_benefit", amountCents: 10_000 }),
      ],
    }), hours(), rules, EMPTY_YTD, "2026-10-16");
    expect(pc.wages).toMatchObject({ federal: 180_000, socialSecurity: 190_000 });
    expect(pc.taxes.find((t) => t.code === "federal")!.amountCents).toBe(13_215);
    expect(pc.taxes.find((t) => t.code === "social_security")!.amountCents).toBe(11_780);
    expect(pc.taxes.find((t) => t.code === "medicare")!.amountCents).toBe(2_755);
    expect(pc.deductions.find((d) => d.code === "k")!.employerCents).toBe(8_000);
    expect(pc.netCents).toBe(152_250);
  });

  it("hourly pay with overtime, time off and a bonus", () => {
    const pc = computePaycheck(salary({ payType: "hourly", hourlyRateCents: 2_500 }), hours({ regular: 72, pto: 8, overtime: 5, bonusCents: 10_000 }), rules, EMPTY_YTD, "2026-10-16");
    expect(pc.earnings.map((e) => [e.code, e.amountCents])).toEqual([["regular", 180_000], ["pto", 20_000], ["overtime", 18_750], ["bonus", 10_000]]);
    expect(pc.grossCents).toBe(228_750);
  });

  it("salary is prorated for a part period, and a bonus-only run pays no salary", () => {
    expect(computePaycheck(salary(), hours({ salaryFraction: 0.5 }), rules, EMPTY_YTD, "2026-10-16").grossCents).toBe(100_000);
    const bonus = computePaycheck(salary(), hours({ salaryFraction: 0, bonusCents: 50_000 }), rules, EMPTY_YTD, "2026-10-16");
    expect(bonus.earnings.map((e) => e.code)).toEqual(["bonus"]);
    expect(bonus.grossCents).toBe(50_000);
  });

  it("a deduction stops at its yearly limit", () => {
    const p = salary({ deductions: [ded({ id: "k", name: "401(k)", kind: "pretax_retirement", amountCents: 10_000, annualLimitCents: 15_000 })] });
    const pc = computePaycheck(p, hours(), rules, { ...EMPTY_YTD, deductions: { k: 10_000 } }, "2026-10-16");
    expect(pc.deductions[0].amountCents).toBe(5_000);
    expect(pc.warnings).toContain("401(k) reached its yearly limit.");
  });

  it("state tax at the flat rate set for the person", () => {
    const pc = computePaycheck(salary({ state: "CA", stateRatePercent: 5 }), hours(), rules, EMPTY_YTD, "2026-10-16");
    expect(pc.taxes.find((t) => t.code === "state")).toEqual({ code: "state", label: "CA income tax", amountCents: 10_000 });
  });

  it("flags pay that deductions would take below zero", () => {
    const pc = computePaycheck(salary({ deductions: [ded({ amountCents: 199_000 })] }), hours(), rules, EMPTY_YTD, "2026-10-16");
    expect(pc.netCents).toBeLessThan(0);
    expect(pc.warnings.join(" ")).toMatch(/more than this paycheck/);
  });

  it("year to date carries into the next paycheck", () => {
    const pc = computePaycheck(salary(), hours(), rules, EMPTY_YTD, "2026-10-16");
    const ytd = addToYtd(addToYtd(EMPTY_YTD, pc), pc);
    expect(ytd.grossCents).toBe(400_000);
    expect(ytd.futaWagesCents).toBe(400_000);
    const third = computePaycheck(salary(), hours(), rules, ytd, "2026-10-30");
    expect(third.employerTaxes.find((t) => t.code === "futa")!.amountCents).toBe(1_200);
    const fourth = computePaycheck(salary(), hours(), rules, addToYtd(ytd, third), "2026-11-13");
    expect(fourth.employerTaxes.find((t) => t.code === "futa")!.amountCents).toBe(600); // $1,000 left under $7,000
  });

  it("usual hours per period", () => {
    expect(standardHours("weekly")).toBe(40);
    expect(standardHours("biweekly")).toBe(80);
    expect(standardHours("semimonthly")).toBe(86.67);
    expect(standardHours("monthly")).toBe(173.33);
  });
});

describe("payroll journal", () => {
  it("balances and leaves out empty lines", () => {
    const a = computePaycheck(salary({ deductions: [ded({ id: "k", name: "401(k)", kind: "pretax_retirement", percent: 5, matchPercent: 50 })] }), hours(), rules, EMPTY_YTD, "2026-10-16");
    const b = computePaycheck(salary({ payType: "hourly", hourlyRateCents: 3_000 }), hours({ overtime: 3 }), rules, EMPTY_YTD, "2026-10-16");
    const t = runTotals([a, b]);
    const lines = payrollJournal(t, DEFAULT_ACCOUNTS, "Payroll 1");
    const debits = lines.reduce((s, l) => s + l.debitCents, 0);
    const credits = lines.reduce((s, l) => s + l.creditCents, 0);
    expect(debits).toBe(credits);
    expect(debits).toBe(t.grossCents + t.employerTaxesCents + t.employerBenefitsCents);
    expect(lines.find((l) => l.account.number === "2210")!.creditCents).toBe(t.netCents);

    const plain = payrollJournal(runTotals([b]), DEFAULT_ACCOUNTS, "Payroll 2");
    expect(plain.map((l) => l.account.number)).toEqual(["6100", "6110", "2220", "2210"]);
  });
});
