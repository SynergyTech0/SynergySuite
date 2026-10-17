import type { Me } from "./api";
import { holdChecker } from "./compliance";
import { type Tq, q, tx } from "./db";
import { CODES, matterChecks } from "./jurisdictions";
import { normalize } from "./parties";
import { UserError, cents, cleanEmail, text, uuidish } from "./util";

/** The firm's administrators: every matter, the firm's settings. LAW_ADMIN_EMAILS, else ADMIN_EMAILS. */
export function admins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.LAW_ADMIN_EMAILS || env.ADMIN_EMAILS || "";
  return raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isAdmin(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return admins(env).includes(email.toLowerCase());
}

/**
 * Who records money in and out of trust and reconciles it: LAW_TRUST_EMAILS, else the firm's
 * administrators. With neither set (a trial install) everyone can.
 */
export function trustKeepers(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.LAW_TRUST_EMAILS || "";
  const list = raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : admins(env);
}

export function isTrustKeeper(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const list = trustKeepers(env);
  return !list.length || list.includes(email.toLowerCase());
}

/** SQL that is true when the person in parameter $p can see matter `m`. */
export function visibleSql(p: number): string {
  return `(m.responsible = $${p} OR EXISTS (SELECT 1 FROM matter_people mp WHERE mp.matter_id = m.id AND mp.email = $${p}))`;
}

export function visible(email: string, p: number): string {
  // Administrators see everything; the parameter is still named so Postgres knows its type.
  return isAdmin(email) ? `($${p}::text IS NOT NULL)` : visibleSql(p);
}

export const PRACTICE_AREAS = [
  "General", "Litigation", "Criminal defense", "Family", "Estate planning", "Probate", "Real estate", "Corporate",
  "Employment", "Personal injury", "Immigration", "Intellectual property", "Bankruptcy", "Tax", "Other",
];
export const FEE_TYPES = ["hourly", "flat", "contingency", "pro_bono"] as const;
export const PARTY_ROLES = ["adverse", "co_party", "opposing_counsel", "witness", "related"] as const;
export const TEAM_ROLES = ["lawyer", "paralegal", "staff"] as const;

export type MatterRow = {
  id: string; number: string; title: string; client_id: string; client_name: string; practice_area: string; jurisdiction: string;
  court: string; case_number: string; description: string; status: string; fee_type: string; rate_cents: string | null;
  flat_cents: string | null; contingency_pct: string | null; currency: string; engagement_signed_on: string | null;
  opened_on: string; closed_on: string | null; responsible: string; created_by: string; created_at: Date; modified_at: Date;
};

export const MATTER_COLS = `m.id, m.number, m.title, m.client_id, c.name AS client_name, m.practice_area, m.jurisdiction, m.court,
  m.case_number, m.description, m.status, m.fee_type, m.rate_cents, m.flat_cents, m.contingency_pct, m.currency,
  to_char(m.engagement_signed_on, 'YYYY-MM-DD') AS engagement_signed_on, to_char(m.opened_on, 'YYYY-MM-DD') AS opened_on,
  to_char(m.closed_on, 'YYYY-MM-DD') AS closed_on, m.responsible, m.created_by, m.created_at, m.modified_at`;

export type Role = "admin" | "responsible" | "lawyer" | "paralegal" | "staff";

/** The matter and what this person is on it; not found when they can't see it. */
export async function access(email: string, id: string): Promise<{ m: MatterRow; role: Role }> {
  if (!uuidish(id)) throw new UserError("Not found", 404);
  const [m] = await q<MatterRow>(
    `SELECT ${MATTER_COLS} FROM matters m JOIN clients c ON c.id = m.client_id WHERE m.id = $1 AND m.held_deleted_at IS NULL`,
    [id],
  );
  if (!m) throw new UserError("Not found", 404);
  if (m.responsible === email) return { m, role: "responsible" };
  const [p] = await q<{ role: Role }>(`SELECT role FROM matter_people WHERE matter_id = $1 AND email = $2`, [id, email]);
  if (isAdmin(email)) return { m, role: "admin" };
  if (!p) throw new UserError("Not found", 404);
  return { m, role: p.role };
}

/** Changing a matter's terms, team or status: its responsible lawyer or an administrator. */
export async function requireLead(email: string, id: string) {
  const a = await access(email, id);
  if (a.role !== "responsible" && a.role !== "admin") throw new UserError("Only the responsible lawyer can change this", 403);
  return a;
}

