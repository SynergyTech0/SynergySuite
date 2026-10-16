import { type W4, federalWithholding, futa, medicare, socialSecurity, taxYear } from "./federal";
import { type StateW4, stateTable, stateWithholding } from "./state";

/**
 * One paycheck, worked out from the employee's pay setup, the hours for the period and what they
 * have already been paid this year. Pure: no database, so every rule here has a unit test.
 */

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

export const PERIODS_PER_YEAR: Record<PayFrequency, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

export const FREQUENCY_LABELS: Record<PayFrequency, string> = {
  weekly: "Every week", biweekly: "Every two weeks", semimonthly: "Twice a month", monthly: "Every month",
};

/** Usual hours in one pay period for a full-time employee (2,080 hours a year). */
export function standardHours(f: PayFrequency): number {
  return Math.round((2080 / PERIODS_PER_YEAR[f]) * 100) / 100;
}

export type DeductionKind = "pretax_retirement" | "pretax_benefit" | "roth_retirement" | "posttax";

export const DEDUCTION_KIND_LABELS: Record<DeductionKind, string> = {
  pretax_retirement: "Pre-tax retirement (401(k), 403(b))",
  pretax_benefit: "Pre-tax benefit (Section 125: health, dental, vision, FSA, HSA)",
  roth_retirement: "Roth retirement (after tax)",
  posttax: "After-tax deduction (garnishment, loan, union dues)",
};

export interface Deduction {
  id: string;
  name: string;
  kind: DeductionKind;
  /** A fixed amount each paycheck, in cents, or null when it is a percent of gross pay. */
  amountCents: number | null;
  /** Percent of gross pay (5 = 5%), used when amountCents is null. */
  percent: number | null;
  /** Employer match: percent of what the employee puts in (100 = dollar for dollar). */
  matchPercent: number;
  /** The match stops at this percent of the employee's gross pay. 0 = no cap. */
  matchCapPercent: number;
  /** Most the employee puts in a year, in cents; 0 = no limit. */
  annualLimitCents: number;
}

export interface PayProfile {
  payType: "salary" | "hourly";
  annualSalaryCents: number;
  hourlyRateCents: number;
  w4: W4;
  /** Two-letter work state. */
  state: string;
  /** "table": the state's own withholding formula; "flat": stateRatePercent of taxable wages. */
  stateMethod: "table" | "flat";
  stateRatePercent: number;
  /** The state withholding certificate; defaults to the federal filing status and no allowances. */
  stateW4?: StateW4;
  deductions: Deduction[];
}

export interface Hours {
  regular: number;
  overtime: number;
  pto: number;
  holiday: number;
  sick: number;
  bonusCents: number;
  /** Share of a salaried period's pay: 1 normally, less for someone who started or left mid-period, 0 for a bonus-only run. */
  salaryFraction?: number;
}

export interface CompanyRules {
  frequency: PayFrequency;
  overtimeMultiplier: number;
  /** State unemployment (employer), percent of wages up to the wage base. */
  sutaRatePercent: number;
  sutaWageBaseCents: number;
}

/** Totals paid so far this calendar year, before this paycheck. */
export interface YearToDate {
  grossCents: number;
  socialSecurityWagesCents: number;
  medicareWagesCents: number;
  futaWagesCents: number;
  /** Per deduction id, cents the employee has put in. */
  deductions: Record<string, number>;
}

export const EMPTY_YTD: YearToDate = { grossCents: 0, socialSecurityWagesCents: 0, medicareWagesCents: 0, futaWagesCents: 0, deductions: {} };

export interface Line {
  code: string;
  label: string;
  amountCents: number;
  hours?: number;
  rateCents?: number;
}

export interface DeductionLine extends Line {
  kind: DeductionKind;
  /** The employer's matching contribution for this deduction. */
  employerCents: number;
}

export interface Paycheck {
  earnings: Line[];
  deductions: DeductionLine[];
  taxes: Line[];
  employerTaxes: Line[];
  grossCents: number;
  /** Everything taken out of the employee's pay: deductions and taxes. */
  deductionsCents: number;
  taxesCents: number;
  netCents: number;
  employerTaxesCents: number;
  employerBenefitsCents: number;
  wages: { federal: number; socialSecurity: number; medicare: number; futa: number; state: number };
  taxYear: number;
  warnings: string[];
}

