import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import type { Me } from "./api";
import { APP } from "./compliance";
import { q } from "./db";
import { CAN_VIEW } from "./videos";

/** What suite search can ask Stream for. */
export const KINDS = ["video"];

type Row = { id: string; title: string; description: string; transcript: string; summary: string; owner: string; created_at: Date };

/**
 * Suite search for one person: videos they can watch here (their own, shared with them, open to the
 * organization), by title, description, summary and transcript. Anything deleted under a hold is
 * left out, and so are videos only reachable through a link.
 */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  if (s.kinds.length && !s.kinds.includes("video")) return { app: APP, results: [] };
  const params: unknown[] = [me.email, s.limit];
  const words = queryToSql(s.parsed, ["v.title", "v.description", "v.summary", "v.transcript"], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `SELECT v.id, v.title, v.description, v.transcript, v.summary, v.owner, v.created_at
     FROM videos v
     WHERE ${CAN_VIEW} AND v.held_deleted_at IS NULL AND v.status <> 'failed' AND ${words.sql}
     ORDER BY v.created_at DESC, v.id
     LIMIT $2`,
    params,
  );
  const results = rows.map((r): SearchResult => {
    const body = [r.description, r.summary, r.transcript].filter(Boolean).join(" ");
    return {
      id: r.id,
      kind: "video",
      title: r.title,
      snippet: body ? snippet(body, s.parsed) : "Video",
      date: r.created_at.toISOString(),
      url: `/watch/${r.id}`,
      person: r.owner,
      ...(s.text ? { text: clipText([r.title, r.description, r.summary, r.transcript && `Transcript: ${r.transcript}`].filter(Boolean).join("\n")) } : {}),
    };
  });
  return { app: APP, results };
}
