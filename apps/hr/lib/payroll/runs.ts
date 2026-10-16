import { audit, q, tx, type Tq } from "../db";
import { addDays, businessDays, businessDaysWithin, isDay } from "../days";
import { holidayDays, type Viewer } from "../hr";
import { UserError, cents, num, oneOf, text } from "../util";
import { booksConfigured, postJournal } from "../books";
import {
  type CompanyRules, type Deduction, type DeductionKind, type Hours, type PayFrequency, type PayProfile, type Paycheck, type YearToDate,
  EMPTY_YTD, PERIODS_PER_YEAR, addToYtd, computePaycheck, standardHours,
} from "./calc";
import type { FilingStatus } from "./federal";
import { DEFAULT_ACCOUNTS, type PayrollAccounts, type RunTotals, payrollJournal, runTotals } from "./journal";

type Body = Record<string, unknown>;

export function requirePayroll(v: Viewer): void {
  if (!v.roles.payrollAdmin) throw new UserError("Only payroll admins can do that", 403);
}

/* ---------------------------------------------------------------- settings */

export interface Settings {
  companyName: string;
  frequency: PayFrequency;
  overtimeMultiplier: number;
  sutaRatePercent: number;
  sutaWageBaseCents: number;
  accounts: PayrollAccounts;
  booksOrg: string;
  booksConnected: boolean;
}

export async function getSettings(): Promise<Settings> {
  const [r] = await q<{
    company_name: string; frequency: PayFrequency; overtime_multiplier: string; suta_rate: string; suta_wage_base_cents: string;
    accounts: Partial<PayrollAccounts>; books_org: string;
  }>("SELECT * FROM pay_settings WHERE id = 1");
  return {
    companyName: r.company_name,
    frequency: r.frequency,
    overtimeMultiplier: Number(r.overtime_multiplier),
    sutaRatePercent: Number(r.suta_rate),
    sutaWageBaseCents: Number(r.suta_wage_base_cents),
    accounts: { ...DEFAULT_ACCOUNTS, ...r.accounts },
    booksOrg: r.books_org,
    booksConnected: booksConfigured(),
  };
}

const FREQUENCIES = ["weekly", "biweekly", "semimonthly", "monthly"] as const;
const ACCOUNT_NUMBER = /^[A-Za-z0-9.-]{1,20}$/;

export async function saveSettings(v: Viewer, b: Body): Promise<Settings> {
  requirePayroll(v);
  const cur = await getSettings();
  const accounts = { ...cur.accounts };
  const given = (b.accounts ?? {}) as Partial<Record<keyof PayrollAccounts, unknown>>;
  for (const k of Object.keys(DEFAULT_ACCOUNTS) as (keyof PayrollAccounts)[]) {
    if (given[k] === undefined) continue;
    const n = String(given[k]).trim();
    if (!ACCOUNT_NUMBER.test(n)) throw new UserError("Account numbers are letters, digits, dots and dashes");
    accounts[k] = n;
  }
  await q(
    `UPDATE pay_settings SET company_name = $1, frequency = $2, overtime_multiplier = $3, suta_rate = $4, suta_wage_base_cents = $5,
       accounts = $6, books_org = $7, updated_at = now(), updated_by = $8 WHERE id = 1`,
    [
      "companyName" in b ? text(b.companyName, 200) : cur.companyName,
      "frequency" in b ? oneOf(b.frequency, FREQUENCIES, cur.frequency) : cur.frequency,
      "overtimeMultiplier" in b ? num(b.overtimeMultiplier, "Overtime rate", 1.5, { min: 1, max: 3 }) : cur.overtimeMultiplier,
      "sutaRatePercent" in b ? num(b.sutaRatePercent, "SUTA rate", 0, { min: 0, max: 20 }) : cur.sutaRatePercent,
      "sutaWageBase" in b ? cents(b.sutaWageBase, "SUTA wage base") : cur.sutaWageBaseCents,
      JSON.stringify(accounts),
      "booksOrg" in b ? text(b.booksOrg, 100) : cur.booksOrg,
      v.email,
    ],
  );
  await audit(v.email, "payroll.settings", "", { fields: Object.keys(b) });
  return getSettings();
}

/* ----------------------------------------------------------- pay profiles */

export interface ProfileView {
  employeeId: string;
  inPayroll: boolean;
  payType: "salary" | "hourly";
  annualSalaryCents: number;
  hourlyRateCents: number;
  filingStatus: FilingStatus;
  multipleJobs: boolean;
  dependentsCents: number;
  otherIncomeCents: number;
  deductionsCents: number;
  extraWithholdingCents: number;
  w4Exempt: boolean;
  workState: string;
  stateMethod: "table" | "flat";
  stateRatePercent: number;
  /** '' = same as the federal W-4. */
  stateFilingStatus: FilingStatus | "";
  stateAllowances: number;
  stateExtraWithholdingCents: number;
  stateExempt: boolean;
  paymentMethod: "direct_deposit" | "check";
  accountLast4: string;
  updatedAt: string | null;
  updatedBy: string;
  deductions: Deduction[];
  /** False until someone saves pay details for this person. */
  saved: boolean;
}

