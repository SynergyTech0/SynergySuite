import { seesNotes, ticketVisible, type Viewer } from "./agents";
import { holdChecker, policy } from "./compliance";
import { q, tx, type Tq } from "./db";
import { outbox } from "./mailer";
import { formatNumber, normalizeMessageId, replySubject, stripQuoted, threadIds, ticketTag } from "./threading";
import { PRIORITIES, STATUSES, type Message, type Priority, type Source, type Status, type Ticket, type TicketDetail } from "./types";
import { cleanEmail, text, UserError } from "./util";

const MAX_BODY = 20000;

type Row = Record<string, unknown>;

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

function toTicket(r: Row): Ticket {
  return {
    id: Number(r.id),
    number: r.number as string,
    subject: r.subject as string,
    requesterEmail: r.requester_email as string,
    requesterName: r.requester_name as string,
    status: r.status as Status,
    priority: r.priority as Priority,
    assignee: r.assignee as string,
    source: r.source as Source,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    solvedAt: iso(r.solved_at),
    messageCount: Number(r.message_count ?? 0),
    preview: (r.preview as string | undefined) ?? "",
    lastDirection: (r.last_direction as Message["direction"] | undefined) ?? null,
  };
}

function toMessage(r: Row): Message {
  return {
    id: Number(r.id),
    direction: r.direction as Message["direction"],
    author: r.author as string,
    body: r.body as string,
    emailed: Boolean(r.emailed),
    createdAt: iso(r.created_at)!,
  };
}

// The list adds a count and the latest customer-visible message, for the preview line.
const LIST_COLUMNS = `t.*,
  (SELECT count(*) FROM ticket_messages m WHERE m.ticket_id = t.id)::int AS message_count,
  last.body AS preview, last.direction AS last_direction`;
const LAST_JOIN = `LEFT JOIN LATERAL (
  SELECT left(m.body, 200) AS body, m.direction FROM ticket_messages m
  WHERE m.ticket_id = t.id AND m.direction <> 'note' ORDER BY m.id DESC LIMIT 1
) last ON true`;

export type View = Status | "all" | "mine" | "unassigned";