export async function logEvent(tq: Tq, matterId: string, kind: string, detail: string, actor: string) {
  await tq(`INSERT INTO matter_events (matter_id, kind, detail, actor) VALUES ($1, $2, $3, $4)`, [matterId, kind, detail.slice(0, 1000), actor]);
}

function day(v: unknown, what: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new UserError(`${what} must be a date`);
  return s;
}

export { day as dayOrNull };

// ---------- clients ----------

export type ClientRow = {
  id: string; kind: string; name: string; aliases: string[]; email: string; phone: string; address: string; notes: string;
  status: string; created_by: string; created_at: Date; modified_at: Date;
};

function clientFields(b: Record<string, unknown>, cur?: ClientRow) {
  const kind = b.kind === undefined ? (cur?.kind ?? "person") : b.kind === "organization" ? "organization" : "person";
  const name = b.name === undefined ? cur?.name ?? "" : text(b.name, 200);
  if (!name) throw new UserError("Give the client a name");
  const aliases = b.aliases === undefined
    ? (cur?.aliases ?? [])
    : (Array.isArray(b.aliases) ? b.aliases : String(b.aliases ?? "").split(/[\n;]+/)).map((a) => text(a, 200)).filter(Boolean).slice(0, 20);
  const email = b.email === undefined ? (cur?.email ?? "") : String(b.email ?? "").trim() ? cleanEmail(b.email) : "";
  const status = b.status === undefined ? (cur?.status ?? "active") : ["prospect", "active", "former"].includes(String(b.status)) ? String(b.status) : "active";
  const n = normalize(name, kind as "person" | "organization");
  return {
    kind, name, aliases: [...new Set([...aliases, ...n.aliases])].slice(0, 20), email, status, normalized: n.normalized,
    phone: b.phone === undefined ? (cur?.phone ?? "") : text(b.phone, 40),
    address: b.address === undefined ? (cur?.address ?? "") : text(b.address, 500),
    notes: b.notes === undefined ? (cur?.notes ?? "") : text(b.notes, 5000),
  };
}

const CLIENT_COLS = `id, kind, name, aliases, email, phone, address, notes, status, created_by, created_at, modified_at`;

export async function createClient(me: Me, b: Record<string, unknown>): Promise<ClientRow> {
  const f = clientFields(b);
  const [c] = await q<ClientRow>(
    `INSERT INTO clients (kind, name, normalized, aliases, email, phone, address, notes, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${CLIENT_COLS}`,
    [f.kind, f.name, f.normalized, f.aliases, f.email, f.phone, f.address, f.notes, f.status, me.email],
  );
  return c;
}

export async function getClientRow(id: string): Promise<ClientRow> {
  if (!uuidish(id)) throw new UserError("Not found", 404);
  const [c] = await q<ClientRow>(`SELECT ${CLIENT_COLS} FROM clients WHERE id = $1 AND held_deleted_at IS NULL`, [id]);
  if (!c) throw new UserError("Not found", 404);
  return c;
}

/** Client records are the firm's: anyone in it can keep contact details current. */
export async function updateClient(me: Me, id: string, b: Record<string, unknown>): Promise<ClientRow> {
  const cur = await getClientRow(id);
  const f = clientFields(b, cur);
  const [c] = await q<ClientRow>(
    `UPDATE clients SET kind = $2, name = $3, normalized = $4, aliases = $5, email = $6, phone = $7, address = $8, notes = $9,
       status = $10, modified_at = now() WHERE id = $1 RETURNING ${CLIENT_COLS}`,
    [id, f.kind, f.name, f.normalized, f.aliases, f.email, f.phone, f.address, f.notes, f.status],
  );
  return c;
}

/** A client with no matters and no trust history can be removed by an administrator. */
export async function deleteClient(me: Me, id: string) {
  if (!isAdmin(me.email) && admins().length) throw new UserError("Only an administrator can remove a client", 403);
  await getClientRow(id);
  const [{ n }] = await q<{ n: string }>(
    `SELECT (SELECT count(*) FROM matters WHERE client_id = $1) + (SELECT count(*) FROM trust_txns WHERE client_id = $1) AS n`,
    [id],
  );
  if (Number(n) > 0) throw new UserError("This client has matters or trust history, so it stays. Mark them a former client instead.", 409);
  await q(`DELETE FROM clients WHERE id = $1`, [id]);
}