type ProfileRow = {
  employee_id: string; in_payroll: boolean; pay_type: "salary" | "hourly"; annual_salary_cents: string; hourly_rate_cents: string;
  filing_status: FilingStatus; multiple_jobs: boolean; dependents_cents: string; other_income_cents: string; deductions_cents: string;
  extra_withholding_cents: string; w4_exempt: boolean; work_state: string; state_rate: string;
  state_method: "table" | "flat"; state_filing_status: FilingStatus | ""; state_allowances: number; state_extra_withholding_cents: string; state_exempt: boolean;
  payment_method: "direct_deposit" | "check";
  account_last4: string; updated_at: Date; updated_by: string;
};

type DeductionRow = {
  id: string; employee_id: string; name: string; kind: DeductionKind; amount_cents: string | null; percent: string | null;
  match_percent: string; match_cap_percent: string; annual_limit_cents: string;
};

function toDeduction(r: DeductionRow): Deduction {
  return {
    id: r.id, name: r.name, kind: r.kind,
    amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
    percent: r.percent === null ? null : Number(r.percent),
    matchPercent: Number(r.match_percent), matchCapPercent: Number(r.match_cap_percent), annualLimitCents: Number(r.annual_limit_cents),
  };
}

function toView(employeeId: string, r: ProfileRow | undefined, deductions: Deduction[]): ProfileView {
  return {
    employeeId,
    inPayroll: r?.in_payroll ?? false,
    payType: r?.pay_type ?? "salary",
    annualSalaryCents: Number(r?.annual_salary_cents ?? 0),
    hourlyRateCents: Number(r?.hourly_rate_cents ?? 0),
    filingStatus: r?.filing_status ?? "single",
    multipleJobs: r?.multiple_jobs ?? false,
    dependentsCents: Number(r?.dependents_cents ?? 0),
    otherIncomeCents: Number(r?.other_income_cents ?? 0),
    deductionsCents: Number(r?.deductions_cents ?? 0),
    extraWithholdingCents: Number(r?.extra_withholding_cents ?? 0),
    w4Exempt: r?.w4_exempt ?? false,
    workState: r?.work_state ?? "",
    stateMethod: r?.state_method ?? "table",
    stateRatePercent: Number(r?.state_rate ?? 0),
    stateFilingStatus: r?.state_filing_status ?? "",
    stateAllowances: Number(r?.state_allowances ?? 0),
    stateExtraWithholdingCents: Number(r?.state_extra_withholding_cents ?? 0),
    stateExempt: r?.state_exempt ?? false,
    paymentMethod: r?.payment_method ?? "direct_deposit",
    accountLast4: r?.account_last4 ?? "",
    updatedAt: r?.updated_at?.toISOString() ?? null,
    updatedBy: r?.updated_by ?? "",
    deductions,
    saved: Boolean(r),
  };
}

function toCalc(p: ProfileView): PayProfile {
  return {
    payType: p.payType,
    annualSalaryCents: p.annualSalaryCents,
    hourlyRateCents: p.hourlyRateCents,
    w4: {
      filingStatus: p.filingStatus,
      multipleJobs: p.multipleJobs,
      dependents: p.dependentsCents / 100,
      otherIncome: p.otherIncomeCents / 100,
      deductions: p.deductionsCents / 100,
      extraWithholding: p.extraWithholdingCents / 100,
      exempt: p.w4Exempt,
    },
    state: p.workState,
    stateMethod: p.stateMethod,
    stateRatePercent: p.stateRatePercent,
    stateW4: {
      filingStatus: p.stateFilingStatus || p.filingStatus,
      allowances: p.stateAllowances,
      extraWithholding: p.stateExtraWithholdingCents / 100,
      exempt: p.stateExempt,
    },
    deductions: p.deductions,
  };
}

async function profiles(employeeIds: string[], run: Tq = q): Promise<Map<string, ProfileView>> {
  const [rows, deds] = await Promise.all([
    run<ProfileRow>("SELECT *, employee_id::text AS employee_id FROM pay_profiles WHERE employee_id::text = ANY($1)", [employeeIds]),
    run<DeductionRow>("SELECT *, employee_id::text AS employee_id FROM pay_deductions WHERE active AND employee_id::text = ANY($1) ORDER BY created_at", [employeeIds]),
  ]);
  const out = new Map<string, ProfileView>();
  for (const id of employeeIds) {
    out.set(id, toView(id, rows.find((r) => r.employee_id === id), deds.filter((d) => d.employee_id === id).map(toDeduction)));
  }
  return out;
}

async function employeeExists(id: string): Promise<void> {
  if (!/^\d{1,18}$/.test(id) || !(await q("SELECT 1 FROM employees WHERE id = $1", [id])).length) throw new UserError("Not found", 404);
}

export async function getProfile(v: Viewer, employeeId: string): Promise<ProfileView> {
  requirePayroll(v);
  await employeeExists(employeeId);
  return (await profiles([employeeId])).get(employeeId)!;
}

