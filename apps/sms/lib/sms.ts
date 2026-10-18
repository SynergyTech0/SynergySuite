import type { Me } from "./api";
import { q, tx } from "./db";
import { provider } from "./provider";
import { MAX_BODY, UserError, csvFields, e164, optKeyword, phone, tags, text } from "./util";

export type Contact = { id: string; phone: string; name: string; tags: string[]; opted_out: boolean; created_at: string };
export type Message = {
  id: string;
  phone: string;
  direction: "in" | "out";
  body: string;
  status: string;
  error: string;
  campaign_id: string | null;
  sent_by: string;
  read: boolean;
  at: string;
};
export type Campaign = {
  id: string;
  name: string;
  body: string;
  tag: string;
  recipients: number;
  status: "sending" | "done";
  created_by: string;
  created_at: string;
  finished_at: string | null;
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
};

const CONTACT = "id::text, phone, name, tags, opted_out, created_at";
const MESSAGE = "id::text, phone, direction, body, status, error, campaign_id::text, sent_by, read, at";

function id(v: unknown): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new UserError("Not found", 404);
  return n;
}

function body(v: unknown): string {
  const b = String(v ?? "").replace(/\u0000/g, "").trim();
  if (!b) throw new UserError("Write a message");
  if (b.length > MAX_BODY) throw new UserError(`A text can be at most ${MAX_BODY} characters`);
  return b;
}

export function status() {
  const p = provider();
  return { provider: p.name, configured: p.configured, from: p.from };
}

export async function dashboard() {
  const [r] = await q<{ contacts: number; opted_out: number; sent_30d: number; received_30d: number; unread: number }>(`
    SELECT (SELECT count(*) FROM contacts)::int AS contacts,
           (SELECT count(*) FROM contacts WHERE opted_out)::int AS opted_out,
           (SELECT count(*) FROM messages WHERE direction = 'out' AND status NOT IN ('pending', 'claimed', 'skipped', 'failed', 'undelivered') AND at > now() - interval '30 days')::int AS sent_30d,
           (SELECT count(*) FROM messages WHERE direction = 'in' AND at > now() - interval '30 days')::int AS received_30d,
           (SELECT count(*) FROM messages WHERE direction = 'in' AND NOT read)::int AS unread`);
  return r;
}

// ---- contacts ----

export async function listContacts(search = ""): Promise<Contact[]> {
  const s = text(search, 100).toLowerCase();
  return q<Contact>(
    `SELECT ${CONTACT} FROM contacts
     WHERE $1 = '' OR lower(name) LIKE '%' || $1 || '%' OR phone LIKE '%' || regexp_replace($1, '[^0-9+]', '', 'g') || '%' OR $1 = ANY(tags)
     ORDER BY lower(name) = '', lower(name), phone LIMIT 5000`,
    [s],
  );
}

export async function createContact(b: Record<string, unknown>): Promise<Contact> {
  const [c] = await q<Contact>(`INSERT INTO contacts (phone, name, tags) VALUES ($1, $2, $3) RETURNING ${CONTACT}`, [
    phone(b.phone),
    text(b.name, 100),
    tags(b.tags),
  ]);
  return c;
}

export async function updateContact(cid: unknown, b: Record<string, unknown>): Promise<Contact> {
  const optedOut = b.optedOut === undefined ? null : Boolean(b.optedOut);
  const [c] = await q<Contact>(
    `UPDATE contacts SET name = COALESCE($2, name), tags = COALESCE($3, tags), opted_out = COALESCE($4, opted_out),
       opted_out_at = CASE WHEN $4::boolean IS TRUE AND NOT opted_out THEN now() WHEN $4::boolean IS FALSE THEN NULL ELSE opted_out_at END
     WHERE id = $1 RETURNING ${CONTACT}`,
    [id(cid), b.name === undefined ? null : text(b.name, 100), b.tags === undefined ? null : tags(b.tags), optedOut],
  );
  if (!c) throw new UserError("Not found", 404);
  return c;
}

