import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import type { Me } from "./api";
import { APP } from "./compliance";
import { q } from "./db";
import { visible } from "./law";

/** What suite search can ask Law for. */
export const KINDS = ["matter", "client", "document"];

/**
 * Suite search for one person: the matters they are on (by number, name, client, court and case
 * number), the documents on those matters (by name and text), and the firm's clients by name.
 */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const want = (k: string) => !s.kinds.length || s.kinds.includes(k);
  const results: SearchResult[] = [];
  if (want("matter")) {
    const params: unknown[] = [me.email, s.limit];
    const words = queryToSql(s.parsed, ["m.number", "m.title", "c.name", "m.court", "m.case_number", "m.description"], params.length + 1);
    params.push(...words.params);
    const rows = await q<{ id: string; number: string; title: string; client: string; status: string; practice_area: string; description: string; modified_at: Date }>(
      `SELECT m.id, m.number, m.title, c.name AS client, m.status, m.practice_area, m.description, m.modified_at
       FROM matters m JOIN clients c ON c.id = m.client_id
       WHERE ${visible(me.email, 1)} AND m.held_deleted_at IS NULL AND ${words.sql} ORDER BY m.modified_at DESC, m.id LIMIT $2`,
      params,
    );
    for (const r of rows) {
      results.push({
        id: r.id,
        kind: "matter",
        title: `${r.number} ${r.title}`,
        snippet: [r.client, r.practice_area, r.status].filter(Boolean).join(" · "),
        date: r.modified_at.toISOString(),
        url: `/?matter=${r.id}`,
        ...(s.text ? { text: clipText([`${r.number} ${r.title}`, `Client: ${r.client}`, `Status: ${r.status}`, r.description].filter(Boolean).join("\n")) } : {}),
      });
    }
  }
  if (want("document")) {
    const params: unknown[] = [me.email, s.limit];
    const words = queryToSql(s.parsed, ["d.name", "d.text"], params.length + 1);
    params.push(...words.params);
    const rows = await q<{ id: string; name: string; text: string; matter_id: string; number: string; uploaded_at: Date }>(
      `SELECT d.id, d.name, d.text, d.matter_id, m.number, d.uploaded_at FROM documents d JOIN matters m ON m.id = d.matter_id
       WHERE ${visible(me.email, 1)} AND d.held_deleted_at IS NULL AND m.held_deleted_at IS NULL AND ${words.sql}
       ORDER BY d.uploaded_at DESC, d.id LIMIT $2`,
      params,
    );
    for (const r of rows) {
      results.push({
        id: r.id,
        kind: "document",
        title: `${r.name} (${r.number})`,
        snippet: snippet(r.text || r.name, s.parsed),
        date: r.uploaded_at.toISOString(),
        url: `/?matter=${r.matter_id}&tab=documents&doc=${r.id}`,
        ...(s.text ? { text: clipText(`${r.name}\n${r.text}`) } : {}),
      });
    }
  }
  if (want("client")) {
    const params: unknown[] = [s.limit];
    const words = queryToSql(s.parsed, ["name", "email", "array_to_string(aliases, ' ')"], params.length + 1);
    params.push(...words.params);
    const rows = await q<{ id: string; name: string; email: string; status: string; modified_at: Date }>(
      `SELECT id, name, email, status, modified_at FROM clients WHERE held_deleted_at IS NULL AND ${words.sql} ORDER BY modified_at DESC, id LIMIT $1`,
      params,
    );
    for (const r of rows) {
      results.push({
        id: r.id,
        kind: "client",
        title: r.name,
        snippet: [r.email, r.status].filter(Boolean).join(" · "),
        date: r.modified_at.toISOString(),
        url: `/?client=${r.id}`,
        ...(s.text ? { text: clipText(`${r.name}\n${r.email}`) } : {}),
      });
    }
  }
  results.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return { app: APP, results: results.slice(0, s.limit) };
}