export async function saveProfile(v: Viewer, employeeId: string, b: Body): Promise<ProfileView> {
  requirePayroll(v);
  await employeeExists(employeeId);
  const state = text(b.workState, 2).toUpperCase();
  if (state && !/^[A-Z]{2}$/.test(state)) throw new UserError("Work state is a two-letter code, like CA");
  // With bank details on file the account comes from there; otherwise a note of its last four.
  const [onFile] = await q<{ bank_last4: string }>("SELECT bank_last4 FROM pay_private WHERE employee_id = $1 AND bank_account_sealed <> ''", [employeeId]);
  const last4 = onFile ? onFile.bank_last4 : text(b.accountLast4, 4);
  if (last4 && !/^\d{4}$/.test(last4) && !onFile) throw new UserError("Keep only the last four digits of the account");
  const vals = {
    in_payroll: b.inPayroll === undefined ? true : Boolean(b.inPayroll),
    pay_type: oneOf(b.payType, ["salary", "hourly"] as const, "salary"),
    annual_salary_cents: cents(b.annualSalary, "Annual salary"),
    hourly_rate_cents: cents(b.hourlyRate, "Hourly rate"),
    filing_status: oneOf(b.filingStatus, ["single", "married", "head"] as const, "single"),
    multiple_jobs: Boolean(b.multipleJobs),
    dependents_cents: cents(b.dependents, "Dependents (Step 3)"),
    other_income_cents: cents(b.otherIncome, "Other income (Step 4a)"),
    deductions_cents: cents(b.deductions, "Deductions (Step 4b)"),
    extra_withholding_cents: cents(b.extraWithholding, "Extra withholding (Step 4c)"),
    w4_exempt: Boolean(b.w4Exempt),
    work_state: state,
    state_method: oneOf(b.stateMethod, ["table", "flat"] as const, "table"),
    state_rate: num(b.stateRatePercent, "State tax rate", 0, { min: 0, max: 20 }),
    state_filing_status: oneOf(b.stateFilingStatus, ["", "single", "married", "head"] as const, ""),
    state_allowances: Math.round(num(b.stateAllowances, "State allowances", 0, { min: 0, max: 99 })),
    state_extra_withholding_cents: cents(b.stateExtraWithholding, "Extra state withholding"),
    state_exempt: Boolean(b.stateExempt),
    payment_method: oneOf(b.paymentMethod, ["direct_deposit", "check"] as const, "direct_deposit"),
    account_last4: last4,
  };
  if (vals.pay_type === "salary" && vals.in_payroll && !vals.annual_salary_cents) throw new UserError("Enter the annual salary");
  if (vals.pay_type === "hourly" && vals.in_payroll && !vals.hourly_rate_cents) throw new UserError("Enter the hourly rate");
  const keys = Object.keys(vals) as (keyof typeof vals)[];
  await q(
    `INSERT INTO pay_profiles (employee_id, ${keys.join(", ")}, updated_by) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")}, $${keys.length + 2})
     ON CONFLICT (employee_id) DO UPDATE SET ${keys.map((k) => `${k} = EXCLUDED.${k}`).join(", ")}, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [employeeId, ...keys.map((k) => vals[k]), v.email],
  );
  // Pay amounts are not written to the audit log, only that they changed.
  await audit(v.email, "payroll.profile", employeeId, { fields: Object.keys(b) });
  return getProfile(v, employeeId);
}

function cleanDeduction(b: Body) {
  const name = text(b.name, 120);
  if (!name) throw new UserError("Name the deduction");
  const byPercent = b.percent !== undefined && b.percent !== null && b.percent !== "";
  return {
    name,
    kind: oneOf(b.kind, ["pretax_retirement", "pretax_benefit", "roth_retirement", "posttax"] as const, "posttax"),
    amount_cents: byPercent ? null : cents(b.amount, "Amount"),
    percent: byPercent ? num(b.percent, "Percent", 0, { min: 0, max: 100 }) : null,
    match_percent: num(b.matchPercent, "Employer match", 0, { min: 0, max: 1000 }),
    match_cap_percent: num(b.matchCapPercent, "Match cap", 0, { min: 0, max: 100 }),
    annual_limit_cents: cents(b.annualLimit, "Yearly limit"),
  };
}

export async function addDeduction(v: Viewer, employeeId: string, b: Body): Promise<ProfileView> {
  requirePayroll(v);
  await employeeExists(employeeId);
  const d = cleanDeduction(b);
  await q(
    `INSERT INTO pay_deductions (employee_id, name, kind, amount_cents, percent, match_percent, match_cap_percent, annual_limit_cents)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [employeeId, d.name, d.kind, d.amount_cents, d.percent, d.match_percent, d.match_cap_percent, d.annual_limit_cents],
  );
  await audit(v.email, "payroll.deduction.add", employeeId, { name: d.name, kind: d.kind });
  return getProfile(v, employeeId);
}

export async function updateDeduction(v: Viewer, id: string, b: Body): Promise<ProfileView> {
  requirePayroll(v);
  const d = cleanDeduction(b);
  const [row] = await q<{ employee_id: string }>(
    `UPDATE pay_deductions SET name = $2, kind = $3, amount_cents = $4, percent = $5, match_percent = $6, match_cap_percent = $7,
       annual_limit_cents = $8 WHERE id::text = $1 AND active RETURNING employee_id::text`,
    [id, d.name, d.kind, d.amount_cents, d.percent, d.match_percent, d.match_cap_percent, d.annual_limit_cents],
  );
  if (!row) throw new UserError("Not found", 404);
  await audit(v.email, "payroll.deduction.update", row.employee_id, { name: d.name });
  return getProfile(v, row.employee_id);
}

/** Stops a deduction. It stays on past pay stubs and keeps counting toward its year-to-date total. */
export async function endDeduction(v: Viewer, id: string): Promise<ProfileView> {
  requirePayroll(v);
  const [row] = await q<{ employee_id: string; name: string }>(
    "UPDATE pay_deductions SET active = false WHERE id::text = $1 RETURNING employee_id::text, name",
    [id],
  );
  if (!row) throw new UserError("Not found", 404);
  await audit(v.email, "payroll.deduction.end", row.employee_id, { name: row.name });
  return getProfile(v, row.employee_id);
}

