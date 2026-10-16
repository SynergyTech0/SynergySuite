import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import type { Me } from "./api";
import { APP } from "./compliance";
import { q } from "./db";
import { VISIBLE_COMMUNITIES, VISIBLE_POST } from "./engage";

/** What suite search can ask Engage for. */
export const KINDS = ["post", "community"];

/** A post's replies as one line of text, without any deleted under a hold. */
const REPLIES = `COALESCE((SELECT string_agg(cm.body, ' ' ORDER BY cm.created_at) FROM comments cm
  WHERE cm.post_id = p.id AND cm.held_deleted_at IS NULL), '')`;

type PostRow = { id: string; title: string; body: string; replies: string; author: string; community: string | null; activity_at: Date };
type CommunityRow = { id: string; slug: string; name: string; description: string; created_by: string; created_at: Date };

/**
 * Suite search for one person: posts they can see (storylines, public communities and private ones
 * they belong to) by title, text, replies and topics, and communities they can see by name.
 */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const want = (k: string) => !s.kinds.length || s.kinds.includes(k);
  const results: SearchResult[] = [];
  if (want("post")) {
    const params: unknown[] = [me.email, s.limit];
    const words = queryToSql(s.parsed, ["p.title", "p.body", REPLIES, "array_to_string(p.topics, ' ')"], params.length + 1);
    params.push(...words.params);
    const rows = await q<PostRow>(
      `SELECT p.id, p.title, p.body, ${REPLIES} AS replies, p.author, c.name AS community, p.activity_at
       FROM posts p LEFT JOIN communities c ON c.id = p.community_id
       WHERE ${VISIBLE_POST} AND ${words.sql}
       ORDER BY p.activity_at DESC, p.id LIMIT $2`,
      params,
    );
    for (const r of rows) {
      const all = [r.body, r.replies].filter(Boolean).join(" ");
      const first = r.body.split("\n")[0].slice(0, 120);
      results.push({
        id: r.id,
        kind: "post",
        title: r.title || first || "Post",
        snippet: snippet(all, s.parsed) || (r.community ?? ""),
        date: r.activity_at.toISOString(),
        url: `/posts/${r.id}`,
        person: r.author,
        ...(s.text ? { text: clipText([r.title, r.body, r.replies && `Replies: ${r.replies}`, r.community && `Community: ${r.community}`].filter(Boolean).join("\n")) } : {}),
      });
    }
  }
  if (want("community")) {
    const params: unknown[] = [me.email, s.limit];
    const words = queryToSql(s.parsed, ["c.name", "c.description"], params.length + 1);
    params.push(...words.params);
    const rows = await q<CommunityRow>(
      `SELECT c.id, c.slug, c.name, c.description, c.created_by, c.created_at FROM communities c
       WHERE c.id IN ${VISIBLE_COMMUNITIES} AND ${words.sql} ORDER BY lower(c.name) LIMIT $2`,
      params,
    );
    for (const r of rows) {
      results.push({
        id: r.id,
        kind: "community",
        title: r.name,
        snippet: snippet(r.description, s.parsed),
        date: r.created_at.toISOString(),
        url: `/c/${r.slug}`,
        ...(r.created_by !== "system" ? { person: r.created_by } : {}),
        ...(s.text ? { text: clipText(`${r.name}\n${r.description}`) } : {}),
      });
    }
  }
  results.sort((a, b) => b.date.localeCompare(a.date));
  return { app: APP, results: results.slice(0, s.limit) };
}
