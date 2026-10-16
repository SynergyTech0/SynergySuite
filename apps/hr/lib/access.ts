import { q } from "./db";

/**
 * Who may do what in HR.
 *   HR admins (HR_ADMIN_EMAILS; the People add-on's ADMIN_EMAILS still works): every record and request.
 *   Payroll admins (PAYROLL_ADMIN_EMAILS; HR admins when unset): pay setup and pay runs.
 *   Managers: anyone who has reports. They see their whole team's records (not pay) and decide its time off.
 *   Everyone: the directory, the org chart, their own record, time off, tasks and pay stubs.
 */

function list(v: string | undefined): string[] {
  return (v || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
}

export function hrAdmins(env: NodeJS.ProcessEnv = process.env): string[] {
  return list(env.HR_ADMIN_EMAILS || env.ADMIN_EMAILS);
}

export function payrollAdmins(env: NodeJS.ProcessEnv = process.env): string[] {
  const own = list(env.PAYROLL_ADMIN_EMAILS);
  return own.length ? own : hrAdmins(env);
}

export interface Roles {
  hrAdmin: boolean;
  payrollAdmin: boolean;
  /** Has at least one active direct report. */
  manager: boolean;
}

export async function rolesFor(email: string): Promise<Roles> {
  const e = email.toLowerCase();
  const [{ n }] = await q<{ n: string }>("SELECT COUNT(*) AS n FROM employees WHERE manager_email = $1 AND active", [e]);
  return { hrAdmin: hrAdmins().includes(e), payrollAdmin: payrollAdmins().includes(e), manager: Number(n) > 0 };
}

/** Everyone who reports to `email`, directly or through other managers (emails, lower case). */
export async function teamOf(email: string): Promise<string[]> {
  const rows = await q<{ email: string }>(
    `WITH RECURSIVE team AS (
       SELECT email, 1 AS depth FROM employees WHERE manager_email = $1
       UNION
       SELECT e.email, t.depth + 1 FROM employees e JOIN team t ON e.manager_email = t.email WHERE t.depth < 20
     ) SELECT DISTINCT email FROM team WHERE email <> $1`,
    [email.toLowerCase()],
  );
  return rows.map((r) => r.email);
}