/* ------------------------------------------------------------------- runs */

export type RunStatus = "draft" | "approved" | "paid" | "void";

export interface RunView {
  id: string; number: number; periodStart: string; periodEnd: string; payDate: string; frequency: PayFrequency; status: RunStatus;
  totals: RunTotals & { employees: number }; note: string; createdBy: string; createdAt: string; approvedBy: string | null; approvedAt: string | null;
  paidBy: string | null; paidAt: string | null; booksStatus: "none" | "posted" | "failed" | "off"; booksJournal: string | null; booksError: string | null;
}

export interface PaycheckView {
  id: string; runId: string; employeeId: string; employeeEmail: string; employeeName: string; hours: Hours;
  profile: Record<string, unknown>; result: Paycheck; grossCents: number; netCents: number;
}

type RunRow = {
  id: string; number: string; period_start: string; period_end: string; pay_date: string; frequency: PayFrequency; status: RunStatus;
  totals: Partial<RunView["totals"]>; note: string; created_by: string; created_at: Date; approved_by: string | null; approved_at: Date | null;
  paid_by: string | null; paid_at: Date | null; books_status: RunView["booksStatus"]; books_journal: string | null; books_error: string | null;
};

const RUN_COLS = `id, number, to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end,
  to_char(pay_date, 'YYYY-MM-DD') AS pay_date, frequency, status, totals, note, created_by, created_at, approved_by, approved_at,
  paid_by, paid_at, books_status, books_journal, books_error`;

function runView(r: RunRow): RunView {
  return {
    id: r.id, number: Number(r.number), periodStart: r.period_start, periodEnd: r.period_end, payDate: r.pay_date, frequency: r.frequency,
    status: r.status, totals: { ...emptyTotals(), employees: 0, ...r.totals }, note: r.note, createdBy: r.created_by,
    createdAt: r.created_at.toISOString(), approvedBy: r.approved_by, approvedAt: r.approved_at?.toISOString() ?? null, paidBy: r.paid_by,
    paidAt: r.paid_at?.toISOString() ?? null, booksStatus: r.books_status, booksJournal: r.books_journal, booksError: r.books_error,
  };
}

function emptyTotals(): RunTotals {
  return { grossCents: 0, deductionsCents: 0, taxesCents: 0, netCents: 0, employerTaxesCents: 0, employerBenefitsCents: 0 };
}

type CheckRow = {
  id: string; run_id: string; employee_id: string; employee_email: string; employee_name: string; hours: Hours; profile: Record<string, unknown>;
  result: Paycheck; gross_cents: string; net_cents: string;
};

function checkView(r: CheckRow): PaycheckView {
  return {
    id: r.id, runId: r.run_id, employeeId: r.employee_id, employeeEmail: r.employee_email, employeeName: r.employee_name, hours: r.hours,
    profile: r.profile, result: r.result, grossCents: Number(r.gross_cents), netCents: Number(r.net_cents),
  };
}

const CHECK_COLS = "id, run_id, employee_id::text AS employee_id, employee_email, employee_name, hours, profile, result, gross_cents, net_cents";

export async function listRuns(v: Viewer): Promise<RunView[]> {
  requirePayroll(v);
  return (await q<RunRow>(`SELECT ${RUN_COLS} FROM pay_runs ORDER BY pay_date DESC, number DESC LIMIT 200`)).map(runView);
}

async function loadRun(id: string, tq: Tq = q): Promise<RunView> {
  const [r] = await tq<RunRow>(`SELECT ${RUN_COLS} FROM pay_runs WHERE id::text = $1`, [id]);
  if (!r) throw new UserError("Not found", 404);
  return runView(r);
}

export async function getRun(v: Viewer, id: string): Promise<{ run: RunView; paychecks: PaycheckView[] }> {
  requirePayroll(v);
  const run = await loadRun(id);
  const checks = await q<CheckRow>(`SELECT ${CHECK_COLS} FROM paychecks WHERE run_id = $1 ORDER BY lower(employee_name)`, [id]);
  return { run, paychecks: checks.map(checkView) };
}

/** Year-to-date before this run, from approved and paid runs earlier in the same calendar year. */
async function ytdBefore(employeeIds: string[], payDate: string, number: number, tq: Tq): Promise<Map<string, YearToDate>> {
  const rows = await tq<{ employee_id: string; result: Paycheck }>(
    `SELECT p.employee_id::text AS employee_id, p.result FROM paychecks p JOIN pay_runs r ON r.id = p.run_id
     WHERE r.status IN ('approved','paid') AND p.employee_id::text = ANY($1)
       AND EXTRACT(YEAR FROM r.pay_date) = $2 AND (r.pay_date < $3 OR (r.pay_date = $3 AND r.number < $4))
     ORDER BY r.pay_date, r.number`,
    [employeeIds, Number(payDate.slice(0, 4)), payDate, number],
  );
  const out = new Map<string, YearToDate>();
  for (const r of rows) out.set(r.employee_id, addToYtd(out.get(r.employee_id) ?? EMPTY_YTD, r.result));
  return out;
}

const HOURS_PER_DAY = 8;

