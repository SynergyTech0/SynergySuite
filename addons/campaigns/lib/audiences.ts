/**
 * Audiences and their subscribers. Every way someone joins (by hand, CSV, CRM, Contacts, the
 * signup form) goes through upsertMany, which keeps three promises:
 *
 *   - an address that unsubscribed, bounced or complained is never subscribed again by an import
 *     or a sync; only the person themselves (signup form, preferences page) can come back;
 *   - details from a newer import fill in blanks but never wipe what is there;
 *   - joining starts the audience's welcome automations.
 */
import { q, tx, type Tq } from "./db";
import { assertCanEdit } from "./members";
import { queueAutomations } from "./automations";
import type { Audience, Ctx, SubStatus, Subscriber } from "./types";
import { SUB_STATUSES } from "./types";
import { UserError, isEmail, isUuid, likeTerm, oneOf, required, tags as cleanTags, text } from "./util";

type AudienceRow = {
  id: string; name: string; description: string; form_enabled: boolean; double_opt_in: boolean; form_intro: string;
  created_at: Date; updated_at: Date; created_by: string | null;
  subscribed?: number; pending?: number; unsubscribed?: number; cleaned?: number;
};

const COUNTS = `
  (SELECT count(*)::int FROM subscribers s WHERE s.audience_id = a.id AND s.status = 'subscribed') AS subscribed,
  (SELECT count(*)::int FROM subscribers s WHERE s.audience_id = a.id AND s.status = 'pending') AS pending,
  (SELECT count(*)::int FROM subscribers s WHERE s.audience_id = a.id AND s.status = 'unsubscribed') AS unsubscribed,
  (SELECT count(*)::int FROM subscribers s WHERE s.audience_id = a.id AND s.status = 'cleaned') AS cleaned`;

function toAudience(r: AudienceRow): Audience {
  return {
    id: r.id, name: r.name, description: r.description,
    formEnabled: r.form_enabled, doubleOptIn: r.double_opt_in, formIntro: r.form_intro,
    counts: { subscribed: r.subscribed ?? 0, pending: r.pending ?? 0, unsubscribed: r.unsubscribed ?? 0, cleaned: r.cleaned ?? 0 },
    createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(), createdBy: r.created_by,
  };
}

export async function listAudiences(): Promise<Audience[]> {
  return (await q<AudienceRow>(`SELECT a.*, ${COUNTS} FROM audiences a ORDER BY lower(a.name)`)).map(toAudience);
}

export async function getAudience(id: string): Promise<Audience> {
  if (!isUuid(id)) throw new UserError("Audience not found", 404);
  const [r] = await q<AudienceRow>(`SELECT a.*, ${COUNTS} FROM audiences a WHERE a.id = $1`, [id]);
  if (!r) throw new UserError("Audience not found", 404);
  return toAudience(r);
}

export async function createAudience(ctx: Ctx, b: Record<string, unknown>): Promise<Audience> {
  assertCanEdit(ctx);
  const [r] = await q<{ id: string }>(
    "INSERT INTO audiences (name, description, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING id",
    [required(b.name, "A name", 120), text(b.description, 500), ctx.email],
  );
  return getAudience(r.id);
}

export async function updateAudience(ctx: Ctx, id: string, b: Record<string, unknown>): Promise<Audience> {
  assertCanEdit(ctx);
  const a = await getAudience(id);
  await q(
    `UPDATE audiences SET name = $2, description = $3, form_enabled = $4, double_opt_in = $5, form_intro = $6, updated_at = now(), updated_by = $7 WHERE id = $1`,
    [
      id,
      b.name === undefined ? a.name : required(b.name, "A name", 120),
      b.description === undefined ? a.description : text(b.description, 500),
      b.formEnabled === undefined ? a.formEnabled : Boolean(b.formEnabled),
      b.doubleOptIn === undefined ? a.doubleOptIn : Boolean(b.doubleOptIn),
      b.formIntro === undefined ? a.formIntro : text(b.formIntro, 1000),
      ctx.email,
    ],
  );
  return getAudience(id);
}

