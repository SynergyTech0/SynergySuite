/**
 * POST /api/search: suite-wide search on behalf of the signed-in person (see @synergy/search).
 * (GET /api/search is the app's own card search; this is the protocol the Search app speaks.)
 *
 * Who can see what, as lib/authz.ts decides it: a board (plan) is visible to its board members and
 * to the members of its workspace, whatever their role (observers read everything). Search covers
 * those boards, their cards (tasks: title, description, issue key) and the comments on them.
 * Archived cards are left out, as the app's own search leaves them out.
 */
import { and, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { cameThroughGateway, identify, optionsFromEnv } from "@synergy/identity";
import { clipText, queryToSql, readSearchQuery, snippet, type SearchResult, type SearchResults } from "@synergy/search";
import { db, pool } from "@/db";
import { users } from "@/db/schema";
import { visibleBoardIds } from "@/lib/authz";

export const KINDS = ["plan", "task", "comment"] as const;

type User = typeof users.$inferSelect;

/**
 * The caller, from the gateway's identity headers, without the local-dev fallback and without
 * provisioning a row (someone Boards has never seen has nothing to find). Users are keyed on the
 * OIDC subject; when the request carries only the email (no X-Auth-Request-User), the one person
 * with that email is used.
 */
export async function searchUser(): Promise<User | null> {
  const h = await headers();
  const opts = { ...optionsFromEnv(), devUser: "" };
  if (!cameThroughGateway(h, opts.proxySecret)) return null;
  const who = identify(h, opts);
  if (!who) return null;
  const bySub = await db.query.users.findFirst({ where: eq(users.authSub, who.subject) });
  if (bySub) return bySub;
  if (who.subject !== who.email) return null;
  const byEmail = await db
    .select()
    .from(users)
    .where(and(sql`lower(${users.email}) = ${who.email}`, eq(users.isMind, false)))
    .limit(2);
  return byEmail.length === 1 ? byEmail[0] : null;
}

const iso = (d: unknown) => new Date(d as string).toISOString();
const SCAN = 50;

export async function searchBoards(userId: string, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const want = (k: string) => !s.kinds.length || s.kinds.includes(k);
  const boardIds = await visibleBoardIds(userId);
  const results: SearchResult[] = [];
  if (!boardIds.length) return { app: "planner", results };
  const limit = Math.min(s.limit, SCAN);
  const run = async (text: string, columns: string[]) => {
    const f = queryToSql(s.parsed, columns, 2);
    return (await pool.query(text.replace("$WHERE", () => f.sql), [boardIds, ...f.params])).rows;
  };

  if (want("plan")) {
    const rows = await run(
      `SELECT b.id, b.title, b.description, b.created_at, b.is_closed, u.name AS owner
         FROM boards b LEFT JOIN users u ON u.id = b.created_by
        WHERE b.id = ANY($1::uuid[]) AND $WHERE
        ORDER BY b.created_at DESC LIMIT ${limit}`,
      ["b.title", "b.description"],
    );
    for (const r of rows)
      results.push({
        id: `plan:${r.id}`, kind: "plan", title: r.is_closed ? `${r.title} (closed)` : r.title,
        snippet: snippet(r.description || r.title, s.parsed), date: iso(r.created_at), url: `/b/${r.id}`,
        ...(r.owner ? { person: r.owner } : {}),
        ...(s.text ? { text: clipText(`${r.title}\n${r.description ?? ""}`) } : {}),
      });
  }

  if (want("task")) {
    const rows = await run(
      `SELECT c.id, c.board_id, c.title, c.description, c.issue_key, c.updated_at, b.title AS board, u.name AS assignee
         FROM cards c JOIN boards b ON b.id = c.board_id LEFT JOIN users u ON u.id = c.assignee_id
        WHERE c.board_id = ANY($1::uuid[]) AND NOT c.is_archived AND $WHERE
        ORDER BY c.updated_at DESC LIMIT ${limit}`,
      ["c.title", "c.description", "c.issue_key"],
    );
    for (const r of rows)
      results.push({
        id: `task:${r.id}`, kind: "task",
        title: `${r.issue_key ? `${r.issue_key} ` : ""}${r.title} · ${r.board}`,
        snippet: snippet(r.description || r.title, s.parsed), date: iso(r.updated_at),
        url: `/b/${r.board_id}?card=${r.id}`, ...(r.assignee ? { person: r.assignee } : {}),
        ...(s.text ? { text: clipText(`${r.title}\n${r.description ?? ""}`) } : {}),
      });
  }

  if (want("comment")) {
    const rows = await run(
      `SELECT m.id, m.body, coalesce(m.edited_at, m.created_at) AS at, c.id AS card_id, c.board_id, c.title AS card, u.name AS author
         FROM comments m JOIN cards c ON c.id = m.card_id LEFT JOIN users u ON u.id = m.user_id
        WHERE c.board_id = ANY($1::uuid[]) AND NOT c.is_archived AND $WHERE
        ORDER BY at DESC LIMIT ${limit}`,
      ["m.body"],
    );
    for (const r of rows)
      results.push({
        id: `comment:${r.id}`, kind: "comment", title: `Comment on ${r.card}`,
        snippet: snippet(r.body, s.parsed), date: iso(r.at), url: `/b/${r.board_id}?card=${r.card_id}`,
        ...(r.author ? { person: r.author } : {}),
        ...(s.text ? { text: clipText(r.body) } : {}),
      });
  }

  results.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { app: "planner", results: results.slice(0, s.limit) };
}
