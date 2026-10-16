import type { Me } from "./api";
import { holdChecker } from "./compliance";
import { q, tx, type Tq } from "./db";
import { UserError, cents, cleanEmail, text, uuidish } from "./util";

export const TYPES = ["MSA", "NDA", "SOW", "Customer", "Vendor", "Employment", "Lease", "License", "Subscription", "Partnership", "Other"];
export const STATUSES = ["draft", "review", "approved", "signing", "active", "expired", "terminated"] as const;
export type Status = (typeof STATUSES)[number];
export type Role = "admin" | "owner" | "editor" | "viewer" | "approver";

/** The legal team: sees every contract and keeps the template and clause library. */
export function admins(): string[] {
  return (process.env.CONTRACTS_ADMIN_EMAILS ?? process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(email: string): boolean {
  return admins().includes(email.toLowerCase());
}

/** With no legal team set, everyone keeps the library; contracts stay visible only to their people. */
export function canKeepLibrary(email: string): boolean {
  const list = admins();
  return !list.length || list.includes(email.toLowerCase());
}

/**
 * SQL for "contracts `$p` can see" against alias c: owner, creator, shared people and approvers.
 * The legal team sees everything (checked in code, see visible()).
 */
export function visibleSql(p: number): string {
  return `(c.owner = $${p} OR c.created_by = $${p}
    OR EXISTS (SELECT 1 FROM contract_people x WHERE x.contract_id = c.id AND x.email = $${p})
    OR EXISTS (SELECT 1 FROM approvals a WHERE a.contract_id = c.id AND a.approver = $${p}))`;
}

export function visible(email: string, p: number): string {
  return isAdmin(email) ? "true" : visibleSql(p);
}

export const COLS = `c.id, c.number, c.title, c.type, c.status, c.counterparty, c.counterparty_email, c.owner,
  c.value_cents::float8 AS value_cents, c.currency, to_char(c.start_day, 'YYYY-MM-DD') AS start_day,
  to_char(c.end_day, 'YYYY-MM-DD') AS end_day, c.auto_renew, c.renewal_months, c.notice_days, c.crm_deal,
  c.sign_ref, c.sign_url, c.signed_at, c.terminated_at, c.template_id, c.created_by, c.created_at, c.modified_at,
  (c.end_day - current_date) AS days_left,
  to_char(c.end_day - c.notice_days, 'YYYY-MM-DD') AS notice_day`;

export type ContractRow = {
  id: string; number: string; title: string; type: string; status: Status; counterparty: string; counterparty_email: string;
  owner: string; value_cents: number | null; currency: string; start_day: string | null; end_day: string | null;
  auto_renew: boolean; renewal_months: number; notice_days: number; crm_deal: string; sign_ref: string | null; sign_url: string;
  signed_at: Date | null; terminated_at: Date | null; template_id: string | null; created_by: string; created_at: Date;
  modified_at: Date; days_left: number | null; notice_day: string | null;
};

export async function logEvent(tq: Tq, contractId: string, kind: string, detail: string, actor: string): Promise<void> {
  await tq(`INSERT INTO contract_events (contract_id, kind, detail, actor) VALUES ($1, $2, $3, $4)`, [contractId, kind, text(detail, 500), actor]);
}

/** The contract and what `email` may do with it. Not found when they can't see it. */
export async function access(email: string, id: string): Promise<{ c: ContractRow; role: Role }> {
  if (!uuidish(id)) throw new UserError("Not found", 404);
  const [c] = await q<ContractRow>(`SELECT ${COLS} FROM contracts c WHERE c.id = $1 AND c.held_deleted_at IS NULL`, [id]);
  if (!c) throw new UserError("Not found", 404);
  if (c.owner === email) return { c, role: "owner" };
  if (isAdmin(email)) return { c, role: "admin" };
  const [p] = await q<{ role: "editor" | "viewer" }>(`SELECT role FROM contract_people WHERE contract_id = $1 AND email = $2`, [id, email]);
  if (p) return { c, role: p.role };
  if (c.created_by === email) return { c, role: "viewer" };
  const [a] = await q(`SELECT 1 FROM approvals WHERE contract_id = $1 AND approver = $2`, [id, email]);
  if (a) return { c, role: "approver" };
  throw new UserError("Not found", 404);
}

const EDIT: Role[] = ["admin", "owner", "editor"];

export async function requireEdit(email: string, id: string) {
  const a = await access(email, id);
  if (!EDIT.includes(a.role)) throw new UserError("You can look at this contract but not change it", 403);
  return a;
}

export async function requireOwner(email: string, id: string) {
  const a = await access(email, id);
  if (a.role !== "owner" && a.role !== "admin") throw new UserError("Only the contract's owner or the legal team can do that", 403);
  return a;
}

function day(v: unknown, what: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new UserError(`${what} must be a date`);
  return s;
}

function int(v: unknown, what: string, min: number, max: number): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new UserError(`${what} must be a whole number from ${min} to ${max}`);
  return n;
}

function currency(v: unknown): string {
  const s = text(v, 3).toUpperCase();
  if (s && !/^[A-Z]{3}$/.test(s)) throw new UserError("Currency must be a three-letter code like USD");
  return s || "USD";
}

export type ContractInput = {
  title?: unknown; type?: unknown; counterparty?: unknown; counterpartyEmail?: unknown; owner?: unknown; value?: unknown;
  currency?: unknown; startDay?: unknown; endDay?: unknown; autoRenew?: unknown; renewalMonths?: unknown; noticeDays?: unknown;
  body?: unknown; crmDeal?: unknown; templateId?: unknown; versionNote?: unknown;
};

async function nextNumber(tq: Tq): Promise<string> {
  const [{ n }] = await tq<{ n: string }>(`SELECT nextval('contract_number_seq') AS n`);
  return `CTR-${String(n).padStart(4, "0")}`;
}

export async function createContract(me: Me, input: ContractInput): Promise<{ id: string; number: string }> {
  const title = text(input.title, 200);
  if (!title) throw new UserError("Give the contract a title");
  const type = TYPES.includes(String(input.type)) ? String(input.type) : "Other";
  const owner = input.owner ? cleanEmail(input.owner) : me.email;
  const cpEmail = text(input.counterpartyEmail, 200).toLowerCase();
  if (cpEmail) cleanEmail(cpEmail);
  const start = day(input.startDay, "Start date");
  const end = day(input.endDay, "End date");
  if (start && end && end < start) throw new UserError("The end date is before the start date");
  const body = text(input.body, 400_000);
  const templateId = uuidish(input.templateId) ? input.templateId : null;
  return tx(async (tq) => {
    const number = await nextNumber(tq);
    const [row] = await tq<{ id: string }>(
      `INSERT INTO contracts (number, title, type, counterparty, counterparty_email, owner, value_cents, currency, start_day, end_day,
         auto_renew, renewal_months, notice_days, body, crm_deal, template_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
      [
        number, title, type, text(input.counterparty, 200), cpEmail, owner, cents(input.value, "Value"), currency(input.currency), start, end,
        input.autoRenew === true, int(input.renewalMonths, "Renewal term", 1, 120) ?? 12, int(input.noticeDays, "Notice period", 0, 730) ?? 30,
        body, text(input.crmDeal, 200), templateId, me.email,
      ],
    );
    if (body) await tq(`INSERT INTO contract_versions (contract_id, n, body, note, author) VALUES ($1, 1, $2, $3, $4)`, [row.id, body, "First draft", me.email]);
    if (owner !== me.email) {
      await tq(`INSERT INTO contract_people (contract_id, email, role, added_by) VALUES ($1, $2, 'editor', $2)`, [row.id, me.email]);
    }
    await logEvent(tq, row.id, "created", title, me.email);
    return { id: row.id, number };
  });
}

/** Terms can change until the contract is signed; the text only while it is a draft. */
export async function updateContract(me: Me, id: string, input: ContractInput): Promise<void> {
  const { c, role } = await requireEdit(me.email, id);
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (input.title !== undefined) {
    const t = text(input.title, 200);
    if (!t) throw new UserError("Give the contract a title");
    set("title", t);
  }
  if (input.type !== undefined) set("type", TYPES.includes(String(input.type)) ? String(input.type) : "Other");
  if (input.counterparty !== undefined) set("counterparty", text(input.counterparty, 200));
  if (input.counterpartyEmail !== undefined) {
    const e = text(input.counterpartyEmail, 200).toLowerCase();
    if (e) cleanEmail(e);
    set("counterparty_email", e);
  }
  let newOwner: string | null = null;
  if (input.owner !== undefined) {
    if (role !== "owner" && role !== "admin") throw new UserError("Only the owner or the legal team can hand a contract over", 403);
    newOwner = cleanEmail(input.owner);
    set("owner", newOwner);
  }
  if (input.value !== undefined) set("value_cents", cents(input.value, "Value"));
  if (input.currency !== undefined) set("currency", currency(input.currency));
  const start = input.startDay !== undefined ? day(input.startDay, "Start date") : c.start_day;
  const end = input.endDay !== undefined ? day(input.endDay, "End date") : c.end_day;
  if (start && end && end < start) throw new UserError("The end date is before the start date");
  if (input.startDay !== undefined) set("start_day", start);
  if (input.endDay !== undefined) set("end_day", end);
  if (input.autoRenew !== undefined) set("auto_renew", input.autoRenew === true);
  const rm = int(input.renewalMonths, "Renewal term", 1, 120);
  if (rm !== undefined) set("renewal_months", rm);
  const nd = int(input.noticeDays, "Notice period", 0, 730);
  if (nd !== undefined) set("notice_days", nd);
  if (input.crmDeal !== undefined) set("crm_deal", text(input.crmDeal, 200));
  let newBody: string | null = null;
  if (input.body !== undefined) {
    if (c.status !== "draft") throw new UserError("The text is locked once a contract leaves draft. Move it back to draft to change it.", 409);
    newBody = text(input.body, 400_000);
    set("body", newBody);
  }
  if (!sets.length) return;
  await tx(async (tq) => {
    await tq(`UPDATE contracts SET ${sets.join(", ")}, modified_at = now() WHERE id = $1`, params);
    if (newBody !== null) {
      const [last] = await tq<{ n: number; body: string }>(`SELECT n, body FROM contract_versions WHERE contract_id = $1 ORDER BY n DESC LIMIT 1`, [id]);
      if (!last || last.body !== newBody) {
        await tq(`INSERT INTO contract_versions (contract_id, n, body, note, author) VALUES ($1, $2, $3, $4, $5)`, [
          id, (last?.n ?? 0) + 1, newBody, text(input.versionNote, 200), me.email,
        ]);
        await logEvent(tq, id, "edited", `Version ${(last?.n ?? 0) + 1}${input.versionNote ? `: ${text(input.versionNote, 200)}` : ""}`, me.email);
      }
    }
    if (newOwner && newOwner !== c.owner) {
      await logEvent(tq, id, "owner", `${c.owner} handed it to ${newOwner}`, me.email);
    } else if (newBody === null) {
      await logEvent(tq, id, "updated", "Terms changed", me.email);
    }
  });
}

export async function deleteContract(me: Me, id: string): Promise<{ held: boolean }> {
  const { c } = await requireOwner(me.email, id);
  const onHold = holdChecker();
  const people = [c.owner, c.created_by, ...(await q<{ email: string }>(`SELECT email FROM contract_people WHERE contract_id = $1`, [id])).map((p) => p.email)];
  let held = false;
  for (const p of people) if (await onHold(p)) held = true;
  if (held) await q(`UPDATE contracts SET held_deleted_at = now() WHERE id = $1`, [id]);
  else await q(`DELETE FROM contracts WHERE id = $1`, [id]);
  return { held };
}

export type ListFilter = { view?: string; status?: string; type?: string; q?: string };

/** The contracts list: everything `me` can see, with an optional view and filters. */
export async function listContracts(me: Me, f: ListFilter = {}) {
  await sweep();
  const params: unknown[] = [me.email];
  const where = [visible(me.email, 1), "c.held_deleted_at IS NULL"];
  if (f.view === "mine") where.push(`(c.owner = $1 OR c.created_by = $1)`);
  if (f.view === "expiring") where.push(`c.status = 'active' AND c.end_day IS NOT NULL AND c.end_day <= current_date + 90`);
  if (f.view === "approvals") where.push(`EXISTS (SELECT 1 FROM approvals a WHERE a.contract_id = c.id AND a.approver = $1 AND a.status = 'pending')`);
  if (f.view === "signing") where.push(`c.status = 'signing'`);
  if (f.status && (STATUSES as readonly string[]).includes(f.status)) {
    params.push(f.status);
    where.push(`c.status = $${params.length}`);
  }
  if (f.type && TYPES.includes(f.type)) {
    params.push(f.type);
    where.push(`c.type = $${params.length}`);
  }
  if (f.q) {
    params.push(`%${f.q.toLowerCase().replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where.push(`(lower(c.title) LIKE $${params.length} OR lower(c.counterparty) LIKE $${params.length} OR lower(c.number) LIKE $${params.length})`);
  }
  return q<ContractRow>(
    `SELECT ${COLS} FROM contracts c WHERE ${where.join(" AND ")}
     ORDER BY CASE c.status WHEN 'review' THEN 0 WHEN 'signing' THEN 1 WHEN 'approved' THEN 2 WHEN 'draft' THEN 3 WHEN 'active' THEN 4 ELSE 5 END,
       c.end_day NULLS LAST, c.modified_at DESC
     LIMIT 1000`,
    params,
  );
}

/** One contract with everything on its page. */
export async function getContract(me: Me, id: string) {
  await sweep();
  const { c, role } = await access(me.email, id);
  const [{ body }] = await q<{ body: string }>(`SELECT body FROM contracts WHERE id = $1`, [id]);
  const [people, approvals, obligations, files, events, versions, review] = await Promise.all([
    q(`SELECT email, role, added_by, added_at FROM contract_people WHERE contract_id = $1 ORDER BY added_at`, [id]),
    q(
      `SELECT id, round, step, approver, status, comment, requested_by, requested_at, decided_at FROM approvals
       WHERE contract_id = $1 AND round = (SELECT max(round) FROM approvals WHERE contract_id = $1) ORDER BY step`,
      [id],
    ),
    q(
      `SELECT id, title, notes, to_char(due_day, 'YYYY-MM-DD') AS due_day, assignee, done_at, done_by, created_by
       FROM obligations WHERE contract_id = $1 AND held_deleted_at IS NULL ORDER BY done_at IS NOT NULL, due_day NULLS LAST, created_at`,
      [id],
    ),
    q(
      `SELECT id, kind, name, type, size, uploaded_by, uploaded_at FROM contract_files
       WHERE contract_id = $1 AND held_deleted_at IS NULL ORDER BY uploaded_at DESC`,
      [id],
    ),
    q(`SELECT kind, detail, actor, at FROM contract_events WHERE contract_id = $1 ORDER BY at DESC, id DESC LIMIT 200`, [id]),
    q(`SELECT n, note, author, created_at, length(body) AS chars FROM contract_versions WHERE contract_id = $1 ORDER BY n DESC`, [id]),
    q<{ ai_review: unknown; ai_reviewed_at: Date | null }>(`SELECT ai_review, ai_reviewed_at FROM contracts WHERE id = $1`, [id]),
  ]);
  return { ...c, body, role, people, approvals, obligations, files, events, versions, aiReview: review[0]?.ai_review ?? null, aiReviewedAt: review[0]?.ai_reviewed_at ?? null };
}

export async function share(me: Me, id: string, input: { email?: unknown; role?: unknown }): Promise<void> {
  await requireEdit(me.email, id);
  const email = cleanEmail(input.email);
  const role = input.role === "editor" ? "editor" : "viewer";
  await tx(async (tq) => {
    await tq(
      `INSERT INTO contract_people (contract_id, email, role, added_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (contract_id, email) DO UPDATE SET role = EXCLUDED.role`,
      [id, email, role, me.email],
    );
    await logEvent(tq, id, "shared", `${email} can ${role === "editor" ? "edit" : "view"}`, me.email);
  });
}

export async function unshare(me: Me, id: string, email: string): Promise<void> {
  await requireEdit(me.email, id);
  await tx(async (tq) => {
    await tq(`DELETE FROM contract_people WHERE contract_id = $1 AND email = $2`, [id, email.toLowerCase()]);
    await logEvent(tq, id, "unshared", email.toLowerCase(), me.email);
  });
}

// ---------- approvals ----------

/** Sends a draft to the approvers, who decide one after another in the order given. */
export async function submitForApproval(me: Me, id: string, input: { approvers?: unknown; note?: unknown }): Promise<void> {
  const { c } = await requireEdit(me.email, id);
  if (c.status !== "draft") throw new UserError("Only a draft can be sent for approval", 409);
  const list = Array.isArray(input.approvers) ? input.approvers.map((a) => cleanEmail(a)) : [];
  const approvers = [...new Set(list)];
  if (!approvers.length) throw new UserError("Add at least one approver");
  if (approvers.length > 10) throw new UserError("At most ten approvers");
  await tx(async (tq) => {
    const [{ r }] = await tq<{ r: number }>(`SELECT COALESCE(max(round), 0) + 1 AS r FROM approvals WHERE contract_id = $1`, [id]);
    for (const [i, a] of approvers.entries()) {
      await tq(`INSERT INTO approvals (contract_id, round, step, approver, requested_by) VALUES ($1, $2, $3, $4, $5)`, [id, r, i + 1, a, me.email]);
    }
    await tq(`UPDATE contracts SET status = 'review', modified_at = now() WHERE id = $1`, [id]);
    await logEvent(tq, id, "review", `Sent to ${approvers.join(", ")}${input.note ? `: ${text(input.note, 300)}` : ""}`, me.email);
  });
}

export async function decide(me: Me, id: string, input: { decision?: unknown; comment?: unknown }): Promise<{ status: Status }> {
  const { c } = await access(me.email, id);
  if (c.status !== "review") throw new UserError("This contract is not waiting for approval", 409);
  const approve = input.decision === "approve";
  if (!approve && input.decision !== "reject") throw new UserError("Choose approve or reject");
  const comment = text(input.comment, 2000);
  if (!approve && !comment) throw new UserError("Say why, so the owner knows what to change");
  return tx(async (tq) => {
    const [step] = await tq<{ id: string; approver: string; round: number }>(
      `SELECT id, approver, round FROM approvals WHERE contract_id = $1 AND status = 'pending'
         AND round = (SELECT max(round) FROM approvals WHERE contract_id = $1)
       ORDER BY step LIMIT 1 FOR UPDATE`,
      [id],
    );
    if (!step || step.approver !== me.email) throw new UserError("It isn't your turn to approve this contract", 403);
    await tq(`UPDATE approvals SET status = $2, comment = $3, decided_at = now() WHERE id = $1`, [step.id, approve ? "approved" : "rejected", comment]);
    let status: Status = "review";
    if (!approve) {
      await tq(`UPDATE approvals SET status = 'cancelled' WHERE contract_id = $1 AND round = $2 AND status = 'pending'`, [id, step.round]);
      status = "draft";
    } else {
      const [left] = await tq(`SELECT 1 FROM approvals WHERE contract_id = $1 AND round = $2 AND status = 'pending'`, [id, step.round]);
      if (!left) status = "approved";
    }
    if (status !== "review") await tq(`UPDATE contracts SET status = $2, modified_at = now() WHERE id = $1`, [id, status]);
    await logEvent(tq, id, approve ? "approved" : "rejected", comment, me.email);
    return { status };
  });
}

/** Reopens the text: pending approvals are cancelled and any signature request is dropped. */
export async function backToDraft(me: Me, id: string): Promise<void> {
  const { c } = await requireEdit(me.email, id);
  if (!["review", "approved", "signing"].includes(c.status)) throw new UserError("Only a contract that isn't signed yet can go back to draft", 409);
  await tx(async (tq) => {
    await tq(`UPDATE approvals SET status = 'cancelled' WHERE contract_id = $1 AND status = 'pending'`, [id]);
    await tq(`UPDATE contracts SET status = 'draft', sign_ref = NULL, modified_at = now() WHERE id = $1`, [id]);
    await logEvent(tq, id, "draft", "Moved back to draft", me.email);
  });
}

// ---------- signature and life cycle ----------

/** Records that the signed copy is in: the contract is in force. */
export async function markSigned(actor: string, id: string, tq?: Tq): Promise<void> {
  const run = async (t: Tq) => {
    await t(`UPDATE contracts SET status = 'active', signed_at = COALESCE(signed_at, now()), modified_at = now() WHERE id = $1`, [id]);
    await t(`UPDATE contracts SET start_day = current_date WHERE id = $1 AND start_day IS NULL`, [id]);
    await logEvent(t, id, "signed", "Signed by every party", actor);
  };
  if (tq) return run(tq);
  return tx(run);
}

export async function signedByHand(me: Me, id: string): Promise<void> {
  const { c } = await requireEdit(me.email, id);
  if (!["approved", "signing"].includes(c.status)) throw new UserError("Approve the contract before marking it signed", 409);
  await markSigned(me.email, id);
}

export async function terminate(me: Me, id: string, input: { reason?: unknown }): Promise<void> {
  const { c } = await requireOwner(me.email, id);
  if (c.status !== "active") throw new UserError("Only a contract in force can be terminated", 409);
  await tx(async (tq) => {
    await tq(`UPDATE contracts SET status = 'terminated', terminated_at = now(), auto_renew = false, modified_at = now() WHERE id = $1`, [id]);
    await logEvent(tq, id, "terminated", text(input.reason, 500), me.email);
  });
}

/** Extends the end date by a number of months, or to a given day, and puts the contract back in force. */
export async function renew(me: Me, id: string, input: { months?: unknown; endDay?: unknown }): Promise<{ endDay: string }> {
  const { c } = await requireEdit(me.email, id);
  if (!["active", "expired"].includes(c.status)) throw new UserError("Only a signed contract can be renewed", 409);
  const explicit = day(input.endDay, "New end date");
  const months = int(input.months, "Renewal term", 1, 120) ?? c.renewal_months;
  return tx(async (tq) => {
    const [row] = await tq<{ end_day: string }>(
      `UPDATE contracts SET status = 'active', modified_at = now(),
         end_day = COALESCE($2::date, (GREATEST(COALESCE(end_day, current_date), current_date) + make_interval(months => $3))::date)
       WHERE id = $1 RETURNING to_char(end_day, 'YYYY-MM-DD') AS end_day`,
      [id, explicit, months],
    );
    await logEvent(tq, id, "renewed", `Runs to ${row.end_day}`, me.email);
    return { endDay: row.end_day };
  });
}

const SWEEP_EVERY_MS = 10 * 60_000;
const gs = globalThis as unknown as { __contractsSweptAt?: number };

/**
 * Contracts past their end date renew themselves when they auto-renew and expire otherwise. Runs
 * at most every ten minutes per process, on the next request.
 */
export async function sweep(force = false): Promise<{ renewed: number; expired: number }> {
  const now = Date.now();
  if (!force && gs.__contractsSweptAt && now - gs.__contractsSweptAt < SWEEP_EVERY_MS) return { renewed: 0, expired: 0 };
  gs.__contractsSweptAt = now;
  return tx(async (tq) => {
    // Walk each lapsed auto-renewing contract forward one term at a time until it runs past today.
    const touched = new Set<string>();
    for (let i = 0; i < 240; i++) {
      const more = await tq<{ id: string }>(
        `UPDATE contracts SET end_day = (end_day + make_interval(months => renewal_months))::date, modified_at = now()
         WHERE status = 'active' AND auto_renew AND end_day < current_date AND held_deleted_at IS NULL RETURNING id`,
      );
      if (!more.length) break;
      for (const r of more) touched.add(r.id);
    }
    const renewed = touched.size
      ? await tq<{ id: string; end_day: string }>(`SELECT id, to_char(end_day, 'YYYY-MM-DD') AS end_day FROM contracts WHERE id = ANY($1::uuid[])`, [[...touched]])
      : [];
    for (const r of renewed) await logEvent(tq, r.id, "renewed", `Renewed by itself; runs to ${r.end_day}`, "system");
    const expired = await tq<{ id: string }>(
      `UPDATE contracts SET status = 'expired', modified_at = now()
       WHERE status = 'active' AND NOT auto_renew AND end_day < current_date AND held_deleted_at IS NULL RETURNING id`,
    );
    for (const r of expired) await logEvent(tq, r.id, "expired", "Reached its end date", "system");
    return { renewed: renewed.length, expired: expired.length };
  });
}

// ---------- obligations ----------

export async function addObligation(me: Me, id: string, input: { title?: unknown; notes?: unknown; dueDay?: unknown; assignee?: unknown }) {
  await requireEdit(me.email, id);
  const title = text(input.title, 300);
  if (!title) throw new UserError("Say what has to be done");
  const assignee = input.assignee ? cleanEmail(input.assignee) : null;
  return tx(async (tq) => {
    const [row] = await tq<{ id: string }>(
      `INSERT INTO obligations (contract_id, title, notes, due_day, assignee, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [id, title, text(input.notes, 4000), day(input.dueDay, "Due date"), assignee, me.email],
    );
    await logEvent(tq, id, "obligation", title, me.email);
    return row;
  });
}

async function obligation(me: Me, oid: string) {
  if (!uuidish(oid)) throw new UserError("Not found", 404);
  const [o] = await q<{ contract_id: string; assignee: string | null; title: string }>(
    `SELECT contract_id, assignee, title FROM obligations WHERE id = $1 AND held_deleted_at IS NULL`,
    [oid],
  );
  if (!o) throw new UserError("Not found", 404);
  const a = await access(me.email, o.contract_id);
  return { o, a };
}

export async function updateObligation(me: Me, oid: string, input: { title?: unknown; notes?: unknown; dueDay?: unknown; assignee?: unknown; done?: unknown }) {
  const { o, a } = await obligation(me, oid);
  const mayEdit = EDIT.includes(a.role);
  if (!mayEdit && !(o.assignee === me.email && Object.keys(input).every((k) => k === "done"))) {
    throw new UserError("You can look at this contract but not change it", 403);
  }
  const sets: string[] = [];
  const params: unknown[] = [oid];
  const set = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (input.title !== undefined) {
    const t = text(input.title, 300);
    if (!t) throw new UserError("Say what has to be done");
    set("title", t);
  }
  if (input.notes !== undefined) set("notes", text(input.notes, 4000));
  if (input.dueDay !== undefined) set("due_day", day(input.dueDay, "Due date"));
  if (input.assignee !== undefined) set("assignee", input.assignee ? cleanEmail(input.assignee) : null);
  if (input.done !== undefined) {
    set("done_at", input.done ? new Date() : null);
    set("done_by", input.done ? me.email : null);
  }
  if (!sets.length) return;
  await tx(async (tq) => {
    await tq(`UPDATE obligations SET ${sets.join(", ")}, modified_at = now() WHERE id = $1`, params);
    if (input.done !== undefined) await logEvent(tq, o.contract_id, input.done ? "done" : "reopened", o.title, me.email);
  });
}

export async function deleteObligation(me: Me, oid: string): Promise<void> {
  const { o, a } = await obligation(me, oid);
  if (!EDIT.includes(a.role)) throw new UserError("You can look at this contract but not change it", 403);
  const held = await holdChecker()(a.c.owner);
  if (held) await q(`UPDATE obligations SET held_deleted_at = now() WHERE id = $1`, [oid]);
  else await q(`DELETE FROM obligations WHERE id = $1`, [oid]);
  await tx((tq) => logEvent(tq, o.contract_id, "obligation removed", o.title, me.email));
}

// ---------- files ----------

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export async function addFile(me: Me, id: string, file: { name: string; type: string; bytes: Buffer; kind?: string }) {
  const { c } = await requireEdit(me.email, id);
  if (!file.bytes.length) throw new UserError("That file is empty");
  if (file.bytes.length > MAX_FILE_BYTES) throw new UserError("Files can be up to 25 MB");
  const kind = file.kind === "executed" ? "executed" : "attachment";
  return tx(async (tq) => {
    const [row] = await tq<{ id: string }>(
      `INSERT INTO contract_files (contract_id, kind, name, type, size, bytes, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [id, kind, text(file.name, 200) || "file", text(file.type, 120) || "application/octet-stream", file.bytes.length, file.bytes, me.email],
    );
    await logEvent(tq, id, kind === "executed" ? "executed copy" : "file", file.name, me.email);
    // The signed copy coming in is the signature, when no signing service told us first.
    if (kind === "executed" && ["approved", "signing"].includes(c.status)) await markSigned(me.email, id, tq);
    return row;
  });
}

export async function getFile(me: Me, fid: string) {
  if (!uuidish(fid)) throw new UserError("Not found", 404);
  const [f] = await q<{ contract_id: string; name: string; type: string; bytes: Buffer }>(
    `SELECT contract_id, name, type, bytes FROM contract_files WHERE id = $1 AND held_deleted_at IS NULL`,
    [fid],
  );
  if (!f) throw new UserError("Not found", 404);
  await access(me.email, f.contract_id);
  return f;
}

export async function deleteFile(me: Me, fid: string): Promise<void> {
  const f = await getFile(me, fid);
  const { c } = await requireEdit(me.email, f.contract_id);
  if (await holdChecker()(c.owner)) await q(`UPDATE contract_files SET held_deleted_at = now() WHERE id = $1`, [fid]);
  else await q(`DELETE FROM contract_files WHERE id = $1`, [fid]);
  await tx((tq) => logEvent(tq, f.contract_id, "file removed", f.name, me.email));
}

// ---------- versions ----------

export async function version(me: Me, id: string, n: number): Promise<{ n: number; body: string; note: string; author: string; created_at: Date }> {
  await access(me.email, id);
  const [v] = await q<{ n: number; body: string; note: string; author: string; created_at: Date }>(
    `SELECT n, body, note, author, created_at FROM contract_versions WHERE contract_id = $1 AND n = $2`,
    [id, n],
  );
  if (!v) throw new UserError("Not found", 404);
  return v;
}

// ---------- dashboard ----------

export async function dashboard(me: Me) {
  await sweep();
  const v = visible(me.email, 1);
  const [counts, value, windows, alerts, obligations, approvals] = await Promise.all([
    q<{ status: string; n: number }>(`SELECT c.status, count(*)::int AS n FROM contracts c WHERE ${v} AND c.held_deleted_at IS NULL GROUP BY c.status`, [me.email]),
    q<{ currency: string; total: number }>(
      `SELECT c.currency, sum(c.value_cents)::float8 AS total FROM contracts c
       WHERE ${v} AND c.held_deleted_at IS NULL AND c.status = 'active' AND c.value_cents IS NOT NULL GROUP BY c.currency ORDER BY total DESC`,
      [me.email],
    ),
    q<{ d30: number; d60: number; d90: number }>(
      `SELECT count(*) FILTER (WHERE c.end_day <= current_date + 30)::int AS d30,
              count(*) FILTER (WHERE c.end_day <= current_date + 60)::int AS d60,
              count(*) FILTER (WHERE c.end_day <= current_date + 90)::int AS d90
       FROM contracts c WHERE ${v} AND c.held_deleted_at IS NULL AND c.status = 'active' AND c.end_day >= current_date`,
      [me.email],
    ),
    // Inside the notice window: the last day to give notice has come, or is about to.
    q<ContractRow>(
      `SELECT ${COLS} FROM contracts c WHERE ${v} AND c.held_deleted_at IS NULL AND c.status = 'active' AND c.end_day IS NOT NULL
         AND c.end_day - c.notice_days <= current_date + 14
       ORDER BY c.end_day - c.notice_days LIMIT 50`,
      [me.email],
    ),
    q(
      `SELECT o.id, o.title, to_char(o.due_day, 'YYYY-MM-DD') AS due_day, o.assignee, c.id AS contract_id, c.number, c.title AS contract_title
       FROM obligations o JOIN contracts c ON c.id = o.contract_id
       WHERE ${v} AND c.held_deleted_at IS NULL AND o.held_deleted_at IS NULL AND o.done_at IS NULL
         AND o.due_day IS NOT NULL AND o.due_day <= current_date + 30
       ORDER BY o.due_day LIMIT 50`,
      [me.email],
    ),
    q(
      `SELECT c.id, c.number, c.title, c.counterparty, a.requested_by, a.requested_at FROM approvals a JOIN contracts c ON c.id = a.contract_id
       WHERE a.approver = $1 AND a.status = 'pending' AND c.status = 'review' AND c.held_deleted_at IS NULL
         AND a.step = (SELECT min(step) FROM approvals b WHERE b.contract_id = a.contract_id AND b.round = a.round AND b.status = 'pending')
       ORDER BY a.requested_at`,
      [me.email],
    ),
  ]);
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  for (const r of counts) byStatus[r.status as Status] = r.n;
  return { byStatus, activeValue: value, expiring: windows[0], alerts, obligations, approvals };
}
