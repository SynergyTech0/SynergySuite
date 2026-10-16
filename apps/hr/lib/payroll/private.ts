import { audit, q } from "../db";
import type { Viewer } from "../hr";
import { open, seal } from "../secret";
import { UserError, oneOf, text } from "../util";
import { type AccountType, validAccount, validRouting } from "./nacha";
import { requirePayroll } from "./runs";

/**
 * What W-2s and direct deposit need about a person in full: legal name, home address, Social
 * Security number and bank account. The two numbers are sealed (lib/secret.ts); views only ever
 * show their last four digits, and only the deposit file and W-2 builders open them.
 */

export interface PrivateView {
  employeeId: string;
  legalFirst: string;
  legalMiddle: string;
  legalLast: string;
  legalSuffix: string;
  address1: string;
  address2: string;
  city: string;
  addressState: string;
  zip: string;
  ssnLast4: string;
  bankRouting: string;
  bankAccountLast4: string;
  bankAccountType: AccountType;
  updatedAt: string | null;
  updatedBy: string;
}

type Row = {
  employee_id: string; legal_first: string; legal_middle: string; legal_last: string; legal_suffix: string; address1: string; address2: string;
  city: string; address_state: string; zip: string; ssn_sealed: string; ssn_last4: string; bank_routing: string; bank_account_sealed: string; bank_last4: string;
  bank_account_type: AccountType; updated_at: Date; updated_by: string;
};

/** Everything, numbers opened: for building files, never for a response. */
export interface PrivateFull extends PrivateView {
  ssn: string;
  bankAccount: string;
}

function view(employeeId: string, r: Row | undefined): PrivateView {
  return {
    employeeId,
    legalFirst: r?.legal_first ?? "", legalMiddle: r?.legal_middle ?? "", legalLast: r?.legal_last ?? "", legalSuffix: r?.legal_suffix ?? "",
    address1: r?.address1 ?? "", address2: r?.address2 ?? "", city: r?.city ?? "", addressState: r?.address_state ?? "", zip: r?.zip ?? "",
    ssnLast4: r?.ssn_last4 ?? "", bankRouting: r?.bank_routing ?? "", bankAccountLast4: r?.bank_last4 ?? "",
    bankAccountType: r?.bank_account_type ?? "checking", updatedAt: r?.updated_at?.toISOString() ?? null, updatedBy: r?.updated_by ?? "",
  };
}

async function employee(id: string): Promise<void> {
  if (!/^\d{1,18}$/.test(id) || !(await q("SELECT 1 FROM employees WHERE id = $1", [id])).length) throw new UserError("Not found", 404);
}

export async function getPrivate(v: Viewer, employeeId: string): Promise<PrivateView> {
  requirePayroll(v);
  await employee(employeeId);
  const [r] = await q<Row>("SELECT *, employee_id::text AS employee_id FROM pay_private WHERE employee_id = $1", [employeeId]);
  return view(employeeId, r);
}

/** Opened records for these people, keyed by employee id. Callers check payroll rights. */
export async function privateFor(employeeIds: string[]): Promise<Map<string, PrivateFull>> {
  const rows = await q<Row>("SELECT *, employee_id::text AS employee_id FROM pay_private WHERE employee_id::text = ANY($1)", [employeeIds]);
  const out = new Map<string, PrivateFull>();
  for (const r of rows) {
    out.set(r.employee_id, { ...view(r.employee_id, r), ssn: open(r.ssn_sealed), bankAccount: open(r.bank_account_sealed) });
  }
  return out;
}

/** 9 digits that the SSA could have issued: not 000/666/9xx area, 00 group or 0000 serial. */
export function validSsn(ssn: string): boolean {
  if (!/^\d{9}$/.test(ssn)) return false;
  const area = ssn.slice(0, 3);
  return area !== "000" && area !== "666" && area[0] !== "9" && ssn.slice(3, 5) !== "00" && ssn.slice(5) !== "0000";
}

type Body = Record<string, unknown>;