export async function listClients(search: string, limit = 200): Promise<(ClientRow & { matters: number })[]> {
  const like = `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return q(
    `SELECT ${CLIENT_COLS.split(", ").map((c) => `cl.${c}`).join(", ")},
       (SELECT count(*)::int FROM matters m WHERE m.client_id = cl.id AND m.held_deleted_at IS NULL) AS matters
     FROM clients cl WHERE cl.held_deleted_at IS NULL AND ($1 = '' OR cl.name ILIKE $2 OR cl.email ILIKE $2)
     ORDER BY lower(cl.name) LIMIT $3`,
    [search, like, limit],
  );
}

/** A client, the matters on it this person can see, and their trust balance. */
export async function getClient(me: Me, id: string) {
  const c = await getClientRow(id);
  const matters = await q<MatterRow>(
    `SELECT ${MATTER_COLS} FROM matters m JOIN clients c ON c.id = m.client_id
     WHERE m.client_id = $1 AND m.held_deleted_at IS NULL AND ${visible(me.email, 2)} ORDER BY m.opened_on DESC`,
    [id, me.email],
  );
  const hidden = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM matters m WHERE m.client_id = $1 AND m.held_deleted_at IS NULL AND NOT ${visible(me.email, 2)}`,
    [id, me.email],
  );
  const [bal] = await q<{ cents: string }>(
    `SELECT COALESCE(sum(CASE WHEN kind = 'deposit' THEN amount_cents ELSE -amount_cents END), 0) AS cents
     FROM trust_txns WHERE client_id = $1 AND voided_at IS NULL`,
    [id],
  );
  return { ...c, matters, hiddenMatters: hidden[0].n, trustCents: Number(bal.cents) };
}

// ---------- matters ----------

