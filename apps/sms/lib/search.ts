import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import type { Me } from "./api";
import { q } from "./db";

/** What suite search can ask SMS for. */
export const KINDS = ["contact", "message"];

/** Suite search for one person on the SMS access list: contacts and texts, newest first. */
export async function searchFor(_me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const want = (k: string) => !s.kinds.length || s.kinds.includes(k);
  const results: SearchResult[] = [];
  if (want("contact")) {
    const params: unknown[] = [s.limit];
    const words = queryToSql(s.parsed, ["name", "phone", "array_to_string(tags, ' ')"], params.length + 1);
    params.push(...words.params);
    const rows = await q<{ id: string; phone: string; name: string; tags: string[]; opted_out: boolean; created_at: Date }>(
      `SELECT id::text, phone, name, tags, opted_out, created_at FROM contacts WHERE ${words.sql} ORDER BY created_at DESC, id LIMIT $1`,
      params,
    );
    for (const r of rows) {
      const about = [r.phone, r.tags.join(", "), r.opted_out ? "opted out" : ""].filter(Boolean).join(" · ");
      results.push({
        id: `contact:${r.id}`,
        kind: "contact",
        title: r.name || r.phone,
        snippet: about,
        date: r.created_at.toISOString(),
        url: `/?phone=${encodeURIComponent(r.phone)}`,
        ...(s.text ? { text: clipText(`${r.name || r.phone}\n${about}`) } : {}),
      });
    }
  }
  if (want("message")) {
    const params: unknown[] = [s.limit];
    const words = queryToSql(s.parsed, ["m.body", "m.phone", "coalesce(c.name, '')"], params.length + 1);
    params.push(...words.params);
    const rows = await q<{ id: string; phone: string; name: string | null; body: string; direction: string; sent_by: string; at: Date }>(
      `SELECT m.id::text, m.phone, c.name, m.body, m.direction, m.sent_by, m.at FROM messages m LEFT JOIN contacts c ON c.phone = m.phone
       WHERE m.status NOT IN ('pending', 'claimed') AND ${words.sql} ORDER BY m.at DESC, m.id DESC LIMIT $1`,
      params,
    );
    for (const r of rows) {
      const who = r.name || r.phone;
      results.push({
        id: `message:${r.id}`,
        kind: "message",
        title: r.direction === "in" ? `From ${who}` : `To ${who}`,
        snippet: snippet(r.body, s.parsed),
        date: r.at.toISOString(),
        url: `/?phone=${encodeURIComponent(r.phone)}`,
        ...(r.direction === "out" && r.sent_by ? { person: r.sent_by } : {}),
        ...(s.text ? { text: clipText(r.body) } : {}),
      });
    }
  }
  return { app: "sms", results };
}
