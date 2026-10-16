import { audit } from "../db";
import type { Viewer } from "../hr";
import { UserError } from "../util";
import { achCompany } from "./employer";
import { type AchEntry, buildAchFile } from "./nacha";
import { privateFor } from "./private";
import { getRun } from "./runs";

/**
 * The direct deposit file for a pay run: one credit per direct-deposit paycheck, to the bank
 * account on file, for upload to the company's bank. Only approved or paid runs, and only when
 * everyone being paid by deposit has bank details, so nobody is quietly left out.
 */

export interface DepositLine {
  employeeId: string;
  name: string;
  amountCents: number;
  accountLast4: string;
  /** What's missing before this person can be paid by deposit; '' when ready. */
  problem: string;
}

export interface DepositPreview {
  runNumber: number;
  payDate: string;
  lines: DepositLine[];
  /** Paid by check: not in the file. */
  checks: number;
  totalCents: number;
  ready: boolean;
}

async function gather(v: Viewer, runId: string) {
  const { run, paychecks } = await getRun(v, runId);
  const deposit = paychecks.filter((p) => p.profile.paymentMethod !== "check" && p.netCents > 0);
  const priv = await privateFor(deposit.map((p) => p.employeeId));
  const lines: (DepositLine & { entry: AchEntry | null })[] = deposit.map((p) => {
    const x = priv.get(p.employeeId);
    const problem = !x?.bankRouting || !x.bankAccount ? "No bank account on file" : "";
    const name = x && (x.legalFirst || x.legalLast) ? `${x.legalFirst} ${x.legalLast}`.trim() : p.employeeName;
    return {
      employeeId: p.employeeId, name, amountCents: p.netCents, accountLast4: x?.bankAccountLast4 ?? "", problem,
      entry: problem ? null : { name, id: p.employeeId, routing: x!.bankRouting, account: x!.bankAccount, type: x!.bankAccountType, amountCents: p.netCents },
    };
  });
  return { run, lines, checks: paychecks.length - deposit.length };
}

export async function depositPreview(v: Viewer, runId: string): Promise<DepositPreview> {
  const { run, lines, checks } = await gather(v, runId);
  return {
    runNumber: run.number, payDate: run.payDate, checks,
    lines: lines.map(({ entry: _, ...l }) => l),
    totalCents: lines.reduce((s, l) => s + l.amountCents, 0),
    ready: (run.status === "approved" || run.status === "paid") && lines.length > 0 && lines.every((l) => !l.problem),
  };
}

export async function depositFile(v: Viewer, runId: string, now = new Date()): Promise<{ filename: string; text: string }> {
  const { run, lines } = await gather(v, runId);
  if (run.status !== "approved" && run.status !== "paid") throw new UserError("Approve the run before making its deposit file", 409);
  if (!lines.length) throw new UserError("Nobody in this run is paid by direct deposit", 409);
  const missing = lines.filter((l) => l.problem).map((l) => l.name);
  if (missing.length) throw new UserError(`Add bank details for ${missing.join(", ")}, or pay them by check`, 409);
  const { company } = await achCompany();
  let file;
  try {
    file = buildAchFile({ company, entries: lines.map((l) => l.entry!), effectiveDate: run.payDate, description: "PAYROLL", createdAt: now });
  } catch (err) {
    throw new UserError((err as Error).message, 409);
  }
  await audit(v.email, "payroll.deposit_file", runId, { entries: file.entryCount, totalCents: file.totalCreditCents });
  return { filename: `payroll-${run.number}-${run.payDate}.ach`, text: file.text };
}
