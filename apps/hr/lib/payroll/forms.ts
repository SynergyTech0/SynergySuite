import type { Paycheck } from "./calc";
import { taxYear } from "./federal";
import { taxesWages } from "./state";

/**
 * Year-end and quarterly forms from paid paychecks: each employee's W-2, the W-3 totals, Form 941
 * for a quarter, Form 940 for the year and a per-state summary for state withholding and
 * unemployment returns. Pure: the caller loads the paychecks.
 *
 * Box and line numbers follow the IRS forms for the tax year; where a form asks for something
 * payroll doesn't track (tips, sick pay from a third party, credits), it is zero and said so.
 */

export interface PaidCheck {
  employeeId: string;
  payDate: string;
  periodStart: string;
  periodEnd: string;
  /** Two-letter work state on the paycheck. */
  state: string;
  result: Paycheck;
}

const sumLines = (lines: { code: string; amountCents: number }[], code: string) =>
  lines.filter((l) => l.code === code).reduce((s, l) => s + l.amountCents, 0);
const sumKind = (pc: Paycheck, kind: string) => pc.deductions.filter((d) => d.kind === kind).reduce((s, d) => s + d.amountCents, 0);
const byDate = (a: PaidCheck, b: PaidCheck) => a.payDate.localeCompare(b.payDate);
const quarterOf = (iso: string) => Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1;

/* ------------------------------------------------------------------- W-2 */

export interface W2State { state: string; wagesCents: number; taxCents: number }

export interface W2 {
  year: number;
  employeeId: string;
  /** Box 1 */ wagesCents: number;
  /** Box 2 */ federalCents: number;
  /** Box 3: stops at the Social Security wage base. */ socialSecurityWagesCents: number;
  /** Box 4 */ socialSecurityCents: number;
  /** Box 5 */ medicareWagesCents: number;
  /** Box 6 */ medicareCents: number;
  /** Box 12, by code: D = 401(k) deferrals, AA = Roth 401(k). Cents. */
  box12: Record<string, number>;
  /** Box 13 */ retirementPlan: boolean;
  /** Boxes 15 to 17, one per state worked in. */
  states: W2State[];
  /** Section 125 (cafeteria plan) amounts, kept off boxes 1, 3 and 5; for the employee's information. */
  section125Cents: number;
}

export function w2(year: number, employeeId: string, checks: PaidCheck[]): W2 {
  const mine = checks.filter((c) => c.employeeId === employeeId && c.payDate.startsWith(String(year))).sort(byDate);
  const base = taxYear(year).table.socialSecurityWageBase * 100;
  const out: W2 = {
    year, employeeId, wagesCents: 0, federalCents: 0, socialSecurityWagesCents: 0, socialSecurityCents: 0, medicareWagesCents: 0,
    medicareCents: 0, box12: {}, retirementPlan: false, states: [], section125Cents: 0,
  };
  const states = new Map<string, W2State>();
  for (const c of mine) {
    const r = c.result;
    out.wagesCents += r.wages.federal;
    out.federalCents += sumLines(r.taxes, "federal");
    out.socialSecurityWagesCents += r.wages.socialSecurity;
    out.socialSecurityCents += sumLines(r.taxes, "social_security");
    out.medicareWagesCents += r.wages.medicare;
    out.medicareCents += sumLines(r.taxes, "medicare");
    const d = sumKind(r, "pretax_retirement");
    const aa = sumKind(r, "roth_retirement");
    if (d) out.box12.D = (out.box12.D ?? 0) + d;
    if (aa) out.box12.AA = (out.box12.AA ?? 0) + aa;
    if (d || aa || r.deductions.some((x) => (x.kind === "pretax_retirement" || x.kind === "roth_retirement") && x.employerCents > 0)) out.retirementPlan = true;
    out.section125Cents += sumKind(r, "pretax_benefit");
    const tax = sumLines(r.taxes, "state");
    // States with no wage tax stay off the W-2 unless something was withheld for them.
    if (c.state && (tax || taxesWages(c.state))) {
      const s = states.get(c.state) ?? { state: c.state, wagesCents: 0, taxCents: 0 };
      s.wagesCents += r.wages.state;
      s.taxCents += tax;
      states.set(c.state, s);
    }
  }
  out.socialSecurityWagesCents = Math.min(out.socialSecurityWagesCents, base);
  out.states = [...states.values()].sort((a, b) => a.state.localeCompare(b.state));
  return out;
}

