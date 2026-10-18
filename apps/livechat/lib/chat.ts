import { createHash, randomBytes } from "node:crypto";
import { q } from "./db";
import { UserError, isEmail, text } from "./util";
import type { Widget } from "./widgets";

export type Message = { id: string; sender: "visitor" | "agent" | "system"; body: string; agent_email: string; at: Date };
export type Conversation = {
  id: string;
  widget_id: string;
  widget_name: string;
  visitor_name: string;
  visitor_email: string;
  page: string;
  status: "open" | "closed";
  assigned_to: string;
  ticket_number: string | null;
  created_at: Date;
  last_at: Date;
};
export type ConversationRow = Conversation & { last_body: string | null; unread: number };

const MAX_BODY = 4000;

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

function convId(v: unknown): string {
  const s = String(v ?? "");
  if (!/^\d{1,18}$/.test(s)) throw new UserError("Not found", 404);
  return s;
}

function visitorEmail(v: unknown): string {
  const e = String(v ?? "").trim().toLowerCase();
  if (!e) return "";
  if (!isEmail(e) || e.length > 200) throw new UserError("Enter a valid email address");
  return e;
}

/** The page a chat started on, without its query string or fragment. */
export function cleanPage(v: unknown): string {
  try {
    const u = new URL(String(v ?? ""));
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return `${u.origin}${u.pathname}`.slice(0, 300);
  } catch {
    return "";
  }
}

// ---------- the visitor's side (the widget) ----------

/** Starts a conversation. The token is returned once; only its hash is stored. */
export async function start(w: Widget, b: { name?: unknown; email?: unknown; page?: unknown }): Promise<{ token: string; id: string }> {
  const token = randomBytes(24).toString("base64url");
  const [c] = await q<{ id: string }>(
    `INSERT INTO conversations (widget_id, token_hash, visitor_name, visitor_email, page) VALUES ($1, $2, $3, $4, $5) RETURNING id::text`,
    [w.id, hashToken(token), text(b.name, 100), visitorEmail(b.email), cleanPage(b.page)],
  );
  if (w.greeting) await q(`INSERT INTO messages (conv_id, sender, body) VALUES ($1, 'system', $2)`, [c.id, w.greeting]);
  return { token, id: c.id };
}

/** The conversation a visitor's token opens, with its widget's domain for the origin check. */
export async function byToken(token: unknown): Promise<{ id: string; widget_id: string; domain: string; visitor_email: string; status: string } | null> {
  const t = String(token ?? "");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return null;
  const [c] = await q<{ id: string; widget_id: string; domain: string; visitor_email: string; status: string }>(
    `SELECT c.id::text, c.widget_id::text, w.domain, c.visitor_email, c.status FROM conversations c JOIN widgets w ON w.id = c.widget_id WHERE c.token_hash = $1`,
    [hashToken(t)],
  );
  return c ?? null;
}

/** A visitor's message. Writing again reopens a closed chat. An email given later is kept. */
export async function visitorSays(convIdIn: string, b: { body?: unknown; email?: unknown; name?: unknown }): Promise<Message> {
  const body = text(b.body, MAX_BODY);
  if (!body) throw new UserError("Type a message");
  const email = b.email === undefined ? "" : visitorEmail(b.email);
  const name = b.name === undefined ? "" : text(b.name, 100);
  await q(
    `UPDATE conversations SET last_at = now(), status = 'open',
       visitor_email = CASE WHEN $2 <> '' THEN $2 ELSE visitor_email END,
       visitor_name = CASE WHEN $3 <> '' THEN $3 ELSE visitor_name END
     WHERE id = $1`,
    [convIdIn, email, name],
  );
  const [m] = await q<Message>(`INSERT INTO messages (conv_id, sender, body) VALUES ($1, 'visitor', $2) RETURNING id::text, sender, body, agent_email, at`, [convIdIn, body]);
  return m;
}

/** What the widget shows: messages after `after`, without agents' addresses. */
export async function visitorPoll(convIdIn: string, after: unknown): Promise<{ status: string; messages: { id: string; sender: string; body: string; at: Date }[] }> {
  const a = /^\d{1,18}$/.test(String(after ?? "")) ? String(after) : "0";
  const rows = await q<{ id: string; sender: string; body: string; at: Date }>(
    `SELECT id::text, sender, body, at FROM messages WHERE conv_id = $1 AND id > $2 ORDER BY id LIMIT 200`,
    [convIdIn, a],
  );
  const [c] = await q<{ status: string }>(`SELECT status FROM conversations WHERE id = $1`, [convIdIn]);
  return { status: c?.status ?? "closed", messages: rows };
}

// ---------- the agents' side (the console) ----------

const CONV_COLS = `c.id::text, c.widget_id::text, w.name AS widget_name, c.visitor_name, c.visitor_email, c.page, c.status, c.assigned_to,
  c.ticket_number, c.created_at, c.last_at`;

export async function listConversations(status: unknown, mine?: string): Promise<ConversationRow[]> {
  const st = status === "closed" ? "closed" : "open";
  return q<ConversationRow>(
    `SELECT ${CONV_COLS},
       (SELECT body FROM messages m WHERE m.conv_id = c.id AND m.sender <> 'system' ORDER BY id DESC LIMIT 1) AS last_body,
       (SELECT count(*) FROM messages m WHERE m.conv_id = c.id AND m.sender = 'visitor' AND m.id > c.agent_seen_id)::int AS unread
     FROM conversations c JOIN widgets w ON w.id = c.widget_id
     WHERE c.status = $1 AND ($2::text IS NULL OR c.assigned_to = $2)
       AND EXISTS (SELECT 1 FROM messages m WHERE m.conv_id = c.id AND m.sender = 'visitor')
     ORDER BY c.last_at DESC LIMIT 200`,
    [st, mine ?? null],
  );
}

