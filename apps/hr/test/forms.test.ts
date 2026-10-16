import { describe, expect, it } from "vitest";
import { type Deduction, EMPTY_YTD, type PayProfile, type YearToDate, addToYtd, computePaycheck } from "../lib/payroll/calc";
import { DEFAULT_W4 } from "../lib/payroll/federal";
import { buildEfw2, efw2Problems } from "../lib/payroll/efw2";
import { type PaidCheck, form940, form941, stateQuarter, w2, w3 } from "../lib/payroll/forms";

const rules = { frequency: "monthly" as const, overtimeMultiplier: 1.5, sutaRatePercent: 2.7, sutaWageBaseCents: 700_000 };
const hours = { regular: 0, overtime: 0, pto: 0, holiday: 0, sick: 0, bonusCents: 0 };
const k401: Deduction = { id: "k", name: "401(k)", kind: "pretax_retirement", amountCents: 50_000, percent: null, matchPercent: 50, matchCapPercent: 0, annualLimitCents: 0 };
const health: Deduction = { id: "h", name: "Health", kind: "pretax_benefit", amountCents: 20_000, percent: null, matchPercent: 0, matchCapPercent: 0, annualLimitCents: 0 };

function year(id: string, p: PayProfile): PaidCheck[] {
  let ytd: YearToDate = EMPTY_YTD;
  const out: PaidCheck[] = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    const payDate = `2026-${mm}-28`;
    const result = computePaycheck(p, hours, rules, ytd, payDate);
    ytd = addToYtd(ytd, result);
    out.push({ employeeId: id, payDate, periodStart: `2026-${mm}-01`, periodEnd: `2026-${mm}-28`, state: p.state, result });
  }
  return out;
}

const base: PayProfile = { payType: "salary", annualSalaryCents: 0, hourlyRateCents: 0, w4: DEFAULT_W4, state: "TX", stateMethod: "table", stateRatePercent: 0, deductions: [] };
// Ann: $60,000 with a 401(k) and health plan, flat 5% in CA. Bo: $240,000, past both the Social Security base and $200,000.
const ann = year("1", { ...base, annualSalaryCents: 6_000_000, state: "CA", stateMethod: "flat", stateRatePercent: 5, deductions: [k401, health] });
const bo = year("2", { ...base, annualSalaryCents: 24_000_000 });
const all = [...ann, ...bo];

describe("W-2 and W-3", () => {
  it("fills the boxes from the year's paychecks", () => {
    const f = w2(2026, "1", all);
    // $5,000 a month less $500 401(k) and $200 health.
    expect(f.wagesCents).toBe(12 * 430_000);
    expect(f.socialSecurityWagesCents).toBe(12 * 480_000);
    expect(f.medicareWagesCents).toBe(12 * 480_000);
    expect(f.socialSecurityCents).toBe(12 * 29_760);
    expect(f.box12).toEqual({ D: 600_000 });
    expect(f.retirementPlan).toBe(true);
    expect(f.section125Cents).toBe(240_000);
    expect(f.states).toEqual([{ state: "CA", wagesCents: 12 * 430_000, taxCents: 12 * 21_500 }]);
  });

  it("stops box 3 at the Social Security wage base", () => {
    const f = w2(2026, "2", all);
    expect(f.socialSecurityWagesCents).toBe(18_450_000);
    expect(f.socialSecurityCents).toBe(Math.round(18_450_000 * 0.062));
    expect(f.medicareWagesCents).toBe(24_000_000);
    expect(f.states).toEqual([]);
  });

  it("adds the W-2s up on the W-3", () => {
    const t = w3(2026, [w2(2026, "1", all), w2(2026, "2", all)]);
    expect(t.forms).toBe(2);
    expect(t.wagesCents).toBe(12 * 430_000 + 24_000_000);
    expect(t.box12.D).toBe(600_000);
  });
});

describe("Form 941", () => {
  it("matches what the paychecks withheld and owed, to the cent", () => {
    for (const q of [1, 2, 3, 4]) {
      const f = form941(2026, q, all);
      const checks = all.filter((c) => Math.ceil(Number(c.payDate.slice(5, 7)) / 3) === q);
      const owed = checks.reduce((s, c) => s + c.result.taxesCents - (c.result.taxes.find((t) => t.code === "state")?.amountCents ?? 0)
        + c.result.employerTaxes.filter((t) => t.code === "social_security" || t.code === "medicare").reduce((a, t) => a + t.amountCents, 0), 0);
      expect(f.totalTaxCents).toBe(owed);
      expect(Math.abs(f.fractionsOfCentsCents)).toBeLessThan(10);
      expect(f.months.reduce((a, b) => a + b, 0)).toBe(f.totalTaxCents);
      expect(f.employees).toBe(2);
    }
  });

  it("caps Social Security wages and picks up additional Medicare", () => {
    const q4 = form941(2026, 4, all);
    // Bo reaches $184,500 in September (9 x $20,000 = $180,000, then $4,500 of October).
    expect(q4.socialSecurityWagesCents).toBe(3 * 480_000 + 450_000);
    // Bo reaches $200,000 at the end of October, so all of November and December is past it.
    expect(q4.additionalMedicareWagesCents).toBe(4_000_000);
    expect(form941(2026, 1, all).additionalMedicareWagesCents).toBe(0);
  });
});