export async function deleteAudience(ctx: Ctx, id: string): Promise<void> {
  assertCanEdit(ctx);
  const a = await getAudience(id);
  const [busy] = await q("SELECT 1 FROM campaigns WHERE audience_id = $1 AND status IN ('scheduled','sending','paused')", [a.id]);
  if (busy) throw new UserError("A campaign to this audience is scheduled or sending. Cancel it first.");
  await q("DELETE FROM audiences WHERE id = $1", [a.id]);
}

// ----------------------------------------------------------------------------- subscribers

type SubRow = {
  id: string; audience_id: string; email: string; first_name: string; last_name: string; company: string;
  fields: Record<string, string>; tags: string[]; status: SubStatus; source: string; source_ref: string;
  suppressed: string | null; consent_at: Date | null; created_at: Date; updated_at: Date;
};

const SUB_COLS = `s.*, (SELECT reason FROM suppressions x WHERE x.email = lower(s.email)) AS suppressed`;

export function toSubscriber(r: SubRow): Subscriber {
  return {
    id: r.id, audienceId: r.audience_id, email: r.email, firstName: r.first_name, lastName: r.last_name, company: r.company,
    fields: r.fields ?? {}, tags: r.tags ?? [], status: r.status, source: r.source, sourceRef: r.source_ref,
    suppressed: r.suppressed ?? null, consentAt: r.consent_at ? new Date(r.consent_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function listSubscribers(audienceId: string, f: { q?: string; status?: string; tag?: string; limit?: number; offset?: number } = {}): Promise<{ items: Subscriber[]; total: number }> {
  await getAudience(audienceId);
  const where = ["s.audience_id = $1"];
  const params: unknown[] = [audienceId];
  if (f.q) {
    params.push(likeTerm(f.q));
    const p = `$${params.length}`;
    where.push(`(s.email ILIKE ${p} OR s.first_name ILIKE ${p} OR s.last_name ILIKE ${p} OR s.company ILIKE ${p})`);
  }
  if (f.status && (SUB_STATUSES as readonly string[]).includes(f.status)) {
    params.push(f.status);
    where.push(`s.status = $${params.length}`);
  }
  if (f.tag) {
    params.push(f.tag.toLowerCase());
    where.push(`$${params.length} = ANY(s.tags)`);
  }
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  params.push(limit, Math.max(f.offset ?? 0, 0));
  const rows = await q<SubRow & { total: number }>(
    `SELECT ${SUB_COLS}, count(*) OVER ()::int AS total FROM subscribers s WHERE ${where.join(" AND ")}
     ORDER BY s.created_at DESC, s.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows.map(toSubscriber), total: rows[0]?.total ?? 0 };
}

export async function getSubscriber(id: string): Promise<Subscriber> {
  if (!isUuid(id)) throw new UserError("Subscriber not found", 404);
  const [r] = await q<SubRow>(`SELECT ${SUB_COLS} FROM subscribers s WHERE s.id = $1`, [id]);
  if (!r) throw new UserError("Subscriber not found", 404);
  return toSubscriber(r);
}

export type Incoming = {
  email: string; firstName?: string; lastName?: string; company?: string;
  fields?: Record<string, string>; tags?: string[]; source: string; sourceRef?: string;
  /** What a brand-new subscriber starts as; existing ones keep their status unless `resubscribe`. */
  status?: "subscribed" | "pending";
  /** Only for the person themselves (signup form): an unsubscribed address may come back. */
  resubscribe?: boolean;
  consentIp?: string;
  confirmToken?: string;
};

export type UpsertResult = { added: number; updated: number; skipped: number; invalid: string[] };

function cleanFields(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 40)) {
    const key = text(k, 40).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    if (key && val !== undefined && val !== null && String(val).trim()) out[key] = text(val, 500);
  }
  return out;
}

/** Adds or refreshes many people in one audience; see the promises at the top of the file. */
export async function upsertMany(by: string | null, audienceId: string, people: Incoming[], tq?: Tq): Promise<UpsertResult> {
  const run = async (t: Tq): Promise<UpsertResult> => {
    const res: UpsertResult = { added: 0, updated: 0, skipped: 0, invalid: [] };
    const seen = new Set<string>();
    const joined: string[] = [];
    const tagged: { id: string; tags: string[] }[] = [];
    for (const p of people) {
      const email = text(p.email, 254).toLowerCase();
      if (!isEmail(email)) {
        if (email && res.invalid.length < 50) res.invalid.push(email.slice(0, 80));
        else if (!email) res.skipped++;
        continue;
      }
      if (seen.has(email)) {
        res.skipped++;
        continue;
      }
      seen.add(email);
      const newTags = cleanTags(p.tags ?? []);
      const fields = cleanFields(p.fields);
      const [old] = await t<{ id: string; status: SubStatus; tags: string[] }>(
        "SELECT id, status, tags FROM subscribers WHERE audience_id = $1 AND lower(email) = $2 FOR UPDATE",
        [audienceId, email],
      );
      if (old) {
        const back = p.resubscribe && old.status !== "subscribed";
        const status: SubStatus = back ? (p.status ?? "subscribed") : old.status;
        await t(
          `UPDATE subscribers SET
             first_name = CASE WHEN $2 <> '' THEN $2 ELSE first_name END,
             last_name = CASE WHEN $3 <> '' THEN $3 ELSE last_name END,
             company = CASE WHEN $4 <> '' THEN $4 ELSE company END,
             fields = fields || $5::jsonb,
             tags = ARRAY(SELECT DISTINCT unnest(tags || $6::text[])),
             status = $7,
             confirm_token = CASE WHEN $8::text IS NOT NULL THEN $8 ELSE confirm_token END,
             consent_ip = CASE WHEN $9 <> '' THEN $9 ELSE consent_ip END,
             consent_at = CASE WHEN $7 = 'subscribed' AND $10 THEN now() ELSE consent_at END,
             unsubscribed_at = CASE WHEN $7 IN ('subscribed','pending') THEN NULL ELSE unsubscribed_at END,
             updated_at = now(), updated_by = $11
           WHERE id = $1`,
          [old.id, text(p.firstName, 100), text(p.lastName, 100), text(p.company, 200), JSON.stringify(fields), newTags, status,
            p.confirmToken ?? null, text(p.consentIp, 60), Boolean(back), by],
        );
        res.updated++;
        if (back && status === "subscribed") joined.push(old.id);
        const added = newTags.filter((x) => !old.tags.includes(x));
        if (added.length && status === "subscribed") tagged.push({ id: old.id, tags: added });
        continue;
      }
      // A new row for someone suppressed elsewhere starts out the way they left.
      const [sup] = await t<{ reason: string }>("SELECT reason FROM suppressions WHERE email = $1", [email]);
      const status: SubStatus = sup && !p.resubscribe ? (sup.reason === "bounced" ? "cleaned" : "unsubscribed") : (p.status ?? "subscribed");
      const [row] = await t<{ id: string }>(
        `INSERT INTO subscribers (audience_id, email, first_name, last_name, company, fields, tags, status, source, source_ref,
           confirm_token, consent_ip, consent_at, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, CASE WHEN $8 = 'subscribed' AND $13 THEN now() END, $14, $14)
         RETURNING id`,
        [audienceId, email, text(p.firstName, 100), text(p.lastName, 100), text(p.company, 200), JSON.stringify(fields), newTags, status,
          text(p.source, 40) || "manual", text(p.sourceRef, 200), p.confirmToken ?? null, text(p.consentIp, 60), p.source === "form", by],
      );
      res.added++;
      if (status === "subscribed") {
        joined.push(row.id);
        if (newTags.length) tagged.push({ id: row.id, tags: newTags });
      }
    }
    if (joined.length || tagged.length) await queueAutomations(t, audienceId, joined, tagged);
    if (res.added || res.updated) await t("UPDATE audiences SET updated_at = now() WHERE id = $1", [audienceId]);
    return res;
  };
  return tq ? run(tq) : tx(run);
}

export async function addSubscriber(ctx: Ctx, audienceId: string, b: Record<string, unknown>): Promise<Subscriber> {
  assertCanEdit(ctx);
  await getAudience(audienceId);
  const email = text(b.email, 254).toLowerCase();
  if (!isEmail(email)) throw new UserError("Enter a valid email address");
  const [dupe] = await q("SELECT 1 FROM subscribers WHERE audience_id = $1 AND lower(email) = $2", [audienceId, email]);
  if (dupe) throw new UserError("That address is already in this audience", 409);
  await upsertMany(ctx.email, audienceId, [{
    email, firstName: text(b.firstName, 100), lastName: text(b.lastName, 100), company: text(b.company, 200),
    fields: b.fields as Record<string, string>, tags: cleanTags(b.tags), source: "manual",
  }]);
  const [r] = await q<{ id: string }>("SELECT id FROM subscribers WHERE audience_id = $1 AND lower(email) = $2", [audienceId, email]);
  return getSubscriber(r.id);
}

export async function updateSubscriber(ctx: Ctx, id: string, b: Record<string, unknown>): Promise<Subscriber> {
  assertCanEdit(ctx);
  const s = await getSubscriber(id);
  let status = s.status;
  if (b.status !== undefined && b.status !== s.status) {
    const want = oneOf(b.status, ["subscribed", "unsubscribed"] as const, "subscribed", "status");
    // People who left, or whose address bounced, decide for themselves whether to come back.
    if (want === "subscribed" && (s.status === "unsubscribed" || s.status === "cleaned" || s.suppressed)) {
      throw new UserError("This person unsubscribed or their address bounced. Only they can subscribe again, through your signup form.");
    }
    status = want;
  }
  const newTags = b.tags === undefined ? s.tags : cleanTags(b.tags);
  await tx(async (tq) => {
    await tq(
      `UPDATE subscribers SET first_name = $2, last_name = $3, company = $4, fields = $5::jsonb, tags = $6, status = $7,
         unsubscribed_at = CASE WHEN $7 = 'unsubscribed' AND status <> 'unsubscribed' THEN now() ELSE unsubscribed_at END,
         updated_at = now(), updated_by = $8
       WHERE id = $1`,
      [
        id,
        b.firstName === undefined ? s.firstName : text(b.firstName, 100),
        b.lastName === undefined ? s.lastName : text(b.lastName, 100),
        b.company === undefined ? s.company : text(b.company, 200),
        JSON.stringify(b.fields === undefined ? s.fields : cleanFields(b.fields)),
        newTags, status, ctx.email,
      ],
    );
    const added = newTags.filter((t) => !s.tags.includes(t));
    if (added.length && status === "subscribed") await queueAutomations(tq, s.audienceId, [], [{ id, tags: added }]);
  });
  return getSubscriber(id);
}

export async function deleteSubscribers(ctx: Ctx, audienceId: string, ids: unknown): Promise<number> {
  assertCanEdit(ctx);
  if (!Array.isArray(ids) || !ids.every(isUuid)) throw new UserError("Pick the people to remove");
  const rows = await q("DELETE FROM subscribers WHERE audience_id = $1 AND id = ANY($2::uuid[]) RETURNING id", [audienceId, ids]);
  return rows.length;
}

/** Adds tags to (or removes them from) several subscribers at once. */
export async function tagSubscribers(ctx: Ctx, audienceId: string, ids: unknown, tagList: unknown, remove: boolean): Promise<number> {
  assertCanEdit(ctx);
  if (!Array.isArray(ids) || !ids.every(isUuid)) throw new UserError("Pick the people to tag");
  const t = cleanTags(tagList);
  if (!t.length) throw new UserError("Enter a tag");
  return tx(async (tq) => {
    if (remove) {
      const rows = await tq(
        "UPDATE subscribers SET tags = ARRAY(SELECT x FROM unnest(tags) x WHERE NOT x = ANY($3::text[])), updated_at = now(), updated_by = $4 WHERE audience_id = $1 AND id = ANY($2::uuid[]) RETURNING id",
        [audienceId, ids, t, ctx.email],
      );
      return rows.length;
    }
    const before = await tq<{ id: string; tags: string[]; status: string }>("SELECT id, tags, status FROM subscribers WHERE audience_id = $1 AND id = ANY($2::uuid[])", [audienceId, ids]);
    await tq(
      "UPDATE subscribers SET tags = ARRAY(SELECT DISTINCT unnest(tags || $3::text[])), updated_at = now(), updated_by = $4 WHERE audience_id = $1 AND id = ANY($2::uuid[])",
      [audienceId, ids, t, ctx.email],
    );
    const tagged = before.filter((r) => r.status === "subscribed").map((r) => ({ id: r.id, tags: t.filter((x) => !r.tags.includes(x)) })).filter((r) => r.tags.length);
    if (tagged.length) await queueAutomations(tq, audienceId, [], tagged);
    return before.length;
  });
}

/** Every tag in an audience, for filters and segments. */
export async function audienceTags(audienceId: string): Promise<string[]> {
  const rows = await q<{ t: string }>("SELECT DISTINCT unnest(tags) AS t FROM subscribers WHERE audience_id = $1 ORDER BY 1 LIMIT 500", [audienceId]);
  return rows.map((r) => r.t);
}

/** Every custom field key in an audience. */
export async function audienceFields(audienceId: string): Promise<string[]> {
  const rows = await q<{ k: string }>("SELECT DISTINCT jsonb_object_keys(fields) AS k FROM subscribers WHERE audience_id = $1 ORDER BY 1 LIMIT 200", [audienceId]);
  return rows.map((r) => r.k);
}

// ---------------------------------------------------------------------------- suppressions

/** Never email this address again, from any audience. */
export async function suppress(tq: Tq, email: string, reason: "unsubscribed" | "bounced" | "complained" | "manual", detail = "", campaignId: string | null = null, by: string | null = null): Promise<void> {
  const e = email.trim().toLowerCase();
  await tq(
    `INSERT INTO suppressions (email, reason, detail, campaign_id, created_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE SET reason = CASE WHEN suppressions.reason = 'manual' THEN suppressions.reason ELSE $2 END,
       detail = $3, campaign_id = coalesce($4, suppressions.campaign_id)`,
    [e, reason, detail.slice(0, 500), campaignId, by],
  );
  const status = reason === "bounced" ? "cleaned" : "unsubscribed";
  await tq(
    `UPDATE subscribers SET status = $2, unsubscribed_at = coalesce(unsubscribed_at, now()), updated_at = now()
     WHERE lower(email) = $1 AND status IN ('subscribed','pending')`,
    [e, status],
  );
}

export type Suppression = { email: string; reason: string; detail: string; createdAt: string };

export async function listSuppressions(f: { q?: string } = {}): Promise<Suppression[]> {
  const params: unknown[] = [];
  let where = "";
  if (f.q) {
    params.push(likeTerm(f.q));
    where = "WHERE email ILIKE $1";
  }
  const rows = await q<{ email: string; reason: string; detail: string; created_at: Date }>(
    `SELECT * FROM suppressions ${where} ORDER BY created_at DESC LIMIT 1000`, params,
  );
  return rows.map((r) => ({ email: r.email, reason: r.reason, detail: r.detail, createdAt: new Date(r.created_at).toISOString() }));
}

export async function addSuppressions(ctx: Ctx, emails: unknown): Promise<number> {
  assertCanEdit(ctx);
  const list = (Array.isArray(emails) ? emails : String(emails ?? "").split(/[\s,;]+/)).map((e) => text(e, 254).toLowerCase()).filter(isEmail);
  if (!list.length) throw new UserError("Enter at least one email address");
  await tx(async (tq) => {
    for (const e of list.slice(0, 5000)) await suppress(tq, e, "manual", "Added by hand", null, ctx.email);
  });
  return list.length;
}

/** Lifts a hand-added block. Unsubscribes, bounces and complaints stay: the person decides. */
export async function removeSuppression(ctx: Ctx, email: string): Promise<void> {
  assertCanEdit(ctx);
  const [r] = await q<{ reason: string }>("SELECT reason FROM suppressions WHERE email = $1", [email.toLowerCase()]);
  if (!r) throw new UserError("Not on the list", 404);
  if (r.reason !== "manual") throw new UserError("Only addresses added by hand can be taken off. People who unsubscribed or complained can sign up again themselves.");
  await q("DELETE FROM suppressions WHERE email = $1", [email.toLowerCase()]);
}