function matterFields(b: Record<string, unknown>, cur?: MatterRow) {
  const pick = <T>(k: string, f: (v: unknown) => T, fallback: T): T => (b[k] === undefined ? fallback : f(b[k]));
  const title = pick("title", (v) => text(v, 200), cur?.title ?? "");
  if (!title) throw new UserError("Give the matter a name");
  const jurisdiction = pick("jurisdiction", (v) => String(v ?? "").toUpperCase(), cur?.jurisdiction ?? "FED");
  if (!CODES.includes(jurisdiction)) throw new UserError("Pick a state, or Federal");
  const fee = pick("feeType", (v) => String(v), cur?.fee_type ?? "hourly");
  if (!(FEE_TYPES as readonly string[]).includes(fee)) throw new UserError("Pick how the matter is billed");
  const pct = pick("contingencyPct", (v) => {
    if (v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new UserError("The contingency percentage must be from 0 to 100");
    return Math.round(n * 100) / 100;
  }, cur?.contingency_pct === null || cur?.contingency_pct === undefined ? null : Number(cur.contingency_pct));
  const currency = pick("currency", (v) => String(v ?? "USD").trim().toUpperCase() || "USD", cur?.currency ?? "USD");
  if (!/^[A-Z]{3}$/.test(currency)) throw new UserError("Currency is a three-letter code like USD");
  const status = pick("status", (v) => String(v), cur?.status ?? "open");
  if (!["open", "pending", "closed"].includes(status)) throw new UserError("Bad status");
  return {
    title,
    jurisdiction,
    fee_type: fee,
    contingency_pct: pct,
    currency,
    status,
    practice_area: pick("practiceArea", (v) => text(v, 60) || "General", cur?.practice_area ?? "General"),
    court: pick("court", (v) => text(v, 200), cur?.court ?? ""),
    case_number: pick("caseNumber", (v) => text(v, 100), cur?.case_number ?? ""),
    description: pick("description", (v) => text(v, 5000), cur?.description ?? ""),
    rate_cents: pick("rate", (v) => cents(v, "Rate"), cur?.rate_cents === null || cur?.rate_cents === undefined ? null : Number(cur.rate_cents)),
    flat_cents: pick("flatFee", (v) => cents(v, "Flat fee"), cur?.flat_cents === null || cur?.flat_cents === undefined ? null : Number(cur.flat_cents)),
    engagement_signed_on: pick("engagementSignedOn", (v) => day(v, "Engagement letter date"), cur?.engagement_signed_on ?? null),
    opened_on: pick("openedOn", (v) => day(v, "Opened") ?? new Date().toISOString().slice(0, 10), cur?.opened_on ?? new Date().toISOString().slice(0, 10)),
  };
}

/**
 * Opens a matter for an existing client, or a new one given as `client`. A conflict check made
 * for it beforehand is linked with `conflictCheckId`; one still pending or declined blocks opening.
 */
export async function createMatter(me: Me, b: Record<string, unknown>): Promise<{ id: string; number: string }> {
  const f = matterFields(b);
  const responsible = b.responsible ? cleanEmail(b.responsible) : me.email;
  const checkId = b.conflictCheckId ? String(b.conflictCheckId) : null;
  if (checkId) {
    if (!uuidish(checkId)) throw new UserError("Not found", 404);
    const [c] = await q<{ decision: string }>(`SELECT decision FROM conflict_checks WHERE id = $1`, [checkId]);
    if (!c) throw new UserError("That conflict check isn't there any more", 404);
    if (c.decision === "pending") throw new UserError("Clear or waive the conflict check before opening the matter", 409);
    if (c.decision === "declined") throw new UserError("That conflict check was declined, so the matter can't be opened from it", 409);
  }
  let clientId = b.clientId ? String(b.clientId) : "";
  if (!clientId && b.client && typeof b.client === "object") clientId = (await createClient(me, b.client as Record<string, unknown>)).id;
  if (!clientId) throw new UserError("Pick the client");
  await getClientRow(clientId);
  return tx(async (tq) => {
    const [{ n }] = await tq<{ n: string }>(`SELECT nextval('matter_number_seq') AS n`);
    const number = `${f.opened_on.slice(0, 4)}-${String(n).padStart(4, "0")}`;
    const [m] = await tq<{ id: string }>(
      `INSERT INTO matters (number, title, client_id, practice_area, jurisdiction, court, case_number, description, status, fee_type,
         rate_cents, flat_cents, contingency_pct, currency, engagement_signed_on, opened_on, responsible, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
      [number, f.title, clientId, f.practice_area, f.jurisdiction, f.court, f.case_number, f.description, f.fee_type, f.rate_cents,
        f.flat_cents, f.contingency_pct, f.currency, f.engagement_signed_on, f.opened_on, responsible, me.email],
    );
    if (responsible !== me.email) {
      await tq(`INSERT INTO matter_people (matter_id, email, role, added_by) VALUES ($1, $2, 'lawyer', $2) ON CONFLICT DO NOTHING`, [m.id, me.email]);
    }
    await tq(`UPDATE clients SET status = 'active', modified_at = now() WHERE id = $1 AND status = 'prospect'`, [clientId]);
    if (checkId) await tq(`UPDATE conflict_checks SET matter_id = $2 WHERE id = $1`, [checkId, m.id]);
    await logEvent(tq, m.id, "opened", `Opened ${number}${checkId ? " after a conflict check" : ""}`, me.email);
    return { id: m.id, number };
  });
}

export async function updateMatter(me: Me, id: string, b: Record<string, unknown>) {
  const { m } = await requireLead(me.email, id);
  const f = matterFields(b, m);
  const responsible = b.responsible === undefined ? m.responsible : cleanEmail(b.responsible);
  const closing = f.status === "closed" && m.status !== "closed";
  if (closing) {
    const [{ cents: held }] = await q<{ cents: string }>(
      `SELECT COALESCE(sum(CASE WHEN kind = 'deposit' THEN amount_cents ELSE -amount_cents END), 0) AS cents
       FROM trust_txns WHERE matter_id = $1 AND voided_at IS NULL`,
      [id],
    );
    if (Number(held) !== 0) throw new UserError("This matter still holds money in trust. Pay it out or refund it before closing.", 409);
  }
  await tx(async (tq) => {
    await tq(
      `UPDATE matters SET title = $2, practice_area = $3, jurisdiction = $4, court = $5, case_number = $6, description = $7, status = $8,
         fee_type = $9, rate_cents = $10, flat_cents = $11, contingency_pct = $12, currency = $13, engagement_signed_on = $14,
         opened_on = $15, responsible = $16, closed_on = CASE WHEN $8 = 'closed' THEN COALESCE(closed_on, CURRENT_DATE) ELSE NULL END,
         modified_at = now() WHERE id = $1`,
      [id, f.title, f.practice_area, f.jurisdiction, f.court, f.case_number, f.description, f.status, f.fee_type, f.rate_cents, f.flat_cents,
        f.contingency_pct, f.currency, f.engagement_signed_on, f.opened_on, responsible],
    );
    if (responsible !== m.responsible) {
      // The lawyer handing over stays on the team.
      await tq(`INSERT INTO matter_people (matter_id, email, role, added_by) VALUES ($1, $2, 'lawyer', $3) ON CONFLICT DO NOTHING`, [id, m.responsible, me.email]);
      await tq(`DELETE FROM matter_people WHERE matter_id = $1 AND email = $2`, [id, responsible]);
      await logEvent(tq, id, "responsible", `Responsible lawyer is now ${responsible}`, me.email);
    }
    if (f.status !== m.status) await logEvent(tq, id, "status", `Status: ${f.status}`, me.email);
    else await logEvent(tq, id, "edited", "Details changed", me.email);
  });
  return getMatter(me, id);
}

/**
 * A matter with money, bills or documents behind it is closed, not deleted. One with none can be
 * deleted by its responsible lawyer; if anyone on it is under legal hold it is only hidden.
 */
export async function deleteMatter(me: Me, id: string) {
  const { m } = await requireLead(me.email, id);
  const [{ n }] = await q<{ n: string }>(
    `SELECT (SELECT count(*) FROM trust_txns WHERE matter_id = $1) + (SELECT count(*) FROM bills WHERE matter_id = $1)
       + (SELECT count(*) FROM documents WHERE matter_id = $1) + (SELECT count(*) FROM time_entries WHERE matter_id = $1) AS n`,
    [id],
  );
  if (Number(n) > 0) throw new UserError("This matter has time, documents, bills or trust history. Close it instead.", 409);
  const people = await q<{ email: string }>(`SELECT email FROM matter_people WHERE matter_id = $1`, [id]);
  const held = holdChecker();
  for (const e of [m.responsible, m.created_by, ...people.map((p) => p.email)]) {
    if (await held(e)) {
      await q(`UPDATE matters SET held_deleted_at = now() WHERE id = $1`, [id]);
      return;
    }
  }
  await q(`DELETE FROM matters WHERE id = $1`, [id]);
}

export type ListFilter = { view?: string; q?: string; status?: string; client?: string };

export async function listMatters(me: Me, f: ListFilter) {
  const params: unknown[] = [me.email];
  const where = [`m.held_deleted_at IS NULL`, visible(me.email, 1)];
  if (f.view === "mine") where.push(`(m.responsible = $1 OR EXISTS (SELECT 1 FROM matter_people mp WHERE mp.matter_id = m.id AND mp.email = $1))`);
  if (f.status && ["open", "pending", "closed"].includes(f.status)) {
    params.push(f.status);
    where.push(`m.status = $${params.length}`);
  } else if (f.view !== "all") where.push(`m.status <> 'closed'`);
  if (f.client && uuidish(f.client)) {
    params.push(f.client);
    where.push(`m.client_id = $${params.length}`);
  }
  if (f.q) {
    params.push(`%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    const p = params.length;
    where.push(`(m.title ILIKE $${p} OR m.number ILIKE $${p} OR c.name ILIKE $${p} OR m.case_number ILIKE $${p})`);
  }
  return q<MatterRow & { next_deadline: string | null; unbilled_cents: string; trust_cents: string }>(
    `SELECT ${MATTER_COLS},
       (SELECT to_char(min(d.due_day), 'YYYY-MM-DD') FROM deadlines d WHERE d.matter_id = m.id AND d.done_at IS NULL) AS next_deadline,
       (SELECT COALESCE(sum(CASE WHEN t.kind = 'time' THEN round(t.minutes * t.rate_cents / 60.0) ELSE t.amount_cents END), 0)
          FROM time_entries t WHERE t.matter_id = m.id AND t.bill_id IS NULL AND t.billable) AS unbilled_cents,
       (SELECT COALESCE(sum(CASE WHEN x.kind = 'deposit' THEN x.amount_cents ELSE -x.amount_cents END), 0)
          FROM trust_txns x WHERE x.matter_id = m.id AND x.voided_at IS NULL) AS trust_cents
     FROM matters m JOIN clients c ON c.id = m.client_id
     WHERE ${where.join(" AND ")} ORDER BY m.opened_on DESC, m.number DESC LIMIT 500`,
    params,
  );
}

export async function getMatter(me: Me, id: string) {
  const { m, role } = await access(me.email, id);
  const people = await q(`SELECT email, role, rate_cents, added_by, added_at FROM matter_people WHERE matter_id = $1 ORDER BY added_at`, [id]);
  const parties = await q(`SELECT id, name, kind, role, notes, added_by, added_at FROM matter_parties WHERE matter_id = $1 ORDER BY role, lower(name)`, [id]);
  const events = await q(`SELECT kind, detail, actor, at FROM matter_events WHERE matter_id = $1 ORDER BY at DESC, id DESC LIMIT 200`, [id]);
  const checks = await q(
    `SELECT id, names, hits, decision, note, checked_by, checked_at, decided_by, decided_at FROM conflict_checks WHERE matter_id = $1 ORDER BY checked_at DESC`,
    [id],
  );
  const [billed] = await q<{ cents: string }>(`SELECT COALESCE(sum(total_cents), 0) AS cents FROM bills WHERE matter_id = $1`, [id]);
  const [trust] = await q<{ cents: string }>(
    `SELECT COALESCE(sum(CASE WHEN kind = 'deposit' THEN amount_cents ELSE -amount_cents END), 0) AS cents FROM trust_txns WHERE matter_id = $1 AND voided_at IS NULL`,
    [id],
  );
  const rules = matterChecks({ ...m, billed_cents: Number(billed.cents) });
  const [{ ai_brief }] = await q<{ ai_brief: unknown }>(`SELECT ai_brief FROM matters WHERE id = $1`, [id]);
  return { ...m, role, brief: ai_brief, people, parties, events, conflictChecks: checks, billedCents: Number(billed.cents), trustCents: Number(trust.cents), rules };
}

export async function addPerson(me: Me, id: string, b: Record<string, unknown>) {
  const { m } = await requireLead(me.email, id);
  const email = cleanEmail(b.email);
  if (email === m.responsible) throw new UserError("They're already the responsible lawyer");
  const role = (TEAM_ROLES as readonly string[]).includes(String(b.role)) ? String(b.role) : "lawyer";
  const rate = cents(b.rate, "Rate");
  await tx(async (tq) => {
    await tq(
      `INSERT INTO matter_people (matter_id, email, role, rate_cents, added_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (matter_id, email) DO UPDATE SET role = EXCLUDED.role, rate_cents = EXCLUDED.rate_cents`,
      [id, email, role, rate, me.email],
    );
    await logEvent(tq, id, "team", `${email} on the team as ${role}`, me.email);
  });
}

export async function removePerson(me: Me, id: string, email: string) {
  await requireLead(me.email, id);
  await tx(async (tq) => {
    await tq(`DELETE FROM matter_people WHERE matter_id = $1 AND email = $2`, [id, email.toLowerCase()]);
    await logEvent(tq, id, "team", `${email} taken off the team`, me.email);
  });
}

/** Adverse parties, co-parties, opposing counsel and others, kept for conflict checks. Anyone on the team. */
export async function addParty(me: Me, id: string, b: Record<string, unknown>) {
  await access(me.email, id);
  const name = text(b.name, 200);
  if (!name) throw new UserError("Give the party's name");
  const role = (PARTY_ROLES as readonly string[]).includes(String(b.role)) ? String(b.role) : "adverse";
  const kind = b.kind === "organization" ? "organization" : b.kind === "person" ? "person" : undefined;
  const n = normalize(name, kind);
  const [p] = await tx(async (tq) => {
    const rows = await tq<{ id: string }>(
      `INSERT INTO matter_parties (matter_id, name, normalized, aliases, kind, role, notes, added_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [id, name, n.normalized, n.aliases, kind ?? (n.isPerson ? "person" : "organization"), role, text(b.notes, 1000), me.email],
    );
    await logEvent(tq, id, "party", `${name} added as ${role.replace("_", " ")}`, me.email);
    return rows;
  });
  return p;
}

export async function removeParty(me: Me, partyId: string) {
  if (!uuidish(partyId)) throw new UserError("Not found", 404);
  const [p] = await q<{ matter_id: string; name: string }>(`SELECT matter_id, name FROM matter_parties WHERE id = $1`, [partyId]);
  if (!p) throw new UserError("Not found", 404);
  await access(me.email, p.matter_id);
  await tx(async (tq) => {
    await tq(`DELETE FROM matter_parties WHERE id = $1`, [partyId]);
    await logEvent(tq, p.matter_id, "party", `${p.name} taken off the parties`, me.email);
  });
}

// ---------- deadlines ----------

export async function listDeadlines(me: Me, opts: { matterId?: string; upcoming?: boolean; mine?: boolean }) {
  const params: unknown[] = [me.email];
  const where = [`m.held_deleted_at IS NULL`, visible(me.email, 1)];
  if (opts.matterId) {
    params.push(opts.matterId);
    where.push(`d.matter_id = $${params.length}`);
  }
  if (opts.upcoming) where.push(`d.done_at IS NULL`);
  if (opts.mine) where.push(`(d.assignee = $1 OR (d.assignee IS NULL AND m.responsible = $1))`);
  return q(
    `SELECT d.id, d.matter_id, m.number, m.title AS matter_title, d.title, to_char(d.due_day, 'YYYY-MM-DD') AS due_day, d.basis,
       d.assignee, d.done_at, d.done_by, d.created_by, (d.due_day - CURRENT_DATE) AS days_left
     FROM deadlines d JOIN matters m ON m.id = d.matter_id WHERE ${where.join(" AND ")}
     ORDER BY d.done_at IS NOT NULL, d.due_day, d.title LIMIT 500`,
    params,
  );
}

export async function addDeadline(me: Me, matterId: string, b: Record<string, unknown>) {
  await access(me.email, matterId);
  const title = text(b.title, 200);
  if (!title) throw new UserError("Say what is due");
  const due = day(b.dueDay, "Due date");
  if (!due) throw new UserError("Pick the due date");
  const assignee = b.assignee ? cleanEmail(b.assignee) : null;
  return tx(async (tq) => {
    const [d] = await tq<{ id: string }>(
      `INSERT INTO deadlines (matter_id, title, due_day, basis, assignee, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [matterId, title, due, text(b.basis, 500), assignee, me.email],
    );
    await logEvent(tq, matterId, "deadline", `${title} due ${due}`, me.email);
    return d;
  });
}

async function deadlineMatter(me: Me, id: string) {
  if (!uuidish(id)) throw new UserError("Not found", 404);
  const [d] = await q<{ matter_id: string; title: string }>(`SELECT matter_id, title FROM deadlines WHERE id = $1`, [id]);
  if (!d) throw new UserError("Not found", 404);
  await access(me.email, d.matter_id);
  return d;
}

export async function updateDeadline(me: Me, id: string, b: Record<string, unknown>) {
  const d = await deadlineMatter(me, id);
  await tx(async (tq) => {
    if (b.done !== undefined) {
      await tq(`UPDATE deadlines SET done_at = CASE WHEN $2 THEN now() END, done_by = CASE WHEN $2 THEN $3 END WHERE id = $1`, [id, !!b.done, me.email]);
      await logEvent(tq, d.matter_id, "deadline", `${d.title} ${b.done ? "done" : "reopened"}`, me.email);
    }
    if (b.dueDay !== undefined || b.title !== undefined || b.assignee !== undefined || b.basis !== undefined) {
      const due = b.dueDay === undefined ? null : day(b.dueDay, "Due date");
      await tq(
        `UPDATE deadlines SET due_day = COALESCE($2, due_day), title = COALESCE(NULLIF($3, ''), title),
           assignee = CASE WHEN $4 THEN $5 ELSE assignee END, basis = COALESCE($6, basis) WHERE id = $1`,
        [id, due, b.title === undefined ? "" : text(b.title, 200), b.assignee !== undefined, b.assignee ? cleanEmail(b.assignee) : null,
          b.basis === undefined ? null : text(b.basis, 500)],
      );
    }
  });
}

export async function deleteDeadline(me: Me, id: string) {
  const d = await deadlineMatter(me, id);
  await tx(async (tq) => {
    await tq(`DELETE FROM deadlines WHERE id = $1`, [id]);
    await logEvent(tq, d.matter_id, "deadline", `${d.title} removed`, me.email);
  });
}
