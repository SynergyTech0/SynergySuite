import { audit, q } from "../db";
import type { Viewer } from "../hr";
import { UserError } from "../util";
import type { Paycheck } from "./calc";
import { buildEfw2, efw2Problems, type Efw2Employee } from "./efw2";
import { type Employer, getEmployer } from "./employer";
import { type Form940, type Form941, type PaidCheck, type StateQuarter, type W2, type W3, form940, form941, stateQuarter, w2, w3 } from "./forms";
import { privateFor } from "./private";
import { requirePayroll } from "./runs";

/**
 * Tax forms from paid pay runs: W-2s (and the W-3 and SSA file), Form 941 each quarter, Form 940
 * and the state quarterly figures. Everything is worked out from the paychecks on demand, so a
 * paid run always shows up and nothing can drift.
 */

async function paidChecks(year: number, employeeId?: string): Promise<(PaidCheck & { name: string })[]> {
  const rows = await q<{ employee_id: string; employee_name: string; pay_date: string; period_start: string; period_end: string; profile: { workState?: string }; result: Paycheck }>(
    `SELECT p.employee_id::text AS employee_id, p.employee_name, to_char(r.pay_date, 'YYYY-MM-DD') AS pay_date,
       to_char(r.period_start, 'YYYY-MM-DD') AS period_start, to_char(r.period_end, 'YYYY-MM-DD') AS period_end, p.profile, p.result
     FROM paychecks p JOIN pay_runs r ON r.id = p.run_id
     WHERE r.status = 'paid' AND EXTRACT(YEAR FROM r.pay_date) = $1 AND ($2::text IS NULL OR p.employee_id::text = $2)
     ORDER BY r.pay_date, r.number`,
    [year, employeeId ?? null],
  );
  return rows.map((r) => ({
    employeeId: r.employee_id, name: r.employee_name, payDate: r.pay_date, periodStart: r.period_start, periodEnd: r.period_end,
    state: String(r.profile?.workState ?? ""), result: r.result,
  }));
}

function year(v: unknown): number {
  const y = Number(v);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new UserError("Pick a year");
  return y;
}

export interface W2Row { employeeId: string; name: string; ssnLast4: string; w2: W2; missing: string[] }

export interface TaxForms {
  year: number;
  w2s: W2Row[];
  w3: W3;
  quarters: { quarter: number; form941: Form941; states: StateQuarter[] }[];
  form940: Form940;
  /** What the SSA file still needs. */
  efw2Missing: string[];
}