/** Hours for a fresh paycheck: the usual hours, with approved time off and company holidays in the period. */
async function defaultHours(
  emp: { email: string; start_date: string | null; end_date: string | null },
  p: ProfileView, period: { start: string; end: string }, frequency: PayFrequency, offCycle: boolean, holidays: string[],
): Promise<Hours> {
  if (offCycle) return { regular: 0, overtime: 0, pto: 0, holiday: 0, sick: 0, bonusCents: 0, salaryFraction: 0 };
  const off = await q<{ kind: string; start_date: string; end_date: string }>(
    `SELECT kind, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date FROM pto_requests
     WHERE employee_email = $1 AND status = 'approved' AND start_date <= $3 AND end_date >= $2`,
    [emp.email, period.start, period.end],
  );
  const daysOf = (kinds: string[]) =>
    off.filter((o) => kinds.includes(o.kind)).reduce((s, o) => s + businessDaysWithin(o.start_date, o.end_date, period.start, period.end, holidays), 0);
  const pto = daysOf(["vacation", "personal"]) * HOURS_PER_DAY;
  const sick = daysOf(["sick"]) * HOURS_PER_DAY;
  const unpaid = daysOf(["other"]) * HOURS_PER_DAY;
  // Only working days the person was employed for count.
  const from = emp.start_date && emp.start_date > period.start ? emp.start_date : period.start;
  const to = emp.end_date && emp.end_date < period.end ? emp.end_date : period.end;
  const allDays = businessDays(period.start, period.end);
  const employedDays = from <= to ? businessDays(from, to) : 0;
  const fraction = allDays ? employedDays / allDays : 1;
  const holiday = holidays.filter((d) => d >= from && d <= to).length * HOURS_PER_DAY;
  const usual = Math.round(standardHours(frequency) * fraction * 100) / 100;
  const regular = Math.max(0, Math.round((usual - pto - sick - unpaid - holiday) * 100) / 100);
  if (p.payType === "salary") return { regular: usual, overtime: 0, pto, holiday, sick, bonusCents: 0, salaryFraction: Math.round(fraction * 10000) / 10000 };
  return { regular, overtime: 0, pto, holiday, sick, bonusCents: 0 };
}

function snapshot(p: ProfileView, emp: Record<string, unknown>): Record<string, unknown> {
  return {
    payType: p.payType, annualSalaryCents: p.annualSalaryCents, hourlyRateCents: p.hourlyRateCents, filingStatus: p.filingStatus,
    multipleJobs: p.multipleJobs, workState: p.workState, paymentMethod: p.paymentMethod, accountLast4: p.accountLast4,
    title: emp.title ?? "", department: emp.department ?? "",
  };
}

function rules(s: Settings, frequency: PayFrequency): CompanyRules {
  return { frequency, overtimeMultiplier: s.overtimeMultiplier, sutaRatePercent: s.sutaRatePercent, sutaWageBaseCents: s.sutaWageBaseCents };
}

async function retotal(runId: string, tq: Tq): Promise<void> {
  const checks = await tq<{ result: Paycheck }>("SELECT result FROM paychecks WHERE run_id = $1", [runId]);
  const totals = { ...runTotals(checks.map((c) => c.result)), employees: checks.length };
  await tq("UPDATE pay_runs SET totals = $2 WHERE id = $1", [runId, JSON.stringify(totals)]);
}

