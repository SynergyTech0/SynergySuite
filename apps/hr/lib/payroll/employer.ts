import { audit, q } from "../db";
import type { Viewer } from "../hr";
import { open, seal } from "../secret";
import { UserError, oneOf, text } from "../util";
import { type AccountType, type AchCompany, validAccount, validRouting } from "./nacha";
import { requirePayroll } from "./runs";

/**
 * The employer as the IRS, the states and the bank know it: EIN, legal name and address for tax
 * forms, state account numbers, the contact the SSA asks for with W-2 files, and the bank's details
 * for direct deposit files. The company's own account number (for balanced deposit files) is sealed.
 */

export interface AchSettings {
  /** Your bank: its routing number and name. */
  odfiRouting: string;
  odfiName: string;
  /** Immediate origin and company ID as your bank gave them; usually 1 + EIN for both. */
  originId: string;
  companyId: string;
  /** How the company name appears on employees' statements, 16 characters. */
  companyName: string;
  /** Add one debit from the company account to balance each file. */
  balanced: boolean;
  offsetRouting: string;
  offsetType: AccountType;
  offsetLast4: string;
}

export interface Employer {
  ein: string;
  legalName: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  /** State withholding account numbers, by state. */
  stateIds: Record<string, string>;
  /** Who the SSA contacts about W-2 files. */
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  /** User ID the SSA issues for Business Services Online, for W-2 files. */
  bsoUserId: string;
  ach: AchSettings;
}

const EMPTY_ACH: AchSettings = {
  odfiRouting: "", odfiName: "", originId: "", companyId: "", companyName: "", balanced: false, offsetRouting: "", offsetType: "checking", offsetLast4: "",
};

const EMPTY: Employer = {
  ein: "", legalName: "", address1: "", address2: "", city: "", state: "", zip: "", phone: "", stateIds: {},
  contactName: "", contactEmail: "", contactPhone: "", bsoUserId: "", ach: EMPTY_ACH,
};

function merge(raw: Partial<Employer> | null | undefined): Employer {
  return { ...EMPTY, ...raw, stateIds: { ...raw?.stateIds }, ach: { ...EMPTY_ACH, ...raw?.ach } };
}

export async function getEmployer(v: Viewer): Promise<Employer> {
  requirePayroll(v);
  const [r] = await q<{ employer: Partial<Employer> }>("SELECT employer FROM pay_settings WHERE id = 1");
  return merge(r?.employer);
}

/** The deposit file's company block, with the offset account opened. Callers check payroll rights. */
export async function achCompany(): Promise<{ employer: Employer; company: AchCompany }> {
  const [r] = await q<{ employer: Partial<Employer>; ach_offset_sealed: string; company_name: string }>(
    "SELECT employer, ach_offset_sealed, company_name FROM pay_settings WHERE id = 1",
  );
  const e = merge(r?.employer);
  const a = e.ach;
  const missing = [
    !a.odfiRouting && "your bank's routing number", !a.odfiName && "your bank's name", !a.originId && "the origin ID", !a.companyId && "the company ID",
  ].filter(Boolean);
  if (missing.length) throw new UserError(`Set up direct deposit in payroll settings first: ${missing.join(", ")}`, 409);
  const offsetAccount = a.balanced ? open(r.ach_offset_sealed) : "";
  if (a.balanced && (!offsetAccount || !a.offsetRouting)) throw new UserError("Add the company account to balance deposit files in payroll settings", 409);
  return {
    employer: e,
    company: {
      odfiRouting: a.odfiRouting, odfiName: a.odfiName, originId: a.originId, originName: e.legalName || r.company_name,
      companyName: a.companyName || e.legalName || r.company_name, companyId: a.companyId,
      offset: a.balanced ? { routing: a.offsetRouting, account: offsetAccount, type: a.offsetType } : null,
    },
  };
}

type Body = Record<string, unknown>;

const STATE = /^[A-Z]{2}$/;