/** Deletes the contact; their messages stay in the conversation history. */
export async function deleteContact(cid: unknown): Promise<void> {
  const rows = await q("DELETE FROM contacts WHERE id = $1 RETURNING id", [id(cid)]);
  if (!rows.length) throw new UserError("Not found", 404);
}

/**
 * Contacts from CSV: phone, name, tags (in that order; a header row is skipped). A number that is
 * already a contact gets the name and tags added; its opt-out is never changed by an import.
 */
export async function importContacts(csv: unknown): Promise<{ created: number; updated: number; skipped: number }> {
  const lines = String(csv ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 20_000) throw new UserError("Import at most 20,000 rows at a time");
  let created = 0;
  let updated = 0;
  let skipped = 0;
  await tx(async (tq) => {
    for (const [i, line] of lines.entries()) {
      const [rawPhone = "", name = "", tagText = ""] = csvFields(line);
      if (i === 0 && /phone|number|mobile/i.test(rawPhone)) continue;
      const p = e164(rawPhone);
      if (!p) {
        skipped++;
        continue;
      }
      const [r] = await tq<{ inserted: boolean }>(
        `INSERT INTO contacts (phone, name, tags) VALUES ($1, $2, $3)
         ON CONFLICT (phone) DO UPDATE SET name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE contacts.name END,
           tags = ARRAY(SELECT DISTINCT unnest(contacts.tags || EXCLUDED.tags))
         RETURNING (xmax = 0) AS inserted`,
        [p, text(name, 100), tags(tagText)],
      );
      if (r.inserted) created++;
      else updated++;
    }
  });
  return { created, updated, skipped };
}

// ---- sending ----

async function deliver(messageId: string, to: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const r = await provider().send(to, text);
  if (r.ok) {
    await q("UPDATE messages SET status = $2, provider_id = $3, error = '', at = now() WHERE id = $1", [messageId, r.status, r.id]);
    return { ok: true };
  }
  await q("UPDATE messages SET status = 'failed', error = $2, at = now() WHERE id = $1", [messageId, r.error.slice(0, 500)]);
  return { ok: false, error: r.error };
}

/** One text to one number, as the signed-in person. A number that has opted out is refused. */
export async function sendOne(me: Me, b: Record<string, unknown>): Promise<Message> {
  const to = phone(b.to);
  const text = body(b.body);
  const [c] = await q<{ opted_out: boolean }>(
    "INSERT INTO contacts (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING opted_out",
    [to],
  );
  if (c.opted_out) throw new UserError("This number has opted out of texts (they replied STOP). They can text START to opt back in.", 409);
  const [m] = await q<{ id: string }>(
    "INSERT INTO messages (phone, direction, body, status, sent_by) VALUES ($1, 'out', $2, 'pending', $3) RETURNING id::text",
    [to, text, me.email],
  );
  const r = await deliver(m.id, to, text);
  if (!r.ok) throw new UserError(`Not sent: ${r.error}`, 502);
  const [out] = await q<Message>(`SELECT ${MESSAGE} FROM messages WHERE id = $1`, [m.id]);
  return out;
}

// ---- conversations ----

export async function conversations() {
  return q<{ phone: string; name: string | null; opted_out: boolean | null; last_body: string; last_dir: string; last_at: string; unread: number }>(`
    SELECT l.phone, c.name, c.opted_out, l.body AS last_body, l.direction AS last_dir, l.at AS last_at,
           (SELECT count(*) FROM messages u WHERE u.phone = l.phone AND u.direction = 'in' AND NOT u.read)::int AS unread
    FROM (SELECT DISTINCT ON (phone) phone, body, direction, at, id FROM messages WHERE status NOT IN ('pending', 'claimed') ORDER BY phone, id DESC) l
    LEFT JOIN contacts c ON c.phone = l.phone
    ORDER BY l.id DESC LIMIT 300`);
}