describe("Form 940 and state summary", () => {
  it("takes off exempt benefits and wages past $7,000 a person", () => {
    const f = form940(2026, all);
    expect(f.totalPaymentsCents).toBe(12 * 500_000 + 24_000_000);
    expect(f.exemptCents).toBe(240_000);
    expect(f.taxableWagesCents).toBe(1_400_000);
    expect(f.futaTaxCents).toBe(8_400);
    expect(f.quarters.reduce((a, b) => a + b, 0)).toBe(8_400);
  });

  it("totals state wages, withholding and unemployment by quarter", () => {
    const [ca, tx] = stateQuarter(2026, 1, all);
    expect(ca).toMatchObject({ state: "CA", employees: 1, wagesCents: 3 * 430_000, withheldCents: 3 * 21_500, grossCents: 1_500_000 });
    expect(tx).toMatchObject({ state: "TX", employees: 1, withheldCents: 0, grossCents: 6_000_000 });
  });
});

describe("EFW2 file for the SSA", () => {
  const employer = {
    ein: "123456789", name: "Acme Inc", bsoUserId: "ABCD1234", contactName: "Pat Lee", contactPhone: "(512) 555-0100", contactEmail: "pay@acme.example",
    address1: "1 Main St", address2: "Suite 200", city: "Austin", state: "TX", zip: "78701-1234",
  };
  const person = (ssn: string, first: string, id: string) => ({
    ssn, first, middle: "", last: "Smith", suffix: "", address1: "5 Oak Ave", address2: "", city: "San José", state: "CA", zip: "94105", w2: w2(2026, id, all),
  });
  const file = buildEfw2(2026, employer, [person("123456789", "Ann", "1"), person("234567890", "Bo", "2")]);
  const records = file.split("\r\n");
  const at = (r: string, from: number, to: number) => r.slice(from - 1, to);

  it("writes RA, RE, an RW per person, RT and RF, 512 characters each with CR LF", () => {
    expect(file.endsWith("\r\n")).toBe(true);
    expect(records.pop()).toBe("");
    expect(records.map((r) => r.slice(0, 2))).toEqual(["RA", "RE", "RW", "RW", "RT", "RF"]);
    for (const r of records) expect(r).toHaveLength(512);
  });

  it("puts the fields where the SSA layout says", () => {
    const [ra, re, rw, , rt, rf] = records;
    expect(at(ra, 3, 11)).toBe("123456789");
    expect(at(ra, 12, 19)).toBe("ABCD1234");
    expect(at(ra, 36, 37)).toBe("98");
    expect(at(ra, 38, 94).trim()).toBe("ACME INC");
    expect(at(ra, 95, 116).trim()).toBe("SUITE 200");
    expect(at(ra, 117, 138).trim()).toBe("1 MAIN ST");
    expect(at(ra, 161, 171)).toBe("TX787011234");
    expect(at(ra, 423, 437).trim()).toBe("5125550100");
    expect(at(ra, 446, 485).trim()).toBe("pay@acme.example");
    expect(at(ra, 500, 500)).toBe("L");
    expect(at(re, 3, 6)).toBe("2026");
    expect(at(re, 8, 16)).toBe("123456789");
    expect(at(re, 174, 174)).toBe("N");
    expect(at(re, 219, 221)).toBe("R 0");
    expect(at(re, 279, 318).trim()).toBe("pay@acme.example");

    const ann1 = w2(2026, "1", all);
    expect(at(rw, 3, 11)).toBe("123456789");
    expect(at(rw, 12, 26).trim()).toBe("ANN");
    expect(at(rw, 42, 61).trim()).toBe("SMITH");
    expect(at(rw, 110, 131).trim()).toBe("SAN JOSE");
    expect(Number(at(rw, 188, 198))).toBe(ann1.wagesCents);
    expect(Number(at(rw, 199, 209))).toBe(ann1.federalCents);
    expect(Number(at(rw, 210, 220))).toBe(ann1.socialSecurityWagesCents);
    expect(Number(at(rw, 287, 297))).toBe(600_000);
    expect(at(rw, 265, 275)).toBe(" ".repeat(11));
    expect(at(rw, 486, 489)).toBe("0 10");

    expect(at(rt, 3, 9)).toBe("0000002");
    expect(Number(at(rt, 10, 24))).toBe(12 * 430_000 + 24_000_000);
    expect(Number(at(rt, 40, 54))).toBe(12 * 480_000 + 18_450_000);
    expect(Number(at(rt, 145, 159))).toBe(600_000);
    expect(at(rt, 115, 129)).toBe(" ".repeat(15));
    expect(at(rf, 8, 16)).toBe("000000002");
  });

  it("says what's missing instead of writing a file SSA would reject", () => {
    expect(efw2Problems({ ...employer, ein: "", bsoUserId: "" }, [])).toEqual(["the company's EIN", "the BSO user ID"]);
    expect(() => buildEfw2(2026, employer, [{ ...person("", "Ann", "1"), address1: "" }])).toThrow(/Ann Smith's Social Security number, Ann Smith's address/);
  });
});