export async function saveEmployer(v: Viewer, b: Body): Promise<Employer> {
  const cur = await getEmployer(v);
  const t = (k: keyof Employer, max: number): string => (k in b ? text(b[k], max) : String(cur[k]));
  const ein = t("ein", 10).replace(/\D/g, "");
  if (ein && ein.length !== 9) throw new UserError("EIN is 9 digits");
  const state = t("state", 2).toUpperCase();
  if (state && !STATE.test(state)) throw new UserError("State is a two-letter code");
  const zip = t("zip", 10);
  if (zip && !/^\d{5}(-?\d{4})?$/.test(zip)) throw new UserError("ZIP code is 5 or 9 digits");
  const contactEmail = t("contactEmail", 200);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new UserError("Enter the contact's email address");
  const bsoUserId = t("bsoUserId", 8).toUpperCase();
  if (bsoUserId && !/^[A-Z0-9]{8}$/.test(bsoUserId)) throw new UserError("The BSO user ID is 8 letters or digits");

  let stateIds = cur.stateIds;
  if (b.stateIds && typeof b.stateIds === "object") {
    stateIds = {};
    for (const [k, val] of Object.entries(b.stateIds as Record<string, unknown>)) {
      const s = k.toUpperCase();
      const id = text(val, 30);
      if (!STATE.test(s)) throw new UserError("State account numbers are listed by two-letter state");
      if (id) stateIds[s] = id;
    }
  }

  const given = (b.ach ?? {}) as Partial<Record<keyof AchSettings, unknown>>;
  const at = (k: keyof AchSettings, max: number): string => (k in given ? text(given[k], max) : String(cur.ach[k]));
  const ach: AchSettings = {
    odfiRouting: at("odfiRouting", 9).replace(/\s/g, ""),
    odfiName: at("odfiName", 23),
    originId: at("originId", 10),
    companyId: at("companyId", 10),
    companyName: at("companyName", 16),
    balanced: "balanced" in given ? Boolean(given.balanced) : cur.ach.balanced,
    offsetRouting: at("offsetRouting", 9).replace(/\s/g, ""),
    offsetType: "offsetType" in given ? oneOf(given.offsetType, ["checking", "savings"] as const, "checking") : cur.ach.offsetType,
    offsetLast4: cur.ach.offsetLast4,
  };
  if (ach.odfiRouting && !validRouting(ach.odfiRouting)) throw new UserError("Your bank's routing number is not valid");
  if (ach.offsetRouting && !validRouting(ach.offsetRouting)) throw new UserError("The company account's routing number is not valid");
  for (const [k, name] of [["originId", "origin ID"], ["companyId", "company ID"]] as const) {
    if (ach[k] && !/^[0-9A-Za-z ]{1,10}$/.test(ach[k])) throw new UserError(`The ${name} is up to 10 letters or digits`);
  }

  const fields = Object.keys(b).filter((k) => k !== "ach").concat(Object.keys(given).map((k) => `ach.${k}`));
  let sealedSql = "";
  const params: unknown[] = [];
  if ("offsetAccount" in given) {
    const acct = String(given.offsetAccount ?? "").replace(/\s/g, "");
    if (acct && !validAccount(acct)) throw new UserError("The company account number is up to 17 letters or digits");
    params.push(acct ? seal(acct) : "");
    sealedSql = ", ach_offset_sealed = $3";
    ach.offsetLast4 = acct.slice(-4);
  }

  const next: Employer = {
    ein, legalName: t("legalName", 200), address1: t("address1", 200), address2: t("address2", 200), city: t("city", 100), state, zip,
    phone: t("phone", 30), stateIds, contactName: t("contactName", 100), contactEmail, contactPhone: t("contactPhone", 30), bsoUserId, ach,
  };
  await q(`UPDATE pay_settings SET employer = $1, updated_at = now(), updated_by = $2${sealedSql} WHERE id = 1`, [JSON.stringify(next), v.email, ...params]);
  await audit(v.email, "payroll.employer", "", { fields });
  return next;
}