/** A conversation, oldest first. Opening it marks what came in as read. */
export async function thread(rawPhone: unknown) {
  const p = phone(rawPhone);
  await q("UPDATE messages SET read = true WHERE phone = $1 AND direction = 'in' AND NOT read", [p]);
  const [contact] = await q<Contact>(`SELECT ${CONTACT} FROM contacts WHERE phone = $1`, [p]);
  const messages = await q<Message>(`SELECT ${MESSAGE} FROM (SELECT * FROM messages WHERE phone = $1 ORDER BY id DESC LIMIT 1000) m ORDER BY id`, [p]);
  return { phone: p, contact: contact ?? null, messages };
}

// ---- campaigns ----

const CAMPAIGN = `c.id::text, c.name, c.body, c.tag, c.recipients, c.status, c.created_by, c.created_at, c.finished_at,
  count(m.*) FILTER (WHERE m.status IN ('pending', 'claimed'))::int AS pending,
  count(m.*) FILTER (WHERE m.status NOT IN ('pending', 'claimed', 'failed', 'skipped', 'undelivered'))::int AS sent,
  count(m.*) FILTER (WHERE m.status IN ('failed', 'undelivered'))::int AS failed,
  count(m.*) FILTER (WHERE m.status = 'skipped')::int AS skipped`;

export async function listCampaigns(): Promise<Campaign[]> {
  return q<Campaign>(`SELECT ${CAMPAIGN} FROM campaigns c LEFT JOIN messages m ON m.campaign_id = c.id GROUP BY c.id ORDER BY c.id DESC LIMIT 100`);
}

export async function getCampaign(cid: unknown): Promise<Campaign> {
  const [c] = await q<Campaign>(`SELECT ${CAMPAIGN} FROM campaigns c LEFT JOIN messages m ON m.campaign_id = c.id WHERE c.id = $1 GROUP BY c.id`, [id(cid)]);
  if (!c) throw new UserError("Not found", 404);
  return c;
}

/** How many contacts a campaign to `tag` (or everyone) would reach now. */
export async function audience(tag: unknown): Promise<number> {
  const t = tags(tag)[0] ?? "";
  const [r] = await q<{ n: number }>("SELECT count(*)::int AS n FROM contacts WHERE NOT opted_out AND ($1 = '' OR $1 = ANY(tags))", [t]);
  return r.n;
}

/**
 * A text to every contact who hasn't opted out (or only those with `tag`). Each recipient gets a
 * pending message now; they are sent one at a time in the background.
 */
export async function createCampaign(me: Me, b: Record<string, unknown>): Promise<Campaign> {
  if (!provider().configured) throw new UserError("No texting service is set up, so a campaign can't be sent", 409);
  const name = text(b.name, 100);
  if (!name) throw new UserError("Name the campaign");
  const text_ = body(b.body);
  const tag = tags(b.tag)[0] ?? "";
  const cid = await tx(async (tq) => {
    const [c] = await tq<{ id: string }>("INSERT INTO campaigns (name, body, tag, created_by) VALUES ($1, $2, $3, $4) RETURNING id::text", [
      name,
      text_,
      tag,
      me.email,
    ]);
    const added = await tq(
      `INSERT INTO messages (phone, direction, body, status, campaign_id, sent_by)
       SELECT phone, 'out', $2, 'pending', $1, $3 FROM contacts WHERE NOT opted_out AND ($4 = '' OR $4 = ANY(tags)) ORDER BY id
       RETURNING id`,
      [c.id, text_, me.email, tag],
    );
    if (!added.length) throw new UserError(tag ? `No one tagged "${tag}" can be texted` : "There is no one to text yet");
    await tq("UPDATE campaigns SET recipients = $2 WHERE id = $1", [c.id, added.length]);
    return c.id;
  });
  kick();
  return getCampaign(cid);
}

const g = globalThis as unknown as { __smsSending?: Promise<void> };

