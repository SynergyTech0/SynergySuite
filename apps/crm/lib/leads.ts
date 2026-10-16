/**
 * Leads: prospects not yet qualified. Converting one creates an account, a contact and maybe an
 * opportunity, and marks the lead converted, all in one transaction: either everything is
 * there afterwards or nothing is. A converted lead is read-only.
 */
import { q, tx } from "./db";
import { keepHeld } from "./ediscovery";
import { assertCanEdit } from "./permissions";
import { OWNER_NAME, audit, iso, merged, ownerFor, type AuditRow } from "./records";
import {
  ACCOUNT_TYPES, LEAD_SOURCES, LEAD_STATUSES, STAGES,
  type ConvertResult, type Ctx, type Lead, type LeadSource, type LeadStatus,
} from "./types";
import { ForbiddenError, UserError, isoDate, likeTerm, money, oneOf, optionalEmail, required, text } from "./util";

type Row = AuditRow & {
  id: string; name: string; company: string; email: string; phone: string; status: LeadStatus; source: LeadSource;
  score: number | null; score_rationale: string; score_model: string; score_updated_at: Date | null; score_is_override: boolean;
  utm_source: string; utm_medium: string; utm_campaign: string; landing_path: string;
  converted_at: Date | null; converted_account_id: string | null; converted_contact_id: string | null;
  converted_opportunity_id: string | null; converted_account_name: string | null;
};

const SELECT = `SELECT l.*, ${OWNER_NAME("l")}, (SELECT a.name FROM accounts a WHERE a.id = l.converted_account_id) AS converted_account_name
  FROM leads l`;

function leadRow(ctx: Ctx, r: Row): Lead {
  return {
    id: r.id, name: r.name, company: r.company, email: r.email, phone: r.phone, status: r.status, source: r.source,
    score: r.score, scoreRationale: r.score_rationale, scoreModel: r.score_model, scoreUpdatedAt: iso(r.score_updated_at),
    scoreIsOverride: r.score_is_override,
    utmSource: r.utm_source, utmMedium: r.utm_medium, utmCampaign: r.utm_campaign, landingPath: r.landing_path,
    convertedAt: iso(r.converted_at), convertedAccountId: r.converted_account_id, convertedContactId: r.converted_contact_id,
    convertedOpportunityId: r.converted_opportunity_id, convertedAccountName: r.converted_account_name ?? "",
    ...audit(ctx, r),
  };
}

// "converted" is set by the convert flow, never typed in.
const EDITABLE_STATUSES = LEAD_STATUSES.filter((s) => s !== "converted");

function fields(b: Record<string, unknown>) {
  return {
    name: required(b.name, "Lead name"),
    company: text(b.company, 200),
    email: optionalEmail(b.email),
    phone: text(b.phone, 40),
    status: oneOf(b.status, EDITABLE_STATUSES, "new", "status"),
    source: oneOf(b.source, LEAD_SOURCES, "other", "source"),
  };
}

export type ListLeads = { q?: string; status?: string; source?: string; mine?: boolean };

export async function list(ctx: Ctx, f: ListLeads = {}): Promise<Lead[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.q) {
    params.push(likeTerm(f.q));
    const p = `$${params.length}`;
    where.push(`(l.name ILIKE ${p} OR l.company ILIKE ${p} OR l.email ILIKE ${p})`);
  }
  if (f.status === "open") where.push("l.status NOT IN ('converted','unqualified')");
  else if (f.status) {
    params.push(f.status);
    where.push(`l.status = $${params.length}`);
  }
  if (f.source) {
    params.push(f.source);
    where.push(`l.source = $${params.length}`);
  }
  if (f.mine) {
    params.push(ctx.email);
    where.push(`l.owner = $${params.length}`);
  }
  const rows = await q<Row>(`${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY l.updated_at DESC LIMIT 1000`, params);
  return rows.map((r) => leadRow(ctx, r));
}

async function load(id: string): Promise<Row> {
  const [row] = await q<Row>(`${SELECT} WHERE l.id = $1`, [id]);
  if (!row) throw new UserError("Lead not found", 404);
  return row;
}