export async function savePrivate(v: Viewer, employeeId: string, b: Body): Promise<PrivateView> {
  requirePayroll(v);
  await employee(employeeId);
  const [cur] = await q<Row>("SELECT * FROM pay_private WHERE employee_id = $1", [employeeId]);
  const pick = (k: string, col: keyof Row, max: number) => (k in b ? text(b[k], max) : String(cur?.[col] ?? ""));

  const addressState = pick("addressState", "address_state", 2).toUpperCase();
  if (addressState && !/^[A-Z]{2}$/.test(addressState)) throw new UserError("State is a two-letter code");
  const zip = pick("zip", "zip", 10);
  if (zip && !/^\d{5}(-?\d{4})?$/.test(zip)) throw new UserError("ZIP code is 5 or 9 digits");

  let ssnSealed = cur?.ssn_sealed ?? "";
  let ssnLast4 = cur?.ssn_last4 ?? "";
  const changed: string[] = Object.keys(b).filter((k) => k !== "ssn" && k !== "bankAccount");
  if ("ssn" in b) {
    const ssn = String(b.ssn ?? "").replace(/[\s-]/g, "");
    if (ssn === "") { ssnSealed = ""; ssnLast4 = ""; }
    else {
      if (!validSsn(ssn)) throw new UserError("Social Security number is 9 digits");
      ssnSealed = seal(ssn);
      ssnLast4 = ssn.slice(5);
    }
    changed.push("ssn");
  }

  const routing = pick("bankRouting", "bank_routing", 9).replace(/\s/g, "");
  if (routing && !validRouting(routing)) throw new UserError("That routing number is not valid");
  let accountSealed = cur?.bank_account_sealed ?? "";
  let accountLast4 = cur?.bank_last4 ?? "";
  let accountChanged = false;
  if ("bankAccount" in b) {
    const account = String(b.bankAccount ?? "").replace(/\s/g, "");
    accountChanged = true;
    if (account === "") { accountSealed = ""; accountLast4 = ""; }
    else {
      if (!validAccount(account)) throw new UserError("Account number is up to 17 letters or digits");
      accountSealed = seal(account);
      accountLast4 = account.slice(-4);
    }
    changed.push("bankAccount");
  }
  const type = "bankAccountType" in b ? oneOf(b.bankAccountType, ["checking", "savings"] as const, "checking") : cur?.bank_account_type ?? "checking";

  await q(
    `INSERT INTO pay_private (employee_id, legal_first, legal_middle, legal_last, legal_suffix, address1, address2, city, address_state, zip,
       ssn_sealed, ssn_last4, bank_routing, bank_account_sealed, bank_last4, bank_account_type, updated_at, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$17,$15, now(), $16)
     ON CONFLICT (employee_id) DO UPDATE SET legal_first = $2, legal_middle = $3, legal_last = $4, legal_suffix = $5, address1 = $6, address2 = $7,
       city = $8, address_state = $9, zip = $10, ssn_sealed = $11, ssn_last4 = $12, bank_routing = $13, bank_account_sealed = $14,
       bank_last4 = $17, bank_account_type = $15, updated_at = now(), updated_by = $16`,
    [
      employeeId, pick("legalFirst", "legal_first", 100), pick("legalMiddle", "legal_middle", 100), pick("legalLast", "legal_last", 100),
      pick("legalSuffix", "legal_suffix", 10), pick("address1", "address1", 200), pick("address2", "address2", 200), pick("city", "city", 100),
      addressState, zip, ssnSealed, ssnLast4, routing, accountSealed, type, v.email, accountLast4,
    ],
  );
  // The pay profile shows which account a paycheck goes to.
  if (accountChanged) {
    await q("UPDATE pay_profiles SET account_last4 = $2 WHERE employee_id = $1", [employeeId, accountLast4]);
  }
  // Field names only: never the values.
  await audit(v.email, "payroll.private", employeeId, { fields: changed });
  return getPrivate(v, employeeId);
}