export async function createRun(v: Viewer, b: Body): Promise<{ id: string }> {
  requirePayroll(v);
  const s = await getSettings();
  const start = b.periodStart, end = b.periodEnd, payDate = b.payDate;
  if (!isDay(start) || !isDay(end) || start > end) throw new UserError("Pick the pay period: a start date on or before the end date");
  if (!isDay(payDate)) throw new UserError("Pick the pay date");
  if (end > addDays(start, 31)) throw new UserError("A pay period is at most a month");
  const offCycle = Boolean(b.offCycle);
  const holidays = await holidayDays(start, end);

  const employees = await q<{ id: string; email: string; name: string; title: string; department: string; start_date: string | null; end_date: string | null }>(
    `SELECT e.id::text AS id, e.email, e.name, e.title, e.department, to_char(e.start_date, 'YYYY-MM-DD') AS start_date,
       to_char(e.end_date, 'YYYY-MM-DD') AS end_date
     FROM employees e JOIN pay_profiles p ON p.employee_id = e.id
     WHERE p.in_payroll AND (e.start_date IS NULL OR e.start_date <= $2) AND (e.end_date IS NULL OR e.end_date >= $1)
       AND (e.active OR e.end_date IS NOT NULL)
     ORDER BY lower(e.name)`,
    [start, end],
  );
  if (!employees.length) throw new UserError("Nobody is set up for payroll yet. Add pay details on a person's Pay tab first.");
  const profs = await profiles(employees.map((e) => e.id));
  const hours = new Map<string, Hours>();
  for (const e of employees) hours.set(e.id, await defaultHours(e, profs.get(e.id)!, { start, end }, s.frequency, offCycle, holidays));

  const id = await tx(async (tq) => {
    if (!offCycle) {
      const clash = await tq<{ number: string }>(
        `SELECT number FROM pay_runs WHERE status <> 'void' AND period_start <= $2 AND period_end >= $1 AND (totals->>'offCycle') IS NULL LIMIT 1`,
        [start, end],
      );
      if (clash.length) throw new UserError(`Pay run ${clash[0].number} already covers some of these dates. Use an off-cycle run for bonuses or corrections.`);
    }
    const [run] = await tq<{ id: string; number: string }>(
      `INSERT INTO pay_runs (period_start, period_end, pay_date, frequency, note, created_by, totals) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, number`,
      [start, end, payDate, s.frequency, text(b.note, 500), v.email, JSON.stringify(offCycle ? { offCycle: true } : {})],
    );
    const ytd = await ytdBefore(employees.map((e) => e.id), payDate, Number(run.number), tq);
    for (const e of employees) {
      const p = profs.get(e.id)!;
      const h = hours.get(e.id)!;
      const result = computePaycheck(toCalc(p), h, rules(s, s.frequency), ytd.get(e.id) ?? EMPTY_YTD, payDate);
      await tq(
        `INSERT INTO paychecks (run_id, employee_id, employee_email, employee_name, hours, profile, result, gross_cents, net_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [run.id, e.id, e.email, e.name, JSON.stringify(h), JSON.stringify(snapshot(p, e)), JSON.stringify(result), result.grossCents, result.netCents],
      );
    }
    await retotalKeepingFlags(run.id, offCycle, tq);
    await audit(v.email, "payroll.run.create", `run ${run.number}`, { start, end, payDate, offCycle, employees: employees.length }, tq);
    return run.id;
  });
  return { id };
}

async function retotalKeepingFlags(runId: string, offCycle: boolean, tq: Tq): Promise<void> {
  await retotal(runId, tq);
  if (offCycle) await tq(`UPDATE pay_runs SET totals = totals || '{"offCycle": true}'::jsonb WHERE id = $1`, [runId]);
}

async function draftRun(id: string, tq: Tq): Promise<RunView> {
  const run = await loadRun(id, tq);
  if (run.status !== "draft") throw new UserError("Only a draft pay run can be changed. Send it back to draft first.", 409);
  return run;
}

function cleanHours(b: Body, current: Hours): Hours {
  const h = (k: keyof Hours, label: string) => (k in b ? num(b[k], label, 0, { min: 0, max: 1000 }) : (current[k] as number) ?? 0);
  return {
    regular: h("regular", "Regular hours"),
    overtime: h("overtime", "Overtime hours"),
    pto: h("pto", "Time off hours"),
    holiday: h("holiday", "Holiday hours"),
    sick: h("sick", "Sick hours"),
    bonusCents: "bonus" in b ? cents(b.bonus, "Bonus") : current.bonusCents,
    ...(current.salaryFraction !== undefined || "salaryFraction" in b
      ? { salaryFraction: "salaryFraction" in b ? num(b.salaryFraction, "Share of salary", 1, { min: 0, max: 1 }) : current.salaryFraction }
      : {}),
  };
}

/** Recomputes paychecks in a draft run from current pay details (and new hours for one paycheck, when given). */
async function recompute(runId: string, tq: Tq, only?: { checkId: string; hours: Hours }): Promise<void> {
  const run = await draftRun(runId, tq);
  const s = await getSettings();
  const checks = await tq<CheckRow>(`SELECT ${CHECK_COLS} FROM paychecks WHERE run_id = $1`, [runId]);
  const target = only ? checks.filter((c) => c.id === only.checkId) : checks;
  if (only && !target.length) throw new UserError("Not found", 404);
  const ids = target.map((c) => c.employee_id);
  const profs = await profiles(ids, tq);
  const ytd = await ytdBefore(ids, run.payDate, run.number, tq);
  const emps = await tq<{ id: string; title: string; department: string }>("SELECT id::text AS id, title, department FROM employees WHERE id::text = ANY($1)", [ids]);
  for (const c of target) {
    const p = profs.get(c.employee_id)!;
    const h = only ? only.hours : c.hours;
    const result = computePaycheck(toCalc(p), h, rules(s, run.frequency), ytd.get(c.employee_id) ?? EMPTY_YTD, run.payDate);
    await tq("UPDATE paychecks SET hours = $2, profile = $3, result = $4, gross_cents = $5, net_cents = $6 WHERE id = $1",
      [c.id, JSON.stringify(h), JSON.stringify(snapshot(p, emps.find((e) => e.id === c.employee_id) ?? {})), JSON.stringify(result), result.grossCents, result.netCents]);
  }
  await retotalKeepingFlags(runId, Boolean((run.totals as { offCycle?: boolean }).offCycle), tq);
}

export async function updatePaycheck(v: Viewer, checkId: string, b: Body): Promise<PaycheckView> {
  requirePayroll(v);
  return tx(async (tq) => {
    const [c] = await tq<CheckRow>(`SELECT ${CHECK_COLS} FROM paychecks WHERE id::text = $1`, [checkId]);
    if (!c) throw new UserError("Not found", 404);
    await recompute(c.run_id, tq, { checkId: c.id, hours: cleanHours(b, c.hours) });
    await audit(v.email, "payroll.paycheck.update", c.employee_email, { run: c.run_id, fields: Object.keys(b) }, tq);
    const [after] = await tq<CheckRow>(`SELECT ${CHECK_COLS} FROM paychecks WHERE id = $1`, [c.id]);
    return checkView(after);
  });
}

export async function removePaycheck(v: Viewer, checkId: string): Promise<void> {
  requirePayroll(v);
  await tx(async (tq) => {
    const [c] = await tq<CheckRow>(`SELECT ${CHECK_COLS} FROM paychecks WHERE id::text = $1`, [checkId]);
    if (!c) throw new UserError("Not found", 404);
    const run = await draftRun(c.run_id, tq);
    await tq("DELETE FROM paychecks WHERE id = $1", [c.id]);
    await retotalKeepingFlags(c.run_id, Boolean((run.totals as { offCycle?: boolean }).offCycle), tq);
    await audit(v.email, "payroll.paycheck.remove", c.employee_email, { run: c.run_id }, tq);
  });
}

export async function recalcRun(v: Viewer, id: string): Promise<void> {
  requirePayroll(v);
  await tx(async (tq) => {
    await recompute(id, tq);
    await audit(v.email, "payroll.run.recalculate", id, {}, tq);
  });
}

async function setStatus(v: Viewer, id: string, from: RunStatus[], to: RunStatus): Promise<RunView> {
  requirePayroll(v);
  return tx(async (tq) => {
    const run = await loadRun(id, tq);
    if (!from.includes(run.status)) throw new UserError(`A ${run.status} pay run can't be marked ${to}`, 409);
    if (to === "approved") {
      const bad = await tq<{ employee_name: string }>("SELECT employee_name FROM paychecks WHERE run_id = $1 AND net_cents < 0", [id]);
      if (bad.length) throw new UserError(`Net pay is below zero for ${bad.map((b) => b.employee_name).join(", ")}`);
      const [{ n }] = await tq<{ n: string }>("SELECT COUNT(*) AS n FROM paychecks WHERE run_id = $1", [id]);
      if (!Number(n)) throw new UserError("This pay run has nobody in it");
      // A later run's year-to-date figures depend on this one, so approve in pay-date order.
      const earlier = await tq<{ number: string }>(
        "SELECT number FROM pay_runs WHERE status = 'draft' AND id <> $1 AND EXTRACT(YEAR FROM pay_date) = $3 AND pay_date < $2 LIMIT 1",
        [id, run.payDate, Number(run.payDate.slice(0, 4))],
      );
      if (earlier.length) throw new UserError(`Approve or void pay run ${earlier[0].number} first: it pays out earlier`);
      // Recompute with final year-to-date figures before locking.
      await recompute(id, tq);
    }
    if (to === "draft") {
      const later = await tq<{ number: string }>(
        "SELECT number FROM pay_runs WHERE status IN ('approved','paid') AND id <> $1 AND EXTRACT(YEAR FROM pay_date) = $3 AND (pay_date > $2 OR (pay_date = $2 AND number > $4)) LIMIT 1",
        [id, run.payDate, Number(run.payDate.slice(0, 4)), run.number],
      );
      if (later.length) throw new UserError(`Pay run ${later[0].number} comes after this one and is already approved`);
    }
    const stamp = to === "approved" ? ", approved_by = $2, approved_at = now()" : to === "paid" ? ", paid_by = $2, paid_at = now()" : to === "draft" ? ", approved_by = NULL, approved_at = NULL" : "";
    await tq(`UPDATE pay_runs SET status = '${to}'${stamp} WHERE id = $1`, stamp.includes("$2") ? [id, v.email] : [id]);
    await audit(v.email, `payroll.run.${to}`, `run ${run.number}`, {}, tq);
    return loadRun(id, tq);
  });
}

export const approveRun = (v: Viewer, id: string) => setStatus(v, id, ["draft"], "approved");
export const reopenRun = (v: Viewer, id: string) => setStatus(v, id, ["approved"], "draft");
export const voidRun = (v: Viewer, id: string) => setStatus(v, id, ["draft", "approved"], "void");

/** Marks an approved run paid and posts its journal to Books. */
export async function payRun(v: Viewer, id: string, opts: { fetch?: typeof fetch } = {}): Promise<RunView> {
  await setStatus(v, id, ["approved"], "paid");
  return postRun(v, id, opts);
}

export async function postRun(v: Viewer, id: string, opts: { fetch?: typeof fetch } = {}): Promise<RunView> {
  requirePayroll(v);
  const run = await loadRun(id);
  if (run.status !== "paid") throw new UserError("Only a paid run goes to Books", 409);
  if (run.booksStatus === "posted") return run;
  if (!booksConfigured()) {
    await q("UPDATE pay_runs SET books_status = 'off', books_error = NULL WHERE id = $1", [id]);
    return loadRun(id);
  }
  const s = await getSettings();
  const label = `Payroll ${run.number} (${run.periodStart} to ${run.periodEnd})`;
  try {
    const posted = await postJournal(
      { reference: `HR-PAYRUN-${run.number}`, date: run.payDate, description: label, organizationId: s.booksOrg || undefined, lines: payrollJournal(run.totals, s.accounts, `Payroll ${run.number}`) },
      opts,
    );
    await q("UPDATE pay_runs SET books_status = 'posted', books_journal = $2, books_error = NULL WHERE id = $1", [id, posted.journalNumber || posted.journalId]);
    await audit(v.email, "payroll.run.books", `run ${run.number}`, { journal: posted.journalNumber });
  } catch (e) {
    await q("UPDATE pay_runs SET books_status = 'failed', books_error = $2 WHERE id = $1", [id, String((e as Error).message).slice(0, 500)]);
  }
  return loadRun(id);
}

/* ---------------------------------------------------- pay stubs and reports */

export interface StubSummary { id: string; runNumber: number; payDate: string; periodStart: string; periodEnd: string; grossCents: number; netCents: number }

/** A person's own pay stubs: paid runs only. */
export async function myStubs(email: string): Promise<StubSummary[]> {
  const rows = await q<{ id: string; number: string; pay_date: string; period_start: string; period_end: string; gross_cents: string; net_cents: string }>(
    `SELECT p.id, r.number, to_char(r.pay_date, 'YYYY-MM-DD') AS pay_date, to_char(r.period_start, 'YYYY-MM-DD') AS period_start,
       to_char(r.period_end, 'YYYY-MM-DD') AS period_end, p.gross_cents, p.net_cents
     FROM paychecks p JOIN pay_runs r ON r.id = p.run_id WHERE p.employee_email = $1 AND r.status = 'paid' ORDER BY r.pay_date DESC, r.number DESC`,
    [email],
  );
  return rows.map((r) => ({ id: r.id, runNumber: Number(r.number), payDate: r.pay_date, periodStart: r.period_start, periodEnd: r.period_end, grossCents: Number(r.gross_cents), netCents: Number(r.net_cents) }));
}

export interface Stub { check: PaycheckView; run: RunView; companyName: string; ytd: YearToDate & { taxes: Record<string, number>; netCents: number } }

/** One pay stub with year-to-date totals: the employee's own once paid, or any for payroll admins. */
export async function getStub(v: Viewer, checkId: string): Promise<Stub> {
  const [c] = await q<CheckRow>(`SELECT ${CHECK_COLS} FROM paychecks WHERE id::text = $1`, [checkId]);
  if (!c) throw new UserError("Not found", 404);
  const run = await loadRun(c.run_id);
  const own = c.employee_email === v.email && run.status === "paid";
  if (!own && !v.roles.payrollAdmin) throw new UserError("Not found", 404);
  const prior = await q<{ result: Paycheck }>(
    `SELECT p.result FROM paychecks p JOIN pay_runs r ON r.id = p.run_id
     WHERE p.employee_id = $1 AND r.status IN ('approved','paid') AND EXTRACT(YEAR FROM r.pay_date) = $2
       AND (r.pay_date < $3 OR (r.pay_date = $3 AND r.number <= $4))`,
    [c.employee_id, Number(run.payDate.slice(0, 4)), run.payDate, run.number],
  );
  const results = run.status === "approved" || run.status === "paid" ? prior.map((p) => p.result) : [...prior.map((p) => p.result), c.result];
  let ytd = EMPTY_YTD;
  const taxes: Record<string, number> = {};
  let net = 0;
  for (const r of results) {
    ytd = addToYtd(ytd, r);
    for (const t of r.taxes) taxes[t.code] = (taxes[t.code] ?? 0) + t.amountCents;
    net += r.netCents;
  }
  const s = await getSettings();
  return { check: checkView(c), run, companyName: s.companyName, ytd: { ...ytd, taxes, netCents: net } };
}

export interface QuarterSummary {
  quarter: number; runs: number; grossCents: number; federalWagesCents: number; ficaWagesCents: number; federalCents: number;
  socialSecurityCents: number; medicareCents: number; stateCents: number; futaCents: number; sutaCents: number; netCents: number;
}

/** Paid payroll by quarter: the figures Form 941, Form 940 and state returns ask for. */
export async function taxSummary(v: Viewer, year: number): Promise<QuarterSummary[]> {
  requirePayroll(v);
  const rows = await q<{ q: string; run_id: string; result: Paycheck }>(
    `SELECT EXTRACT(QUARTER FROM r.pay_date)::int AS q, r.id AS run_id, p.result FROM paychecks p JOIN pay_runs r ON r.id = p.run_id
     WHERE r.status = 'paid' AND EXTRACT(YEAR FROM r.pay_date) = $1`,
    [year],
  );
  const out: QuarterSummary[] = [1, 2, 3, 4].map((quarter) => ({
    quarter, runs: 0, grossCents: 0, federalWagesCents: 0, ficaWagesCents: 0, federalCents: 0, socialSecurityCents: 0, medicareCents: 0,
    stateCents: 0, futaCents: 0, sutaCents: 0, netCents: 0,
  }));
  const runs = [1, 2, 3, 4].map(() => new Set<string>());
  const line = (lines: { code: string; amountCents: number }[], code: string) => lines.filter((l) => l.code === code).reduce((s, l) => s + l.amountCents, 0);
  for (const r of rows) {
    const o = out[Number(r.q) - 1];
    runs[Number(r.q) - 1].add(r.run_id);
    o.grossCents += r.result.grossCents;
    o.federalWagesCents += r.result.wages.federal;
    o.ficaWagesCents += r.result.wages.socialSecurity;
    o.federalCents += line(r.result.taxes, "federal");
    // Both halves of FICA: employee withheld plus employer share.
    o.socialSecurityCents += line(r.result.taxes, "social_security") + line(r.result.employerTaxes, "social_security");
    o.medicareCents += line(r.result.taxes, "medicare") + line(r.result.employerTaxes, "medicare");
    o.stateCents += line(r.result.taxes, "state");
    o.futaCents += line(r.result.employerTaxes, "futa");
    o.sutaCents += line(r.result.employerTaxes, "suta");
    o.netCents += r.result.netCents;
  }
  out.forEach((o, i) => (o.runs = runs[i].size));
  return out;
}

export { PERIODS_PER_YEAR };