function like(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** The tickets `v` can open (lib/agents.ts), in one of the navigation's views. */
export async function list(v: Viewer, opts: { view?: string; q?: string } = {}): Promise<Ticket[]> {
  const params: unknown[] = [];
  const where: string[] = [ticketVisible(v, "t", params)];
  const view = opts.view || "open";
  if ((STATUSES as readonly string[]).includes(view)) where.push(`t.status = $${params.push(view)}`);
  else if (view === "mine") where.push(`t.assignee = $${params.push(v.email)} AND t.status IN ('open','pending')`);
  else if (view === "unassigned") where.push(`t.assignee = '' AND t.status IN ('open','pending')`);
  const search = text(opts.q, 200);
  if (search) {
    const p = params.push(like(search));
    where.push(`(t.number ILIKE $${p} OR t.subject ILIKE $${p} OR t.requester_email ILIKE $${p} OR t.requester_name ILIKE $${p}
      OR EXISTS (SELECT 1 FROM ticket_messages m WHERE m.ticket_id = t.id AND m.body ILIKE $${p}${seesNotes(v) ? "" : " AND m.direction <> 'note'"}))`);
  }
  const rows = await q(
    `SELECT ${LIST_COLUMNS} FROM tickets t ${LAST_JOIN}
     WHERE ${where.join(" AND ")}
     ORDER BY t.updated_at DESC LIMIT 300`,
    params,
  );
  return rows.map(toTicket);
}

/** How many of the tickets `v` can open each navigation entry holds. */
export async function counts(v: Viewer): Promise<Record<View, number>> {
  const params: unknown[] = [v.email];
  const visible = ticketVisible(v, "t", params);
  const [r] = await q<Record<string, number>>(
    `SELECT count(*) FILTER (WHERE status = 'open')::int AS open,
            count(*) FILTER (WHERE status = 'pending')::int AS pending,
            count(*) FILTER (WHERE status = 'solved')::int AS solved,
            count(*) FILTER (WHERE status = 'closed')::int AS closed,
            count(*)::int AS "all",
            count(*) FILTER (WHERE assignee = $1 AND status IN ('open','pending'))::int AS mine,
            count(*) FILTER (WHERE assignee = '' AND status IN ('open','pending'))::int AS unassigned
     FROM tickets t WHERE ${visible}`,
    params,
  );
  return r as Record<View, number>;
}

/**
 * One ticket with its conversation. With a viewer, only if they can open it, and internal notes
 * only for agents; without one (the desk's own code), as stored.
 */
export async function get(id: number, v: Viewer | null = null): Promise<TicketDetail> {
  const params: unknown[] = [id];
  const [t] = await q(`SELECT ${LIST_COLUMNS} FROM tickets t ${LAST_JOIN} WHERE t.id = $1 AND ${v ? ticketVisible(v, "t", params) : "TRUE"}`, params);
  if (!t) throw new UserError("That ticket doesn't exist", 404);
  const notes = !v || seesNotes(v);
  const messages = await q(`SELECT * FROM ticket_messages WHERE ticket_id = $1 ${notes ? "" : "AND direction <> 'note'"} ORDER BY id`, [id]);
  return { ...toTicket(t), messages: messages.map(toMessage) };
}

/** The agents, for the assignee picker. */
export async function assignees(): Promise<string[]> {
  const rows = await q<{ email: string }>("SELECT email FROM agents ORDER BY email LIMIT 500");
  return rows.map((r) => r.email);
}

/**
 * The next number for this year. The counter row is locked by the upsert until the
 * transaction ends, so concurrent creates queue up instead of colliding. The first ticket of
 * a year starts after any numbers already used (e.g. tickets imported from elsewhere).
 */
async function nextNumber(tq: Tq, year: number): Promise<string> {
  const [{ last }] = await tq<{ last: number }>(
    `INSERT INTO ticket_counters (year, last)
       VALUES ($1::int, 1 + COALESCE((SELECT max(substring(number FROM 8)::int) FROM tickets WHERE number ~ ('^T-' || $1::text || '-[0-9]+$')), 0))
     ON CONFLICT (year) DO UPDATE SET last = ticket_counters.last + 1
     RETURNING last`,
    [year],
  );
  return formatNumber(year, last);
}

export type NewTicket = {
  subject?: unknown; requesterEmail?: unknown; requesterName?: unknown; body?: unknown; priority?: unknown; assignee?: unknown;
};

function cleanPriority(v: unknown): Priority {
  if (v == null || v === "") return "normal";
  if (!(PRIORITIES as readonly string[]).includes(String(v))) throw new UserError("Pick a priority: low, normal, high or urgent");
  return v as Priority;
}

export async function create(
  input: NewTicket,
  opts: { source: Source; author?: string; emailMessageId?: string | null },
): Promise<Ticket> {
  const subject = text(input.subject, 300);
  if (!subject) throw new UserError("Enter a subject");
  const requesterEmail = cleanEmail(input.requesterEmail);
  const requesterName = text(input.requesterName, 200);
  const priority = cleanPriority(input.priority);
  const assignee = input.assignee ? cleanEmail(input.assignee) : "";
  const body = text(input.body, MAX_BODY);
  const msgId = normalizeMessageId(opts.emailMessageId);
  const row = await tx(async (tq) => {
    const number = await nextNumber(tq, new Date().getFullYear());
    const [t] = await tq(
      `INSERT INTO tickets (number, subject, requester_email, requester_name, source, priority, assignee, email_message_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [number, subject, requesterEmail, requesterName, opts.source, priority, assignee, msgId],
    );
    if (body) {
      await tq(
        `INSERT INTO ticket_messages (ticket_id, direction, author, body, email_message_id) VALUES ($1,'inbound',$2,$3,$4)`,
        [t.id, opts.author || requesterEmail, body, msgId],
      );
    }
    return { ...t, message_count: body ? 1 : 0, preview: body.slice(0, 200), last_direction: body ? "inbound" : null };
  });
  return toTicket(row);
}

export type TicketPatch = { status?: unknown; priority?: unknown; assignee?: unknown };

export async function update(id: number, patch: TicketPatch): Promise<TicketDetail> {
  const status = patch.status == null ? null : String(patch.status);
  if (status && !(STATUSES as readonly string[]).includes(status)) throw new UserError("Pick a status: open, pending, solved or closed");
  const priority = patch.priority == null ? null : cleanPriority(patch.priority);
  const assignee = patch.assignee == null ? null : patch.assignee === "" ? "" : cleanEmail(patch.assignee);
  const rows = await q(
    `UPDATE tickets SET
       status = COALESCE($2, status),
       priority = COALESCE($3, priority),
       assignee = COALESCE($4, assignee),
       solved_at = CASE WHEN $2 = 'solved' THEN COALESCE(solved_at, now())
                        WHEN $2 IN ('open','pending') THEN NULL ELSE solved_at END,
       updated_at = now()
     WHERE id = $1 RETURNING id`,
    [id, status, priority, assignee],
  );
  if (!rows.length) throw new UserError("That ticket doesn't exist", 404);
  return get(id);
}

/**
 * A staff answer. A reply is emailed to the requester as "Re: subject [T-…]", threaded onto
 * the conversation, and the ticket waits on them (pending). An internal note is only saved,
 * and leaves the status alone.
 */
export async function reply(
  id: number,
  me: string,
  input: { body?: unknown; internal?: unknown },
): Promise<{ message: Message; emailed: boolean; reason?: string }> {
  const body = text(input.body, MAX_BODY);
  if (!body) throw new UserError("Write something first");
  const internal = Boolean(input.internal);
  const [t] = await q("SELECT * FROM tickets WHERE id = $1", [id]);
  if (!t) throw new UserError("That ticket doesn't exist", 404);

  let sent: { emailed: boolean; messageId: string | null; reason?: string } = { emailed: false, messageId: null };
  if (!internal) {
    // Answer the requester's latest email, and carry the whole chain in References.
    const ids = await q<{ email_message_id: string }>(
      `SELECT email_message_id FROM ticket_messages WHERE ticket_id = $1 AND email_message_id IS NOT NULL ORDER BY id`,
      [id],
    );
    const chain = [...new Set([t.email_message_id as string | null, ...ids.map((r) => r.email_message_id)].filter((x): x is string => !!x))];
    sent = await outbox
      .send({
        to: t.requester_email as string,
        subject: replySubject(t.subject as string, t.number as string),
        body,
        inReplyTo: chain[chain.length - 1] ?? null,
        references: chain.slice(-20),
      })
      .catch((e: Error) => {
        console.error("[desk] reply not emailed:", e.message);
        return { emailed: false, messageId: null, reason: "the email server refused it" };
      });
  }
  const msg = await tx(async (tq) => {
    const [m] = await tq(
      `INSERT INTO ticket_messages (ticket_id, direction, author, body, emailed, email_message_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, internal ? "note" : "outbound", me, body, sent.emailed, sent.messageId],
    );
    await tq(
      `UPDATE tickets SET status = CASE WHEN $2 THEN status ELSE 'pending' END,
         solved_at = CASE WHEN $2 THEN solved_at ELSE NULL END, updated_at = now() WHERE id = $1`,
      [id, internal],
    );
    return m;
  });
  return { message: toMessage(msg), emailed: sent.emailed, ...(sent.reason ? { reason: sent.reason } : {}) };
}

export type Inbound = {
  from: string;
  fromName?: string;
  subject?: string;
  text?: string;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | string[] | null;
};

/**
 * An email that arrived in the support mailbox. It joins a ticket when its subject carries
 * the ticket's tag, or it answers a message we have on file (In-Reply-To / References);
 * that reopens the ticket. Anything else starts a new ticket. The same email delivered twice
 * is only filed once.
 */
export async function receive(mail: Inbound): Promise<{ ticketId: number; created: boolean } | null> {
  const from = String(mail.from || "").trim().toLowerCase();
  if (!from.includes("@")) return null;
  const msgId = normalizeMessageId(mail.messageId);
  if (msgId) {
    const [dup] = await q<{ ticket_id: string }>(
      `SELECT ticket_id FROM ticket_messages WHERE email_message_id = $1
       UNION ALL SELECT id FROM tickets WHERE email_message_id = $1 LIMIT 1`,
      [msgId],
    );
    if (dup) return { ticketId: Number(dup.ticket_id), created: false };
  }

  let ticket: Row | undefined;
  const tag = ticketTag(mail.subject);
  if (tag) [ticket] = await q("SELECT id FROM tickets WHERE number = $1", [tag]);
  const refs = threadIds(mail.inReplyTo, mail.references);
  if (!ticket && refs.length) {
    [ticket] = await q(
      `SELECT id FROM tickets WHERE email_message_id = ANY($1)
       UNION ALL SELECT ticket_id FROM ticket_messages WHERE email_message_id = ANY($1) LIMIT 1`,
      [refs],
    );
  }

  const body = stripQuoted(String(mail.text ?? "")).slice(0, MAX_BODY) || "(no message text)";
  if (ticket) {
    const ticketId = Number(ticket.id ?? ticket.ticket_id);
    await tx(async (tq) => {
      await tq(
        `INSERT INTO ticket_messages (ticket_id, direction, author, body, email_message_id) VALUES ($1,'inbound',$2,$3,$4)`,
        [ticketId, from, body, msgId],
      );
      await tq(`UPDATE tickets SET status = 'open', solved_at = NULL, updated_at = now() WHERE id = $1`, [ticketId]);
    });
    return { ticketId, created: false };
  }
  const t = await create(
    { subject: text(mail.subject, 300) || "(no subject)", requesterEmail: from, requesterName: mail.fromName, body },
    { source: "email", emailMessageId: msgId },
  );
  return { ticketId: t.id, created: true };
}

/**
 * The client portal's read-only feed of one customer's tickets. Internal notes are staff-only,
 * so they aren't counted.
 */
export async function feedFor(email: string) {
  const who = cleanEmail(email);
  const rows = await q(
    `SELECT number, subject, status, priority, created_at, updated_at,
       (SELECT count(*) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.direction <> 'note')::int AS message_count
     FROM tickets t WHERE lower(requester_email) = $1 ORDER BY updated_at DESC LIMIT 100`,
    [who],
  );
  return rows.map((r) => ({ ...r, created_at: iso(r.created_at), updated_at: iso(r.updated_at) }));
}

/**
 * One ticket by its number, for Field Service turning a case into a work order: who raised it and
 * what they first wrote. Bearer DESK_API_TOKEN.
 */
export async function svcTicket(number: string) {
  const [t] = await q(
    `SELECT t.number, t.subject, t.status, t.priority, t.requester_email, t.requester_name,
       (SELECT m.body FROM ticket_messages m WHERE m.ticket_id = t.id AND m.direction = 'inbound' ORDER BY m.id LIMIT 1) AS first_message
     FROM tickets t WHERE upper(t.number) = upper($1)`,
    [text(number, 40)],
  );
  if (!t) throw new UserError("That ticket doesn't exist", 404);
  return {
    number: t.number as string, subject: t.subject as string, status: t.status as string, priority: t.priority as string,
    requesterEmail: t.requester_email as string, requesterName: t.requester_name as string, firstMessage: (t.first_message as string) ?? "",
  };
}

/** An internal note from another suite app (Field Service's job updates). Nothing is emailed. */
export async function svcNote(number: string, input: { body?: unknown; author?: unknown }): Promise<{ ok: true }> {
  const [t] = await q<{ id: number }>("SELECT id FROM tickets WHERE upper(number) = upper($1)", [text(number, 40)]);
  if (!t) throw new UserError("That ticket doesn't exist", 404);
  await reply(t.id, text(input.author, 100) || "suite", { body: input.body, internal: true });
  return { ok: true };
}

/** Everyone on a ticket, lower-case: requester, assignee and whoever wrote on it. */
export const TICKET_PEOPLE = `ARRAY(SELECT DISTINCT lower(e) FROM unnest(
  ARRAY[t.requester_email, t.assignee] || ARRAY(SELECT m.author FROM ticket_messages m WHERE m.ticket_id = t.id)
) e WHERE e <> '' ORDER BY 1)`;

/**
 * The Admin center's retention for tickets: solved and closed tickets untouched for longer are
 * deleted with their messages, except those with anyone on them on legal hold. This is the only
 * way a ticket is ever deleted; instrumentation.ts runs it hourly.
 */
export async function expireTickets(): Promise<number> {
  const days = await policy().retentionDays("ticket");
  if (days === null) return 0;
  const old = `t.status IN ('solved','closed') AND t.updated_at < now() - make_interval(days => $1)`;
  const people = await q<{ e: string }>(`SELECT DISTINCT unnest(${TICKET_PEOPLE}) AS e FROM tickets t WHERE ${old}`, [days]);
  const held = holdChecker();
  const keep: string[] = [];
  for (const p of people) if (await held(p.e)) keep.push(p.e);
  const gone = await q(`DELETE FROM tickets t WHERE ${old} AND NOT (${TICKET_PEOPLE} && $2::text[]) RETURNING id`, [days, keep]);
  return gone.length;
}