/** One conversation with its messages; opening it marks the visitor's messages as seen. */
export async function openConversation(id: string, markSeen = true): Promise<{ conversation: Conversation; messages: Message[] }> {
  const [c] = await q<Conversation>(`SELECT ${CONV_COLS} FROM conversations c JOIN widgets w ON w.id = c.widget_id WHERE c.id = $1`, [convId(id)]);
  if (!c) throw new UserError("Not found", 404);
  const messages = await q<Message>(`SELECT id::text, sender, body, agent_email, at FROM messages WHERE conv_id = $1 ORDER BY id`, [c.id]);
  if (markSeen && messages.length) await q(`UPDATE conversations SET agent_seen_id = GREATEST(agent_seen_id, $2) WHERE id = $1`, [c.id, messages[messages.length - 1].id]);
  return { conversation: c, messages };
}

export async function agentReply(id: string, agent: string, b: { body?: unknown }): Promise<Message> {
  const body = text(b.body, MAX_BODY);
  if (!body) throw new UserError("Type a reply");
  const [c] = await q<{ id: string }>(
    `UPDATE conversations SET last_at = now(), status = 'open', assigned_to = CASE WHEN assigned_to = '' THEN $2 ELSE assigned_to END
     WHERE id = $1 RETURNING id::text`,
    [convId(id), agent],
  );
  if (!c) throw new UserError("Not found", 404);
  const [m] = await q<Message>(
    `INSERT INTO messages (conv_id, sender, body, agent_email) VALUES ($1, 'agent', $2, $3) RETURNING id::text, sender, body, agent_email, at`,
    [c.id, body, agent],
  );
  await q(`UPDATE conversations SET agent_seen_id = GREATEST(agent_seen_id, $2) WHERE id = $1`, [c.id, m.id]);
  return m;
}

export async function setStatus(id: string, status: "open" | "closed", agent: string): Promise<void> {
  const [c] = await q<{ id: string }>(`UPDATE conversations SET status = $2 WHERE id = $1 RETURNING id::text`, [convId(id), status]);
  if (!c) throw new UserError("Not found", 404);
  await q(`INSERT INTO messages (conv_id, sender, body, agent_email) VALUES ($1, 'system', $2, $3)`, [
    c.id,
    status === "closed" ? "This chat was closed. Write again any time to reopen it." : "This chat was reopened.",
    agent,
  ]);
}

/** Assigns a chat to someone (blank to unassign). */
export async function assign(id: string, to: unknown): Promise<void> {
  const who = String(to ?? "").trim().toLowerCase();
  if (who && !isEmail(who)) throw new UserError("Enter an email address");
  const [c] = await q(`UPDATE conversations SET assigned_to = $2 WHERE id = $1 RETURNING id`, [convId(id), who]);
  if (!c) throw new UserError("Not found", 404);
}

// ---------- hand-off to Desk ----------

export function deskConfigured(): boolean {
  return Boolean(process.env.DESK_SVC_URL && process.env.DESK_SVC_TOKEN);
}

/**
 * Opens a Desk ticket from a chat, through Desk's intake API (bearer DESK_SVC_TOKEN), with the
 * whole transcript as its first message, and notes the ticket number on the chat.
 */
export async function sendToDesk(id: string, agent: string, fetcher: typeof fetch = fetch): Promise<{ number: string }> {
  if (!deskConfigured()) throw new UserError("Desk isn't connected. Set DESK_SVC_URL and DESK_SVC_TOKEN.", 400);
  const { conversation: c, messages } = await openConversation(id, false);
  if (c.ticket_number) throw new UserError(`This chat is already Desk ticket ${c.ticket_number}`, 409);
  if (!c.visitor_email) throw new UserError("Desk needs the visitor's email address, and this chat doesn't have one", 400);
  const transcript = messages
    .filter((m) => m.sender !== "system")
    .map((m) => `${m.sender === "agent" ? m.agent_email || "Agent" : c.visitor_name || "Visitor"} (${new Date(m.at).toISOString().slice(0, 16).replace("T", " ")} UTC): ${m.body}`)
    .join("\n\n");
  const firstLine = messages.find((m) => m.sender === "visitor")?.body.split("\n")[0].slice(0, 80) ?? "";
  const res = await fetcher(`${process.env.DESK_SVC_URL!.replace(/\/$/, "")}/api/intake`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.DESK_SVC_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      subject: `Live chat: ${firstLine || c.visitor_name || c.visitor_email}`,
      body: `From a live chat on ${c.widget_name}${c.page ? ` (${c.page})` : ""}, sent to Desk by ${agent}.\n\n${transcript}`,
      email: c.visitor_email,
      name: c.visitor_name,
      priority: "normal",
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res || !res.ok) throw new UserError("Desk didn't take the ticket. Try again in a moment.", 502);
  const out = (await res.json().catch(() => ({}))) as { number?: unknown };
  const number = String(out.number ?? "");
  if (!number) throw new UserError("Desk didn't say which ticket it opened", 502);
  await q(`UPDATE conversations SET ticket_number = $2 WHERE id = $1`, [c.id, number]);
  await q(`INSERT INTO messages (conv_id, sender, body, agent_email) VALUES ($1, 'system', $2, $3)`, [
    c.id,
    `We've opened support ticket ${number} for this. We'll follow up by email.`,
    agent,
  ]);
  return { number };
}
