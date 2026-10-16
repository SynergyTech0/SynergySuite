import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import type { Me } from "./api";
import { APP } from "./compliance";
import { q } from "./db";
import { MINE } from "./diagrams";

/** What suite search can ask Diagrams for. */
export const KINDS = ["diagram"];

type Row = { id: string; name: string; text_content: string; owner: string; modified_at: Date };

/**
 * Suite search for one person: diagrams they own or that are shared with them (the app's own MINE
 * rule), by name and by the words on their shapes and pages. Anything deleted under a hold is left out.
 */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  if (s.kinds.length && !s.kinds.includes("diagram")) return { app: APP, results: [] };
  const params: unknown[] = [me.email, s.limit];
  const words = queryToSql(s.parsed, ["d.name", "d.text_content"], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `SELECT d.id, d.name, d.text_content, d.owner, d.modified_at
     FROM diagrams d
     WHERE d.id IN ${MINE} AND ${words.sql}
     ORDER BY d.modified_at DESC, d.id
     LIMIT $2`,
    params,
  );
  const results = rows.map((r): SearchResult => {
    const body = r.text_content.replace(/\n/g, " · ");
    return {
      id: r.id,
      kind: "diagram",
      title: r.name,
      snippet: body ? snippet(body, s.parsed) : "",
      date: r.modified_at.toISOString(),
      url: `/d/${r.id}`,
      person: r.owner,
      ...(s.text ? { text: clipText([r.name, r.text_content].filter(Boolean).join("\n")) } : {}),
    };
  });
  return { app: APP, results };
}
