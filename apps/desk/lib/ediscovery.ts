import { type ExportItem, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import { APP, type Search, nextCursor, snippet } from "./compliance";
import { TICKET_PEOPLE } from "./tickets";

/** Desk's one kind of content for the Admin center: tickets, with their whole thread. */
export const KINDS = ["ticket"];

/** The thread as plain text, internal notes included, for keywords and snippets. */
const THREAD = `COALESCE((SELECT string_agg(m.body, ' ' ORDER BY m.id) FROM ticket_messages m WHERE m.ticket_id = t.id), '')`;

type Row = {
  id: string; number: string; subject: string; owner: string; people: string[]; thread: string; updated_at: Date; size: string; total: string;
};

function hit(r: Row, s: Pick<Search, "query">): SearchHit {
  const participants = r.people.filter((p) => p !== r.owner);
  return {
    id: String(r.id),
    kind: "ticket",
    title: `${r.number} ${r.subject}`,
    // The requester is who the ticket is about; staff on it are participants.
    owner: r.owner,
    ...(participants.length ? { participants } : {}),
    date: r.updated_at.toISOString(),
    snippet: snippet(r.thread || r.subject, s.query),
    size: Number(r.size),
  };
}

const SELECT = `SELECT t.id, t.number, t.subject, lower(t.requester_email) AS owner, ${TICKET_PEOPLE} AS people, ${THREAD} AS thread,
  t.updated_at, COALESCE((SELECT sum(octet_length(m.body)) FROM ticket_messages m WHERE m.ticket_id = t.id), 0) AS size`;

/** Tickets matching an eDiscovery search, newest activity first. */
export async function search(s: Search): Promise<SearchResponse> {
  if (s.kinds && !s.kinds.includes("ticket")) return { app: APP, hits: [], total: 0 };
  const params: unknown[] = [s.custodians, s.from, s.until, s.limit, s.offset];
  const words = queryToSql(s.query, ["t.number", "t.subject", "t.requester_email", "t.requester_name", THREAD], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `${SELECT}, COUNT(*) OVER () AS total FROM tickets t
     WHERE ${words.sql}
       AND (cardinality($1::text[]) = 0 OR ${TICKET_PEOPLE} && $1::text[])
       AND ($2::timestamptz IS NULL OR t.updated_at >= $2)
       AND ($3::timestamptz IS NULL OR t.updated_at < $3)
     ORDER BY t.updated_at DESC, t.id
     LIMIT $4 OFFSET $5`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

/** Each ticket in full: the conversation as text, and every message, internal notes too, as metadata. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter((i) => /^\d{1,18}$/.test(i));
  if (!wanted.length) return { items: [] };
  const rows = await q<Row & {
    requester_email: string; requester_name: string; status: string; priority: string; assignee: string; source: string;
    email_message_id: string | null; created_at: Date; solved_at: Date | null;
  }>(`${SELECT}, 0 AS total, t.requester_email, t.requester_name, t.status, t.priority, t.assignee, t.source, t.email_message_id,
       t.created_at, t.solved_at FROM tickets t WHERE t.id = ANY($1::bigint[])`, [wanted]);
  const items: ExportItem[] = [];
  for (const r of rows) {
    const messages = await q<{ id: string; direction: string; author: string; body: string; emailed: boolean; email_message_id: string | null; created_at: Date }>(
      "SELECT * FROM ticket_messages WHERE ticket_id = $1 ORDER BY id",
      [r.id],
    );
    const thread = messages
      .filter((m) => m.direction !== "note")
      .map((m) => `${m.direction === "inbound" ? "From" : "Reply by"} ${m.author}, ${m.created_at.toISOString()}\n\n${m.body}`)
      .join("\n\n---\n\n");
    items.push({
      ...hit(r, { query: { groups: [], none: [] } }),
      app: APP,
      metadata: {
        number: r.number,
        subject: r.subject,
        requesterEmail: r.requester_email,
        requesterName: r.requester_name,
        status: r.status,
        priority: r.priority,
        assignee: r.assignee,
        source: r.source,
        emailMessageId: r.email_message_id,
        createdAt: r.created_at.toISOString(),
        solvedAt: r.solved_at?.toISOString() ?? null,
        messages: messages.map((m) => ({
          id: Number(m.id),
          direction: m.direction,
          internal: m.direction === "note",
          author: m.author,
          body: m.body,
          emailed: m.emailed,
          emailMessageId: m.email_message_id,
          createdAt: m.created_at.toISOString(),
        })),
        internalNotes: messages.filter((m) => m.direction === "note").map((m) => ({ author: m.author, body: m.body, createdAt: m.created_at.toISOString() })),
      },
      text: thread,
    });
  }
  items.sort((x, y) => wanted.indexOf(x.id) - wanted.indexOf(y.id));
  return { items };
}