/** States whose income tax applies to pre-tax retirement deferrals. */
const RETIREMENT_TAXED_STATES = new Set(["PA"]);

const pct = (cents: number, percent: number) => Math.round((cents * percent) / 100);

export function computePaycheck(p: PayProfile, h: Hours, rules: CompanyRules, ytd: YearToDate, payDate: string): Paycheck {
  const warnings: string[] = [];
  const periods = PERIODS_PER_YEAR[rules.frequency];
  const year = Number(payDate.slice(0, 4));
  const { table, exact } = taxYear(year);
  if (!exact) warnings.push(`No ${year} federal tax figures yet; used ${table.year}.`);

  // ---- earnings ----
  const hourly = p.payType === "hourly" ? p.hourlyRateCents : Math.round(p.annualSalaryCents / 2080);
  const earnings: Line[] = [];
  if (p.payType === "salary") {
    const fraction = Math.min(1, Math.max(0, h.salaryFraction ?? 1));
    if (fraction > 0) {
      const label = fraction < 1 ? `Salary (${Math.round(fraction * 100)}% of the period)` : "Salary";
      earnings.push({ code: "salary", label, amountCents: Math.round((p.annualSalaryCents / periods) * fraction) });
    }
    // Salaried time off is paid as part of salary; it is shown for the record only.
    if (h.pto) earnings.push({ code: "pto", label: "Time off (in salary)", hours: h.pto, amountCents: 0 });
    if (h.holiday) earnings.push({ code: "holiday", label: "Holiday (in salary)", hours: h.holiday, amountCents: 0 });
    if (h.sick) earnings.push({ code: "sick", label: "Sick (in salary)", hours: h.sick, amountCents: 0 });
  } else {
    earnings.push({ code: "regular", label: "Regular", hours: h.regular, rateCents: hourly, amountCents: Math.round(h.regular * hourly) });
    if (h.pto) earnings.push({ code: "pto", label: "Time off", hours: h.pto, rateCents: hourly, amountCents: Math.round(h.pto * hourly) });
    if (h.holiday) earnings.push({ code: "holiday", label: "Holiday", hours: h.holiday, rateCents: hourly, amountCents: Math.round(h.holiday * hourly) });
    if (h.sick) earnings.push({ code: "sick", label: "Sick", hours: h.sick, rateCents: hourly, amountCents: Math.round(h.sick * hourly) });
  }
  if (h.overtime) {
    const rate = Math.round(hourly * rules.overtimeMultiplier);
    earnings.push({ code: "overtime", label: "Overtime", hours: h.overtime, rateCents: rate, amountCents: Math.round(h.overtime * rate) });
  }
  if (h.bonusCents) earnings.push({ code: "bonus", label: "Bonus", amountCents: h.bonusCents });
  const gross = earnings.reduce((s, e) => s + e.amountCents, 0);

  // ---- deductions ----
  const deductions: DeductionLine[] = [];
  for (const d of p.deductions) {
    let amount = d.amountCents != null ? d.amountCents : pct(gross, d.percent ?? 0);
    if (d.annualLimitCents > 0) {
      const room = Math.max(0, d.annualLimitCents - (ytd.deductions[d.id] ?? 0));
      if (amount > room) {
        amount = room;
        warnings.push(`${d.name} reached its yearly limit.`);
      }
    }
    amount = Math.max(0, Math.min(amount, gross));
    let employer = 0;
    if (d.matchPercent > 0 && amount > 0) {
      employer = pct(amount, d.matchPercent);
      if (d.matchCapPercent > 0) employer = Math.min(employer, pct(gross, d.matchCapPercent));
    }
    deductions.push({ code: d.id, label: d.name, kind: d.kind, amountCents: amount, employerCents: employer });
  }
  const sum = (kinds: DeductionKind[]) => deductions.filter((d) => kinds.includes(d.kind)).reduce((s, d) => s + d.amountCents, 0);
  const section125 = sum(["pretax_benefit"]);
  const retirement = sum(["pretax_retirement"]);

  // ---- taxable wages ----
  // Section 125 benefits are free of income tax, FICA and FUTA; pre-tax retirement only of income tax.
  const fitWages = Math.max(0, gross - section125 - retirement);
  const ficaWages = Math.max(0, gross - section125);

  // ---- employee taxes ----
  const fit = federalWithholding(fitWages, periods, p.w4, table);
  const ss = socialSecurity(ficaWages, ytd.socialSecurityWagesCents, table);
  const med = medicare(ficaWages, ytd.medicareWagesCents, table);
  // Pennsylvania taxes 401(k) deferrals; the other states follow the federal treatment.
  const stateWages = RETIREMENT_TAXED_STATES.has(p.state.toUpperCase()) ? ficaWages : fitWages;
  let stateTax = 0;
  if (p.stateMethod === "flat") {
    stateTax = pct(stateWages, p.stateRatePercent);
  } else if (p.state) {
    const st = stateTable(p.state);
    if (!st) {
      warnings.push(`No withholding table for ${p.state.toUpperCase()}; no state tax taken. Set a flat rate on the pay profile.`);
    } else {
      if (st.year < year) warnings.push(`No ${year} ${p.state.toUpperCase()} withholding figures yet; used ${st.year}.`);
      const sw4: StateW4 = p.stateW4 ?? { filingStatus: p.w4.filingStatus, allowances: 0, extraWithholding: 0 };
      stateTax = stateWithholding(stateWages, periods, sw4, st, fit);
    }
  }
  const taxes: Line[] = [
    { code: "federal", label: "Federal income tax", amountCents: fit },
    { code: "social_security", label: "Social Security", amountCents: ss },
    { code: "medicare", label: "Medicare", amountCents: med.employee },
  ];
  if (stateTax) taxes.push({ code: "state", label: `${p.state || "State"} income tax`, amountCents: stateTax });

  // ---- employer taxes ----
  const futaTax = futa(ficaWages, ytd.futaWagesCents, table);
  const sutaRoom = rules.sutaWageBaseCents > 0 ? Math.max(0, rules.sutaWageBaseCents - ytd.futaWagesCents) : ficaWages;
  const suta = pct(Math.min(ficaWages, sutaRoom), rules.sutaRatePercent);
  const employerTaxes: Line[] = [
    { code: "social_security", label: "Social Security (employer)", amountCents: ss },
    { code: "medicare", label: "Medicare (employer)", amountCents: med.employer },
    { code: "futa", label: "Federal unemployment (FUTA)", amountCents: futaTax },
  ];
  if (suta) employerTaxes.push({ code: "suta", label: `${p.state || "State"} unemployment (SUTA)`, amountCents: suta });

  const deductionsCents = deductions.reduce((s, d) => s + d.amountCents, 0);
  const taxesCents = taxes.reduce((s, t) => s + t.amountCents, 0);
  const netCents = gross - deductionsCents - taxesCents;
  if (netCents < 0) warnings.push("Deductions and taxes are more than this paycheck. Lower a deduction before approving.");

  return {
    earnings,
    deductions,
    taxes,
    employerTaxes,
    grossCents: gross,
    deductionsCents,
    taxesCents,
    netCents,
    employerTaxesCents: employerTaxes.reduce((s, t) => s + t.amountCents, 0),
    employerBenefitsCents: deductions.reduce((s, d) => s + d.employerCents, 0),
    wages: { federal: fitWages, socialSecurity: ficaWages, medicare: ficaWages, futa: ficaWages, state: stateWages },
    taxYear: table.year,
    warnings,
  };
}

/** Adds one paycheck to the year-to-date totals that the next one starts from. */
export function addToYtd(ytd: YearToDate, pc: Paycheck): YearToDate {
  const deductions = { ...ytd.deductions };
  for (const d of pc.deductions) deductions[d.code] = (deductions[d.code] ?? 0) + d.amountCents;
  return {
    grossCents: ytd.grossCents + pc.grossCents,
    socialSecurityWagesCents: ytd.socialSecurityWagesCents + pc.wages.socialSecurity,
    medicareWagesCents: ytd.medicareWagesCents + pc.wages.medicare,
    futaWagesCents: ytd.futaWagesCents + pc.wages.futa,
    deductions,
  };
}