/** Starts the background sender unless it is already running. */
export function kick(): Promise<void> {
  if (!g.__smsSending) {
    g.__smsSending = sendPending().finally(() => {
      g.__smsSending = undefined;
    });
  }
  return g.__smsSending;
}

/**
 * Sends campaign texts still pending, oldest first, one every SMS_SEND_INTERVAL_MS (default one a
 * second, Twilio's rate for a long code). Someone who opted out after the campaign started is skipped.
 */
export async function sendPending(intervalMs = Number(process.env.SMS_SEND_INTERVAL_MS ?? 1000)): Promise<void> {
  for (;;) {
    const [m] = await q<{ id: string; phone: string; body: string; campaign_id: string; opted_out: boolean | null }>(
      `UPDATE messages SET status = 'claimed' WHERE id = (
         SELECT id FROM messages WHERE status = 'pending' AND campaign_id IS NOT NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING id::text, phone, body, campaign_id::text, (SELECT opted_out FROM contacts c WHERE c.phone = messages.phone) AS opted_out`,
    );
    if (!m) break;
    if (m.opted_out) await q("UPDATE messages SET status = 'skipped', error = 'Opted out' WHERE id = $1", [m.id]);
    else await deliver(m.id, m.phone, m.body);
    await q(
      `UPDATE campaigns SET status = 'done', finished_at = now()
       WHERE id = $1 AND status = 'sending' AND NOT EXISTS (SELECT 1 FROM messages WHERE campaign_id = $1 AND status IN ('pending', 'claimed'))`,
      [m.campaign_id],
    );
    if (!m.opted_out && intervalMs > 0) await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** After a restart: texts that were mid-send go back to pending, and sending resumes. */
export async function resume(): Promise<void> {
  await q("UPDATE messages SET status = 'pending' WHERE status = 'claimed'");
  void kick().catch((e) => console.error("[sms] sending", e));
}

// ---- from the provider ----

/** A text that came in. STOP and START (and their synonyms) change the sender's opt-out. */
export async function received(p: { from: string; body: string; id: string }): Promise<void> {
  const from = e164(p.from);
  if (!from) return;
  const text_ = String(p.body ?? "").slice(0, MAX_BODY);
  await tx(async (tq) => {
    const added = await tq(
      `INSERT INTO messages (phone, direction, body, status, provider_id, read) VALUES ($1, 'in', $2, 'received', $3, false)
       ON CONFLICT (provider_id) WHERE provider_id IS NOT NULL DO NOTHING RETURNING id`,
      [from, text_, p.id || null],
    );
    if (!added.length) return; // the provider retried a text already saved
    await tq("INSERT INTO contacts (phone) VALUES ($1) ON CONFLICT (phone) DO NOTHING", [from]);
    const word = optKeyword(text_);
    if (word === "stop") await tq("UPDATE contacts SET opted_out = true, opted_out_at = now() WHERE phone = $1 AND NOT opted_out", [from]);
    if (word === "start") await tq("UPDATE contacts SET opted_out = false, opted_out_at = NULL WHERE phone = $1", [from]);
  });
}

/** Twilio's message states in the order they happen; a late update never moves a text backwards. */
export const DELIVERY_ORDER = ["accepted", "scheduled", "queued", "sending", "sent", "delivered", "undelivered", "failed", "read"];

/** A delivery update for a text sent earlier. */
export async function delivered(p: { id: string; status: string; error?: string }): Promise<void> {
  const next = String(p.status ?? "").toLowerCase();
  if (!p.id || !DELIVERY_ORDER.includes(next)) return;
  await q(
    `UPDATE messages SET status = $2, error = COALESCE(NULLIF($3, ''), error)
     WHERE provider_id = $1 AND direction = 'out' AND array_position($4::text[], status) IS NOT NULL
       AND array_position($4::text[], status) <= array_position($4::text[], $2)`,
    [p.id, next, (p.error ?? "").slice(0, 500), DELIVERY_ORDER],
  );
}