export async function taxForms(v: Viewer, y: unknown): Promise<TaxForms> {
  requirePayroll(v);
  const yr = year(y);
  const checks = await paidChecks(yr);
  const people = [...new Map(checks.map((c) => [c.employeeId, c.name])).entries()];
  const priv = await privateFor(people.map(([id]) => id));
  const employer = await getEmployer(v);
  const w2s = people.map(([id, name]) => {
    const p = priv.get(id);
    const missing = [!p?.ssnLast4 && "Social Security number", !(p?.legalFirst && p?.legalLast) && "legal name", !(p?.address1 && p?.city && p?.zip) && "address"]
      .filter((x): x is string => Boolean(x));
    return { employeeId: id, name: p?.legalFirst && p.legalLast ? `${p.legalFirst} ${p.legalLast}` : name, ssnLast4: p?.ssnLast4 ?? "", w2: w2(yr, id, checks), missing };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return {
    year: yr,
    w2s,
    w3: w3(yr, w2s.map((r) => r.w2)),
    quarters: [1, 2, 3, 4].map((quarter) => ({ quarter, form941: form941(yr, quarter, checks), states: stateQuarter(yr, quarter, checks) })),
    form940: form940(yr, checks),
    efw2Missing: efw2Problems(efw2Employer(employer), []),
  };
}

function efw2Employer(e: Employer) {
  return {
    ein: e.ein, name: e.legalName, bsoUserId: e.bsoUserId, contactName: e.contactName, contactPhone: e.contactPhone || e.phone, contactEmail: e.contactEmail,
    address1: e.address1, address2: e.address2, city: e.city, state: e.state, zip: e.zip,
  };
}

/** What a printed W-2 shows. The SSN is always truncated: employee copies may be, and Copy A goes in the SSA file. */
export interface W2Document {
  w2: W2;
  employer: { ein: string; name: string; address1: string; address2: string; city: string; state: string; zip: string; stateIds: Record<string, string> };
  employee: { name: string; ssnMasked: string; address1: string; address2: string; city: string; state: string; zip: string };
}

/** One person's W-2: their own, or anyone's for payroll admins. */
export async function w2Document(v: Viewer, employeeId: string, y: unknown): Promise<W2Document> {
  const yr = year(y);
  if (!/^\d{1,18}$/.test(employeeId)) throw new UserError("Not found", 404);
  const [emp] = await q<{ email: string; name: string }>("SELECT email, name FROM employees WHERE id = $1", [employeeId]);
  if (!emp || (emp.email !== v.email && !v.roles.payrollAdmin)) throw new UserError("Not found", 404);
  const checks = await paidChecks(yr, employeeId);
  if (!checks.length) throw new UserError(`No paid paychecks in ${yr}`, 404);
  const [p] = await q<{ legal_first: string; legal_middle: string; legal_last: string; legal_suffix: string; address1: string; address2: string; city: string; address_state: string; zip: string; ssn_last4: string }>(
    "SELECT legal_first, legal_middle, legal_last, legal_suffix, address1, address2, city, address_state, zip, ssn_last4 FROM pay_private WHERE employee_id = $1",
    [employeeId],
  );
  const [s] = await q<{ employer: Partial<Employer>; company_name: string }>("SELECT employer, company_name FROM pay_settings WHERE id = 1");
  const e = s.employer ?? {};
  const legal = p ? [p.legal_first, p.legal_middle, p.legal_last, p.legal_suffix].filter(Boolean).join(" ") : "";
  return {
    w2: w2(yr, employeeId, checks),
    employer: {
      ein: e.ein ? `${e.ein.slice(0, 2)}-${e.ein.slice(2)}` : "", name: e.legalName || s.company_name, address1: e.address1 ?? "", address2: e.address2 ?? "",
      city: e.city ?? "", state: e.state ?? "", zip: e.zip ?? "", stateIds: e.stateIds ?? {},
    },
    employee: {
      name: legal || emp.name, ssnMasked: p?.ssn_last4 ? `XXX-XX-${p.ssn_last4}` : "", address1: p?.address1 ?? "", address2: p?.address2 ?? "",
      city: p?.city ?? "", state: p?.address_state ?? "", zip: p?.zip ?? "",
    },
  };
}

/** Years someone has a W-2 for: any year with a paid paycheck. */
export async function myW2Years(email: string): Promise<{ employeeId: string; years: number[] }> {
  const rows = await q<{ employee_id: string; y: number }>(
    `SELECT DISTINCT p.employee_id::text AS employee_id, EXTRACT(YEAR FROM r.pay_date)::int AS y FROM paychecks p JOIN pay_runs r ON r.id = p.run_id
     WHERE p.employee_email = $1 AND r.status = 'paid' ORDER BY y DESC`,
    [email],
  );
  return { employeeId: rows[0]?.employee_id ?? "", years: rows.map((r) => Number(r.y)) };
}

/** The SSA's EFW2 file of every W-2 for the year, for upload through Business Services Online. */
export async function efw2File(v: Viewer, y: unknown): Promise<{ filename: string; text: string }> {
  requirePayroll(v);
  const yr = year(y);
  const checks = await paidChecks(yr);
  const ids = [...new Set(checks.map((c) => c.employeeId))];
  const priv = await privateFor(ids);
  const employer = await getEmployer(v);
  const employees: Efw2Employee[] = ids.map((id) => {
    const p = priv.get(id);
    return {
      ssn: p?.ssn ?? "", first: p?.legalFirst ?? "", middle: p?.legalMiddle ?? "", last: p?.legalLast ?? "", suffix: p?.legalSuffix ?? "",
      address1: p?.address1 ?? "", address2: p?.address2 ?? "", city: p?.city ?? "", state: p?.addressState ?? "", zip: p?.zip ?? "",
      w2: w2(yr, id, checks),
    };
  });
  let text: string;
  try {
    text = buildEfw2(yr, efw2Employer(employer), employees);
  } catch (err) {
    throw new UserError((err as Error).message, 409);
  }
  await audit(v.email, "payroll.w2_file", String(yr), { employees: employees.length });
  return { filename: `W2REPORT-${yr}.txt`, text };
}
