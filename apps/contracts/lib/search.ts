import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import type { Me } from "./api";
import { APP } from "./compliance";
import { visible } from "./contracts";
import { q } from "./db";

/** What suite search can ask Contracts for. */
export const KINDS = ["contract", "clause", "template"];

type ContractRow = { id: string; number: string; title: string; counterparty: string; type: string; status: string; body: string; modified_at: Date };

/**
 * Suite search for one person: the contracts they can see (by number, title, counterparty and
 * text), and the clause and template library, which everyone can read.
 */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const want = (k: string) => !s.kinds.length || s.kinds.includes(k);
  const results: SearchResult[] = [];
  if (want("contract")) {
    const params: unknown[] = [me.email, s.limit];
    const words = queryToSql(s.parsed, ["c.number", "c.title", "c.counterparty", "c.body"], params.length + 1);
    params.push(...words.params);
    const rows = await q<ContractRow>(
      `SELECT c.id, c.number, c.title, c.counterparty, c.type, c.status, c.body, c.modified_at FROM contracts c
       WHERE ${visible(me.email, 1)} AND c.held_deleted_at IS NULL AND ${words.sql} ORDER BY c.modified_at DESC, c.id LIMIT $2`,
      params,
    );
    for (const r of rows) {
      results.push({
        id: r.id,
        kind: "contract",
        title: `${r.number} ${r.title}`,
        snippet: r.body ? snippet(r.body, s.parsed) : [r.type, r.counterparty, r.status].filter(Boolean).join(" · "),
        date: r.modified_at.toISOString(),
        url: `/?contract=${r.id}`,
        ...(s.text ? { text: clipText([`${r.number} ${r.title}`, r.counterparty && `Counterparty: ${r.counterparty}`, `Status: ${r.status}`, r.body].filter(Boolean).join("\n")) } : {}),
      });
    }
  }
  if (want("clause")) {
    const params: unknown[] = [s.limit];
    const words = queryToSql(s.parsed, ["title", "category", "body", "guidance"], params.length + 1);
    params.push(...words.params);
    const rows = await q<{ id: string; title: string; category: string; body: string; modified_at: Date }>(
      `SELECT id, title, category, body, modified_at FROM clauses WHERE NOT archived AND ${words.sql} ORDER BY modified_at DESC, id LIMIT $1`,
      params,
    );
    for (const r of rows) {
      results.push({
        id: r.id,
        kind: "clause",
        title: r.title,
        snippet: snippet(r.body, s.parsed),
        date: r.modified_at.toISOString(),
        url: `/?library=clauses&clause=${r.id}`,
        ...(s.text ? { text: clipText(`${r.title} (${r.category})\n${r.body}`) } : {}),
      });
    }
  }
  if (want("template")) {
    const params: unknown[] = [s.limit];
    const words = queryToSql(s.parsed, ["name", "description", "body"], params.length + 1);
    params.push(...words.params);
    const rows = await q<{ id: string; name: string; description: string; body: string; modified_at: Date }>(
      `SELECT id, name, description, body, modified_at FROM templates WHERE NOT archived AND ${words.sql} ORDER BY modified_at DESC, id LIMIT $1`,
      params,
    );
    for (const r of rows) {
      results.push({
        id: r.id,
        kind: "template",
        title: r.name,
        snippet: r.description || snippet(r.body, s.parsed),
        date: r.modified_at.toISOString(),
        url: `/?library=templates&template=${r.id}`,
        ...(s.text ? { text: clipText(`${r.name}\n${r.description}\n${r.body}`) } : {}),
      });
    }
  }
  results.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return { app: APP, results: results.slice(0, s.limit) };
}
