import { type SearchResult, type SearchResults, clipText, matchesQuery, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import type { Me } from "./api";
import { APP } from "./compliance";
import { q } from "./db";
import { people } from "./directory";
import { TEXT } from "./ediscovery";
import type { Labeled } from "./types";

/** What suite search can ask Contacts for: cards, from the person's own address book or the directory. */
export const KINDS = ["contact"];

type Row = { id: string; display: string; text: string; emails: Labeled[]; modified_at: Date };

/**
 * Suite search for one person: the cards in their own address book (not the ones deleted under
 * a hold) and the organization directory as the Directory view shows it to them.
 */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  if (s.kinds.length && !s.kinds.includes("contact")) return { app: APP, results: [] };

  const params: unknown[] = [me.email, s.limit];
  const words = queryToSql(s.parsed, [TEXT], params.length + 1);
  params.push(...words.params);
  const own = await q<Row>(
    `SELECT c.id, c.display, ${TEXT} AS text, c.emails, c.modified_at
     FROM contacts c
     WHERE c.owner = $1 AND c.held_deleted_at IS NULL AND ${words.sql}
     ORDER BY c.modified_at DESC, c.id
     LIMIT $2`,
    params,
  );
  const results: SearchResult[] = own.map((r) => ({
    id: r.id,
    kind: "contact",
    title: r.display,
    snippet: snippet(r.text, s.parsed),
    date: r.modified_at.toISOString(),
    url: `/?id=${r.id}`,
    ...(r.emails[0]?.value ? { person: r.emails[0].value } : {}),
    ...(s.text ? { text: clipText(r.text) } : {}),
  }));

  const { people: everyone } = await people("", me);
  const found = everyone
    .map((p) => ({ p, hay: [p.name, p.email, p.jobTitle, p.department, p.office, p.phone, p.mobile, p.manager, p.about].filter(Boolean).join(" ") }))
    .filter(({ hay }) => matchesQuery(hay, s.parsed));
  if (found.length) {
    const changed = new Map(
      (await q<{ email: string; updated_at: Date }>("SELECT email, updated_at FROM profiles WHERE email = ANY($1)", [found.map((f) => f.p.email)]))
        .map((r) => [r.email, r.updated_at]),
    );
    for (const { p, hay } of found) {
      results.push({
        id: `directory:${p.email}`,
        kind: "contact",
        title: p.name,
        snippet: snippet(hay, s.parsed),
        date: (changed.get(p.email) ?? new Date(0)).toISOString(),
        url: `/?person=${encodeURIComponent(p.email)}`,
        person: p.email,
        ...(s.text ? { text: clipText(hay) } : {}),
      });
    }
  }

  results.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { app: APP, results: results.slice(0, s.limit) };
}