export async function get(ctx: Ctx, id: string): Promise<Lead> {
  return leadRow(ctx, await load(id));
}

/** The lead as stored, for scoring. */
export async function raw(id: string) {
  return load(id);
}

export async function create(ctx: Ctx, b: Record<string, unknown>): Promise<Lead> {
  const v = fields(b);
  const owner = await ownerFor(ctx, b.owner, null);
  const [row] = await q<{ id: string }>(
    `INSERT INTO leads (name, company, email, phone, status, source, owner, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,
    [v.name, v.company, v.email, v.phone, v.status, v.source, owner, ctx.email],
  );
  return get(ctx, row.id);
}

export async function update(ctx: Ctx, id: string, b: Record<string, unknown>): Promise<Lead> {
  const cur = await load(id);
  assertCanEdit(ctx, cur);
  if (cur.status === "converted") throw new ForbiddenError("Converted leads are read-only");
  const v = fields(merged({ name: cur.name, company: cur.company, email: cur.email, phone: cur.phone, status: cur.status, source: cur.source }, b));
  const owner = await ownerFor(ctx, b.owner, cur.owner);
  await q(
    `UPDATE leads SET name=$2, company=$3, email=$4, phone=$5, status=$6, source=$7, owner=$8, updated_by=$9, updated_at=now() WHERE id = $1`,
    [id, v.name, v.company, v.email, v.phone, v.status, v.source, owner, ctx.email],
  );
  return get(ctx, id);
}

export async function remove(ctx: Ctx, id: string): Promise<void> {
  assertCanEdit(ctx, await load(id));
  await tx(async (tq) => {
    await keepHeld(tq, ctx.email, "activity", "t.related_type = 'lead' AND t.related_id = $1", [id]);
    await keepHeld(tq, ctx.email, "lead", "t.id = $1", [id]);
    await tq("DELETE FROM activities WHERE related_type = 'lead' AND related_id = $1", [id]);
    await tq("DELETE FROM leads WHERE id = $1", [id]);
  });
}

export async function convert(ctx: Ctx, id: string, b: Record<string, unknown>): Promise<ConvertResult> {
  const accountName = required(b.accountName, "Account name");
  const accountType = oneOf(b.accountType, ACCOUNT_TYPES, "prospect", "account type");
  const contactName = required(b.contactName, "Contact name");
  const contactEmail = optionalEmail(b.contactEmail);
  const contactPhone = text(b.contactPhone, 40);
  const contactTitle = text(b.contactTitle, 120);
  const withOpp = b.createOpportunity === true || b.createOpportunity === "on" || b.createOpportunity === "true";
  const opp = withOpp
    ? {
        name: required(b.opportunityName, "Opportunity name"),
        amount: money(b.amount),
        stage: oneOf(b.stage, STAGES, "prospecting", "stage"),
        closeDate: isoDate(b.closeDate, "close date"),
      }
    : null;

  return tx(async (tq) => {
    // Locked so two people converting the same lead at once can't both succeed.
    const [lead] = await tq<{ owner: string; status: LeadStatus }>("SELECT owner, status FROM leads WHERE id = $1 FOR UPDATE", [id]);
    if (!lead) throw new UserError("Lead not found", 404);
    assertCanEdit(ctx, lead);
    if (lead.status === "converted") throw new UserError("This lead has already been converted", 409);
    const owner = await ownerFor(ctx, b.owner, lead.owner, tq);

    const [account] = await tq<{ id: string }>(
      "INSERT INTO accounts (name, type, owner, created_by, updated_by) VALUES ($1,$2,$3,$4,$4) RETURNING id",
      [accountName, accountType, owner, ctx.email],
    );
    const [contact] = await tq<{ id: string }>(
      `INSERT INTO contacts (account_id, name, email, phone, title, owner, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
      [account.id, contactName, contactEmail, contactPhone, contactTitle, owner, ctx.email],
    );
    let opportunityId: string | null = null;
    if (opp) {
      const [row] = await tq<{ id: string }>(
        `INSERT INTO opportunities (account_id, name, amount, stage, close_date, owner, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
        [account.id, opp.name, opp.amount, opp.stage, opp.closeDate, owner, ctx.email],
      );
      opportunityId = row.id;
    }
    await tq(
      `UPDATE leads SET status='converted', converted_at=now(), converted_account_id=$2, converted_contact_id=$3,
         converted_opportunity_id=$4, updated_by=$5, updated_at=now() WHERE id = $1`,
      [id, account.id, contact.id, opportunityId, ctx.email],
    );
    return { accountId: account.id, contactId: contact.id, opportunityId };
  });
}

/** A person's own score. It sticks: the model never replaces it. `null` clears it so the model may score again. */
export async function overrideScore(ctx: Ctx, id: string, score: unknown, note?: unknown): Promise<Lead> {
  const cur = await load(id);
  assertCanEdit(ctx, cur);
  if (score === null || score === "" || score === undefined) {
    await q(
      `UPDATE leads SET score=NULL, score_rationale='', score_model='', score_updated_at=NULL, score_is_override=false,
         updated_by=$2, updated_at=now() WHERE id = $1`,
      [id, ctx.email],
    );
  } else {
    const n = Number(score);
    if (!Number.isInteger(n) || n < 0 || n > 100) throw new UserError("A score is a whole number from 0 to 100");
    await q(
      `UPDATE leads SET score=$2, score_rationale=$3, score_model='manual', score_updated_at=now(), score_is_override=true,
         updated_by=$4, updated_at=now() WHERE id = $1`,
      [id, n, text(note, 600), ctx.email],
    );
  }
  return get(ctx, id);
}

/** Stores a model's score unless someone set one by hand in the meantime. */
export async function saveAiScore(id: string, score: number, rationale: string, model: string): Promise<boolean> {
  const rows = await q(
    `UPDATE leads SET score=$2, score_rationale=$3, score_model=$4, score_updated_at=now()
     WHERE id = $1 AND NOT score_is_override RETURNING id`,
    [id, score, rationale, model],
  );
  return rows.length > 0;
}

export type IntakeInput = {
  name: string; email: string; company: string; phone: string; message: string;
  utmSource: string; utmMedium: string; utmCampaign: string; landingPath: string;
};

/** Reads a web form post: camelCase or utm_* names, everything untrusted and cut to size. */
export function intakeFields(b: Record<string, unknown>): IntakeInput {
  const pick = (...keys: string[]) => keys.map((k) => b[k]).find((v) => v !== undefined && v !== null && v !== "");
  const v = {
    name: required(pick("name", "full_name"), "Name"),
    email: optionalEmail(pick("email")),
    company: text(pick("company"), 200),
    phone: text(pick("phone"), 40),
    message: text(pick("message"), 2000),
    utmSource: text(pick("utmSource", "utm_source"), 120),
    utmMedium: text(pick("utmMedium", "utm_medium"), 120),
    utmCampaign: text(pick("utmCampaign", "utm_campaign"), 120),
    landingPath: text(pick("landingPath", "landing_path"), 255),
  };
  if (!v.email && !v.phone) throw new UserError("An email address or phone number is required");
  return v;
}

/** A lead from the website. The message, if any, is kept as a note on the lead. */
export async function intake(owner: string, v: IntakeInput): Promise<string> {
  return tx(async (tq) => {
    const [row] = await tq<{ id: string }>(
      `INSERT INTO leads (name, company, email, phone, status, source, owner, utm_source, utm_medium, utm_campaign, landing_path, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'new','web',$5,$6,$7,$8,$9,'web form','web form') RETURNING id`,
      [v.name, v.company, v.email, v.phone, owner, v.utmSource, v.utmMedium, v.utmCampaign, v.landingPath],
    );
    if (v.message) {
      await tq(
        `INSERT INTO activities (type, subject, body, status, assignee, related_type, related_id, created_by, updated_by)
         VALUES ('note', 'Message from the web form', $1, 'completed', $2, 'lead', $3, 'web form', 'web form')`,
        [v.message, owner, row.id],
      );
    }
    return row.id;
  });
}