export interface W3 {
  year: number;
  forms: number;
  wagesCents: number; federalCents: number; socialSecurityWagesCents: number; socialSecurityCents: number;
  medicareWagesCents: number; medicareCents: number; box12: Record<string, number>;
  states: W2State[];
}

export function w3(year: number, forms: W2[]): W3 {
  const out: W3 = { year, forms: forms.length, wagesCents: 0, federalCents: 0, socialSecurityWagesCents: 0, socialSecurityCents: 0, medicareWagesCents: 0, medicareCents: 0, box12: {}, states: [] };
  const states = new Map<string, W2State>();
  for (const f of forms) {
    out.wagesCents += f.wagesCents;
    out.federalCents += f.federalCents;
    out.socialSecurityWagesCents += f.socialSecurityWagesCents;
    out.socialSecurityCents += f.socialSecurityCents;
    out.medicareWagesCents += f.medicareWagesCents;
    out.medicareCents += f.medicareCents;
    for (const [k, v] of Object.entries(f.box12)) out.box12[k] = (out.box12[k] ?? 0) + v;
    for (const s of f.states) {
      const t = states.get(s.state) ?? { state: s.state, wagesCents: 0, taxCents: 0 };
      t.wagesCents += s.wagesCents;
      t.taxCents += s.taxCents;
      states.set(s.state, t);
    }
  }
  out.states = [...states.values()].sort((a, b) => a.state.localeCompare(b.state));
  return out;
}

/* -------------------------------------------------------------- Form 941 */

export interface Form941 {
  year: number;
  quarter: number;
  /** Line 1: employees paid for the pay period that includes the 12th of the quarter's last month. */
  employees: number;
  /** Line 2 */ wagesCents: number;
  /** Line 3 */ federalCents: number;
  /** Line 5a column 1 and 2 (12.4%) */ socialSecurityWagesCents: number; socialSecurityTaxCents: number;
  /** Line 5c column 1 and 2 (2.9%) */ medicareWagesCents: number; medicareTaxCents: number;
  /** Line 5d: wages past $200,000 for an employee this year, and 0.9% of them. */ additionalMedicareWagesCents: number; additionalMedicareTaxCents: number;
  /** Line 5e */ ficaTaxCents: number;
  /** Line 6 */ totalBeforeAdjustmentsCents: number;
  /** Line 7: what was really withheld and owed versus the line 5 rates, from rounding each paycheck. */ fractionsOfCentsCents: number;
  /** Line 10 and 12 */ totalTaxCents: number;
  /** Line 16: tax liability by month of the quarter, by pay date (monthly schedule depositors). */ months: [number, number, number];
}

export function form941(year: number, quarter: number, checks: PaidCheck[]): Form941 {
  const yearChecks = checks.filter((c) => c.payDate.startsWith(String(year))).sort(byDate);
  const t = taxYear(year).table;
  const ssBase = t.socialSecurityWageBase * 100;
  const addlThreshold = t.additionalMedicareThreshold * 100;
  const out: Form941 = {
    year, quarter, employees: 0, wagesCents: 0, federalCents: 0, socialSecurityWagesCents: 0, socialSecurityTaxCents: 0,
    medicareWagesCents: 0, medicareTaxCents: 0, additionalMedicareWagesCents: 0, additionalMedicareTaxCents: 0, ficaTaxCents: 0,
    totalBeforeAdjustmentsCents: 0, fractionsOfCentsCents: 0, totalTaxCents: 0, months: [0, 0, 0],
  };
  const ssSoFar = new Map<string, number>();
  const medSoFar = new Map<string, number>();
  let actual = 0;
  const lastMonth = quarter * 3;
  const twelfth = `${year}-${String(lastMonth).padStart(2, "0")}-12`;
  const onTwelfth = new Set<string>();
  for (const c of yearChecks) {
    const r = c.result;
    const ssPrev = ssSoFar.get(c.employeeId) ?? 0;
    const ssWages = Math.max(0, Math.min(r.wages.socialSecurity, ssBase - ssPrev));
    ssSoFar.set(c.employeeId, ssPrev + r.wages.socialSecurity);
    const medPrev = medSoFar.get(c.employeeId) ?? 0;
    const addl = Math.max(0, medPrev + r.wages.medicare - Math.max(addlThreshold, medPrev));
    medSoFar.set(c.employeeId, medPrev + r.wages.medicare);
    if (quarterOf(c.payDate) !== quarter) continue;

    if (c.periodStart <= twelfth && c.periodEnd >= twelfth) onTwelfth.add(c.employeeId);
    out.wagesCents += r.wages.federal;
    const fed = sumLines(r.taxes, "federal");
    out.federalCents += fed;
    out.socialSecurityWagesCents += ssWages;
    out.medicareWagesCents += r.wages.medicare;
    out.additionalMedicareWagesCents += addl;
    const fica = sumLines(r.taxes, "social_security") + sumLines(r.employerTaxes, "social_security")
      + sumLines(r.taxes, "medicare") + sumLines(r.employerTaxes, "medicare");
    actual += fed + fica;
    out.months[(Number(c.payDate.slice(5, 7)) - 1) % 3] += fed + fica;
  }
  out.employees = onTwelfth.size;
  out.socialSecurityTaxCents = Math.round(out.socialSecurityWagesCents * 0.124);
  out.medicareTaxCents = Math.round(out.medicareWagesCents * 0.029);
  out.additionalMedicareTaxCents = Math.round(out.additionalMedicareWagesCents * 0.009);
  out.ficaTaxCents = out.socialSecurityTaxCents + out.medicareTaxCents + out.additionalMedicareTaxCents;
  out.totalBeforeAdjustmentsCents = out.federalCents + out.ficaTaxCents;
  out.fractionsOfCentsCents = actual - out.totalBeforeAdjustmentsCents;
  out.totalTaxCents = out.totalBeforeAdjustmentsCents + out.fractionsOfCentsCents;
  return out;
}

