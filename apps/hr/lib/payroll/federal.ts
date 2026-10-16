/**
 * US federal payroll taxes: income tax withholding for Forms W-4 from 2020 on (IRS Publication
 * 15-T, percentage method for automated payroll), Social Security, Medicare and FUTA.
 *
 * The percentage method annualizes the period's wages, takes off the standard deduction for the
 * filing status (half of it, with half-width brackets, when the W-4 Step 2 box is checked), applies
 * the year's tax brackets and divides back to the period. That is the same arithmetic as the
 * Publication 15-T worksheet and tables, written from the brackets instead of the printed table.
 *
 * Each tax year is one entry in TAX_YEARS. A year that isn't listed uses the latest one, and the
 * paycheck says so, so a new year's figures are a one-entry change.
 */

export type FilingStatus = "single" | "married" | "head";

export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  single: "Single or married filing separately",
  married: "Married filing jointly",
  head: "Head of household",
};

/** [upper bound of the bracket in dollars (Infinity for the last), rate]. */
type Brackets = [number, number][];

export interface TaxYear {
  year: number;
  /** Standard deduction in dollars. */
  standardDeduction: Record<FilingStatus, number>;
  brackets: Record<FilingStatus, Brackets>;
  socialSecurityRate: number;
  /** Social Security stops at this much wages in a calendar year (dollars). */
  socialSecurityWageBase: number;
  medicareRate: number;
  /** Employee-only extra Medicare on wages over the threshold in the year. */
  additionalMedicareRate: number;
  additionalMedicareThreshold: number;
  /** FUTA after the usual full credit for state unemployment tax. */
  futaRate: number;
  futaWageBase: number;
  /** Where the figures come from. */
  source: string;
}

const INF = Number.POSITIVE_INFINITY;

export const TAX_YEARS: Record<number, TaxYear> = {
  2026: {
    year: 2026,
    standardDeduction: { single: 16_100, married: 32_200, head: 24_150 },
    brackets: {
      single: [[12_400, 0.1], [50_400, 0.12], [105_700, 0.22], [201_775, 0.24], [256_225, 0.32], [640_600, 0.35], [INF, 0.37]],
      married: [[24_800, 0.1], [100_800, 0.12], [211_400, 0.22], [403_550, 0.24], [512_450, 0.32], [768_700, 0.35], [INF, 0.37]],
      head: [[17_700, 0.1], [67_450, 0.12], [105_700, 0.22], [201_750, 0.24], [256_200, 0.32], [640_600, 0.35], [INF, 0.37]],
    },
    socialSecurityRate: 0.062,
    socialSecurityWageBase: 184_500,
    medicareRate: 0.0145,
    additionalMedicareRate: 0.009,
    additionalMedicareThreshold: 200_000,
    futaRate: 0.006,
    futaWageBase: 7_000,
    source: "IRS Rev. Proc. 2025-32 (brackets and standard deduction), SSA 2026 wage base",
  },
};

export function taxYear(year: number): { table: TaxYear; exact: boolean } {
  if (TAX_YEARS[year]) return { table: TAX_YEARS[year], exact: true };
  const known = Object.keys(TAX_YEARS).map(Number).sort((a, b) => a - b);
  const pick = known.filter((y) => y <= year).pop() ?? known[0];
  return { table: TAX_YEARS[pick], exact: false };
}

/** Tax on `taxable` dollars through progressive brackets, each width scaled by `scale`. */
function bracketTax(taxable: number, brackets: Brackets, scale = 1): number {
  let tax = 0;
  let floor = 0;
  for (const [top, rate] of brackets) {
    const ceiling = top === INF ? INF : top * scale;
    if (taxable <= floor) break;
    tax += (Math.min(taxable, ceiling) - floor) * rate;
    floor = ceiling;
  }
  return tax;
}

/** Form W-4 (2020 and later) as the employee filled it in. Dollar amounts are annual except extra withholding. */
export interface W4 {
  filingStatus: FilingStatus;
  /** Step 2: multiple jobs or spouse works, box checked. */
  multipleJobs: boolean;
  /** Step 3: credits for dependents, annual dollars. */
  dependents: number;
  /** Step 4(a): other income, annual dollars. */
  otherIncome: number;
  /** Step 4(b): deductions, annual dollars. */
  deductions: number;
  /** Step 4(c): extra withholding each pay period, dollars. */
  extraWithholding: number;
  /** "Exempt" written on the form: no income tax withheld (FICA still applies). */
  exempt?: boolean;
}

export const DEFAULT_W4: W4 = { filingStatus: "single", multipleJobs: false, dependents: 0, otherIncome: 0, deductions: 0, extraWithholding: 0 };

/**
 * Federal income tax to withhold from one paycheck, in cents.
 * `wagesCents` is the period's wages subject to income tax (after pre-tax deductions).
 */
export function federalWithholding(wagesCents: number, periodsPerYear: number, w4: W4, table: TaxYear): number {
  if (w4.exempt || wagesCents <= 0) return 0;
  const annual = (wagesCents / 100) * periodsPerYear + w4.otherIncome - w4.deductions;
  const half = w4.multipleJobs ? 0.5 : 1;
  const taxable = Math.max(0, annual - table.standardDeduction[w4.filingStatus] * half);
  const annualTax = bracketTax(taxable, table.brackets[w4.filingStatus], half);
  const perPeriod = Math.max(0, annualTax / periodsPerYear - w4.dependents / periodsPerYear);
  return Math.round((perPeriod + w4.extraWithholding) * 100);
}

/** Social Security on this paycheck, stopping at the year's wage base. Same amount for employee and employer. */
export function socialSecurity(wagesCents: number, ytdWagesCents: number, table: TaxYear): number {
  const room = Math.max(0, table.socialSecurityWageBase * 100 - ytdWagesCents);
  return Math.round(Math.min(wagesCents, room) * table.socialSecurityRate);
}

/** Medicare: employee share includes the additional 0.9% on wages past the threshold for the year. */
export function medicare(wagesCents: number, ytdWagesCents: number, table: TaxYear): { employee: number; employer: number } {
  const base = wagesCents * table.medicareRate;
  const threshold = table.additionalMedicareThreshold * 100;
  const over = Math.max(0, ytdWagesCents + wagesCents - Math.max(threshold, ytdWagesCents));
  return { employee: Math.round(base + over * table.additionalMedicareRate), employer: Math.round(base) };
}

/** Employer FUTA on this paycheck. */
export function futa(wagesCents: number, ytdWagesCents: number, table: TaxYear): number {
  const room = Math.max(0, table.futaWageBase * 100 - ytdWagesCents);
  return Math.round(Math.min(wagesCents, room) * table.futaRate);
}

/** States with no tax on wages, so no state withholding is suggested for them. */
export const NO_WAGE_TAX_STATES = new Set(["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"]);
