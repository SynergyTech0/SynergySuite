// Suite-wide search (packages/search) for the signed-in person: the tickets and articles they can
// open in Desk, by the same rules as the ticket list and /api/kb (lib/agents.ts). Agents with the
// "all" scope see every ticket, internal notes included, and drafts; a restricted agent only the
// tickets assigned to them; anyone else only the tickets they asked for, without internal notes,
// and published articles. Tickets are only ever deleted by retention, so there is nothing
// deleted under hold to leave out.
import { clipText, queryToSql, readSearchQuery, snippet, type SearchResult, type SearchResults } from "@synergy/search";
import { q } from "./db";
import { APP } from "./compliance";
import { articleVisible, seesNotes, ticketVisible, type Viewer } from "./agents";

export const KINDS = ["ticket", "article"] as const;

/** The thread as plain text, internal notes included only for agents (as in the ticket pane). */
const thread = (v: Viewer) =>
  `COALESCE((SELECT string_agg(m.body, ' ' ORDER BY m.id) FROM ticket_messages m WHERE m.ticket_id = t.id${seesNotes(v) ? "" : " AND m.direction <> 'note'"}), '')`;

type Parsed = ReturnType<typeof readSearchQuery>;

async function tickets(v: Viewer, s: Parsed): Promise<SearchResult[]> {
  const THREAD = thread(v);
  const params: unknown[] = [s.limit];
  const visible = ticketVisible(v, "t", params);
  const words = queryToSql(s.parsed, ["t.number", "t.subject", "t.requester_email", "t.requester_name", THREAD], params.length + 1);
  const rows = await q<{ id: string; number: string; subject: string; requester_email: string; requester_name: string; thread: string; updated_at: Date }>(
    `SELECT t.id, t.number, t.subject, t.requester_email, t.requester_name, ${THREAD} AS thread, t.updated_at
     FROM tickets t WHERE ${visible} AND ${words.sql} ORDER BY t.updated_at DESC, t.id DESC LIMIT $1`,
    [...params, ...words.params],
  );
  return rows.map((r) => ({
    id: `ticket:${r.id}`,
    kind: "ticket",
    title: `${r.number} ${r.subject}`,
    snippet: snippet(r.thread || r.subject, s.parsed),
    date: new Date(r.updated_at).toISOString(),
    url: `/?ticket=${r.id}`,
    person: r.requester_name || r.requester_email,
    ...(s.text ? { text: clipText(`${r.subject}\n${r.thread}`) } : {}),
  }));
}

async function articles(v: Viewer, s: Parsed): Promise<SearchResult[]> {
  const words = queryToSql(s.parsed, ["a.title", "a.body"], 2);
  const rows = await q<{ id: string; title: string; body: string; published: boolean; updated_by: string; updated_at: Date }>(
    `SELECT a.id, a.title, a.body, a.published, a.updated_by, a.updated_at
     FROM kb_articles a WHERE ${articleVisible(v, "a")} AND ${words.sql} ORDER BY a.updated_at DESC, a.id DESC LIMIT $1`,
    [s.limit, ...words.params],
  );
  return rows.map((r) => ({
    id: `article:${r.id}`,
    kind: "article",
    title: r.published ? r.title : `${r.title} (draft)`,
    snippet: snippet(r.body || r.title, s.parsed),
    date: new Date(r.updated_at).toISOString(),
    url: `/?article=${r.id}`,
    ...(r.updated_by ? { person: r.updated_by } : {}),
    ...(s.text ? { text: clipText(`${r.title}\n${r.body}`) } : {}),
  }));
}

export async function searchFor(v: Viewer, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const want = (k: string) => !s.kinds.length || s.kinds.includes(k);
  const parts = await Promise.all([want("ticket") ? tickets(v, s) : [], want("article") ? articles(v, s) : []]);
  const results = parts.flat().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, s.limit);
  return { app: APP, results };
}