/* -------------------------------------------------------------- Form 940 */

export interface Form940 {
  year: number;
  /** Line 3: all payments to employees. */ totalPaymentsCents: number;
  /** Line 4: payments exempt from FUTA (Section 125 benefits). */ exemptCents: number;
  /** Line 5: each employee's payments past the $7,000 FUTA wage base. */ overBaseCents: number;
  /** Line 7 */ taxableWagesCents: number;
  /** Line 8 (and 12, with no credit reduction): 0.6% of line 7. */ futaTaxCents: number;
  /** Line 16: liability by quarter, from what each paycheck accrued. */ quarters: [number, number, number, number];
}

export function form940(year: number, checks: PaidCheck[]): Form940 {
  const base = taxYear(year).table.futaWageBase * 100;
  const out: Form940 = { year, totalPaymentsCents: 0, exemptCents: 0, overBaseCents: 0, taxableWagesCents: 0, futaTaxCents: 0, quarters: [0, 0, 0, 0] };
  const perEmployee = new Map<string, number>();
  for (const c of checks.filter((x) => x.payDate.startsWith(String(year)))) {
    const r = c.result;
    out.totalPaymentsCents += r.grossCents;
    out.exemptCents += r.grossCents - r.wages.futa;
    perEmployee.set(c.employeeId, (perEmployee.get(c.employeeId) ?? 0) + r.wages.futa);
    out.quarters[quarterOf(c.payDate) - 1] += sumLines(r.employerTaxes, "futa");
  }
  for (const w of perEmployee.values()) out.overBaseCents += Math.max(0, w - base);
  out.taxableWagesCents = out.totalPaymentsCents - out.exemptCents - out.overBaseCents;
  out.futaTaxCents = Math.round(out.taxableWagesCents * taxYear(year).table.futaRate);
  return out;
}

/* ------------------------------------------------- state quarterly summary */

export interface StateQuarter {
  state: string;
  employees: number;
  /** Wages subject to state income tax, and the tax withheld. */ wagesCents: number; withheldCents: number;
  /** Gross wages for the unemployment report, and the employer unemployment tax accrued. */ grossCents: number; sutaCents: number;
}

export function stateQuarter(year: number, quarter: number, checks: PaidCheck[]): StateQuarter[] {
  const out = new Map<string, StateQuarter & { people: Set<string> }>();
  for (const c of checks) {
    if (!c.payDate.startsWith(String(year)) || quarterOf(c.payDate) !== quarter || !c.state) continue;
    const s = out.get(c.state) ?? { state: c.state, employees: 0, wagesCents: 0, withheldCents: 0, grossCents: 0, sutaCents: 0, people: new Set<string>() };
    s.people.add(c.employeeId);
    s.wagesCents += c.result.wages.state;
    s.withheldCents += sumLines(c.result.taxes, "state");
    s.grossCents += c.result.grossCents;
    s.sutaCents += sumLines(c.result.employerTaxes, "suta");
    out.set(c.state, s);
  }
  return [...out.values()].map(({ people, ...s }) => ({ ...s, employees: people.size })).sort((a, b) => a.state.localeCompare(b.state));
}
