/**
 * Direct deposit as a NACHA (ACH) file: PPD credit entries for each paycheck, in the 94-character
 * fixed-width format every US bank accepts for upload. Optionally balanced with one debit from the
 * company's own account, for banks that want balanced files.
 *
 * Record layout follows the NACHA Operating Rules, Appendix Three: file header (1), batch header
 * (5), entry detail (6), batch control (8), file control (9), padded with rows of 9s to a block of
 * ten.
 */

export type AccountType = "checking" | "savings";

export interface AchCompany {
  /** The bank that receives the file (your ODFI): nine-digit routing number and its name. */
  odfiRouting: string;
  odfiName: string;
  /** Who the file is from: usually a 10-character ID your bank gives you (often 1 + EIN). */
  originId: string;
  originName: string;
  /** Company name and ID as they appear on employees' bank statements. */
  companyName: string;
  companyId: string;
  /** Balancing debit from the company's own account, when the bank wants balanced files. */
  offset?: { routing: string; account: string; type: AccountType } | null;
}

export interface AchEntry {
  name: string;
  /** Your own reference for the employee, shown to them by some banks. */
  id: string;
  routing: string;
  account: string;
  type: AccountType;
  amountCents: number;
}

export interface AchFileInput {
  company: AchCompany;
  entries: AchEntry[];
  /** YYYY-MM-DD the money should land: the pay date. */
  effectiveDate: string;
  /** Shown on bank statements; 10 characters. */
  description?: string;
  createdAt?: Date;
  /** A to Z, 0 to 9: different for each file sent the same day. */
  fileIdModifier?: string;
}

/** ABA routing number checksum: 3, 7, 1 weights. */
export function validRouting(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;
  const d = routing.split("").map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

export function validAccount(account: string): boolean {
  return /^[0-9A-Za-z-]{1,17}$/.test(account);
}

/** Only what the NACHA character set allows, upper case. */
function clean(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9 .,&'/()+-]/g, "").replace(/\s+/g, " ").trim();
}
const alpha = (s: string, n: number) => clean(s).slice(0, n).padEnd(n, " ");
const numeric = (v: number | string, n: number) => {
  const s = String(v);
  if (!/^\d+$/.test(s) || s.length > n) throw new Error(`"${s}" does not fit ${n} digits`);
  return s.padStart(n, "0");
};
const yymmdd = (iso: string) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);

export interface AchFile {
  text: string;
  entryCount: number;
  totalCreditCents: number;
  totalDebitCents: number;
}

export function buildAchFile(f: AchFileInput): AchFile {
  const c = f.company;
  if (!validRouting(c.odfiRouting)) throw new Error("The bank routing number for direct deposit is not valid");
  if (!/^[0-9A-Za-z ]{1,10}$/.test(c.originId.trim())) throw new Error("The file origin ID is 1 to 10 letters or digits");
  if (!/^[0-9A-Za-z ]{1,10}$/.test(c.companyId.trim())) throw new Error("The company ID is 1 to 10 letters or digits");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.effectiveDate)) throw new Error("Effective date is YYYY-MM-DD");
  const entries = f.entries.filter((e) => e.amountCents > 0);
  if (!entries.length) throw new Error("No direct deposits to send");
  for (const e of entries) {
    if (!validRouting(e.routing)) throw new Error(`${e.name}: the routing number is not valid`);
    if (!validAccount(e.account)) throw new Error(`${e.name}: the account number is not valid`);
    if (!Number.isInteger(e.amountCents) || e.amountCents > 99_999_999_99) throw new Error(`${e.name}: the amount is not valid`);
  }

  const now = f.createdAt ?? new Date();
  const iso = now.toISOString();
  const odfi8 = c.odfiRouting.slice(0, 8);
  const balanced = Boolean(c.offset);
  const serviceClass = balanced ? "200" : "220";
  const lines: string[] = [];

  // File header
  lines.push(
    "1" + "01" + " " + c.odfiRouting + c.originId.trim().padStart(10, " ").slice(0, 10) + yymmdd(iso.slice(0, 10)) + iso.slice(11, 13) + iso.slice(14, 16)
      + (f.fileIdModifier ?? "A").toUpperCase().slice(0, 1) + "094" + "10" + "1" + alpha(c.odfiName, 23) + alpha(c.originName, 23) + " ".repeat(8),
  );
  // Batch header
  const batch = numeric(1, 7);
  const companyId = c.companyId.trim().padEnd(10, " ").slice(0, 10);
  lines.push(
    "5" + serviceClass + alpha(c.companyName, 16) + " ".repeat(20) + companyId + "PPD" + alpha(f.description ?? "PAYROLL", 10)
      + yymmdd(f.effectiveDate) + yymmdd(f.effectiveDate) + "   " + "1" + odfi8 + batch,
  );

  let seq = 0;
  let hash = 0;
  let credit = 0;
  let debit = 0;
  const entry = (code: string, e: { routing: string; account: string; amountCents: number; id: string; name: string }) => {
    seq += 1;
    hash += Number(e.routing.slice(0, 8));
    lines.push(
      "6" + code + e.routing.slice(0, 8) + e.routing[8] + e.account.toUpperCase().padEnd(17, " ") + numeric(e.amountCents, 10)
        + alpha(e.id, 15) + alpha(e.name, 22) + "  " + "0" + odfi8 + numeric(seq, 7),
    );
  };
  for (const e of entries) {
    entry(e.type === "savings" ? "32" : "22", e);
    credit += e.amountCents;
  }
  if (c.offset) {
    if (!validRouting(c.offset.routing) || !validAccount(c.offset.account)) throw new Error("The company's offset account is not valid");
    entry(c.offset.type === "savings" ? "37" : "27", { ...c.offset, amountCents: credit, id: "OFFSET", name: c.companyName });
    debit = credit;
  }
  const hash10 = numeric(hash % 10_000_000_000, 10);

  // Batch control
  lines.push(
    "8" + serviceClass + numeric(seq, 6) + hash10 + numeric(debit, 12) + numeric(credit, 12) + companyId + " ".repeat(19) + " ".repeat(6) + odfi8 + batch,
  );
  // File control
  const blocks = Math.ceil((lines.length + 1) / 10);
  lines.push("9" + numeric(1, 6) + numeric(blocks, 6) + numeric(seq, 8) + hash10 + numeric(debit, 12) + numeric(credit, 12) + " ".repeat(39));
  while (lines.length % 10) lines.push("9".repeat(94));

  for (const l of lines) if (l.length !== 94) throw new Error(`ACH record is ${l.length} characters, not 94`);
  return { text: lines.join("\r\n") + "\r\n", entryCount: entries.length, totalCreditCents: credit, totalDebitCents: debit };
}
