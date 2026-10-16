import { MAX_ATTACHMENT_BYTES, type ExportItem, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import * as blobs from "./blobs";
import { APP, type Search, nextCursor, snippet } from "./compliance";

/** Drive's one kind of content for the Admin center: files (folders are only where they sit). */
export const KINDS = ["file"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who each item is shared with, directly or through a folder above it. */
const INHERITED = `
  WITH RECURSIVE inherited AS (
    SELECT s.item_id AS id, s.email FROM shares s
    UNION
    SELECT c.id, t.email FROM items c JOIN inherited t ON c.parent_id = t.id
  )`;

type HitRow = {
  id: string;
  name: string;
  who: string;
  created_by: string;
  modified_by: string;
  modified_at: Date;
  size: string;
  text: string | null;
  held_deleted_at: Date | null;
  shared_with: string[];
  total: string;
};

function hit(r: HitRow, s: Pick<Search, "query">): SearchHit {
  const participants = [...new Set([...r.shared_with, r.created_by, r.modified_by])].filter((e) => e && e !== r.who).sort();
  return {
    id: r.id,
    kind: "file",
    title: r.name,
    owner: r.who,
    ...(participants.length ? { participants } : {}),
    date: r.modified_at.toISOString(),
    snippet: snippet(r.text ?? r.name, s.query),
    size: Number(r.size),
    ...(r.held_deleted_at ? { deleted: true } : {}),
  };
}

/** Files matching an eDiscovery search, deleted-under-hold ones included, newest first. */
export async function search(s: Search): Promise<SearchResponse> {
  if (s.kinds && !s.kinds.includes("file")) return { app: APP, hits: [], total: 0 };
  const params: unknown[] = [s.custodians, s.from, s.until, s.limit, s.offset];
  const words = queryToSql(s.query, ["i.name", "i.text"], params.length + 1);
  params.push(...words.params);
  const rows = await q<HitRow>(
    `${INHERITED}
     SELECT i.id, i.name, COALESCE(NULLIF(i.owner, ''), i.created_by) AS who, i.created_by, i.modified_by, i.modified_at,
       i.size, i.text, i.held_deleted_at,
       ARRAY(SELECT DISTINCT h.email FROM inherited h WHERE h.id = i.id) AS shared_with,
       COUNT(*) OVER () AS total
     FROM items i
     WHERE i.kind = 'file' AND ${words.sql}
       AND (cardinality($1::text[]) = 0 OR COALESCE(NULLIF(i.owner, ''), i.created_by) = ANY($1) OR i.created_by = ANY($1)
            OR i.modified_by = ANY($1) OR EXISTS (SELECT 1 FROM inherited h WHERE h.id = i.id AND h.email = ANY($1)))
       AND ($2::timestamptz IS NULL OR i.modified_at >= $2)
       AND ($3::timestamptz IS NULL OR i.modified_at < $3)
     ORDER BY i.modified_at DESC, i.id
     LIMIT $4 OFFSET $5`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

async function bytesOf(sha: string): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of blobs.read(sha)) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

/** Each file in full: its current content, where it sits, its versions and who it is shared with. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter((i) => UUID.test(i));
  if (!wanted.length) return { items: [] };
  const rows = await q<HitRow & { mime: string; sha256: string | null; version: number; created_at: Date; library_id: string | null;
    library: string | null; space: string; trashed_at: Date | null; trashed_by: string | null }>(
    `${INHERITED}
     SELECT i.*, COALESCE(NULLIF(i.owner, ''), i.created_by) AS who,
       ARRAY(SELECT DISTINCT h.email FROM inherited h WHERE h.id = i.id) AS shared_with,
       (SELECT name FROM libraries l WHERE l.id = i.library_id) AS library, 0 AS total
     FROM items i WHERE i.id = ANY($1) AND i.kind = 'file'`,
    [wanted],
  );
  const items: ExportItem[] = [];
  for (const r of rows) {
    const chain = await q<{ id: string; name: string }>(
      `WITH RECURSIVE up AS (
         SELECT id, parent_id, name, 0 AS depth FROM items WHERE id = $1
         UNION ALL
         SELECT p.id, p.parent_id, p.name, up.depth + 1 FROM items p JOIN up ON p.id = up.parent_id
       ) SELECT id, name FROM up WHERE depth > 0 ORDER BY depth DESC`,
      [r.id],
    );
    const versions = await q<{ n: number; size: string; sha256: string; created_by: string; created_at: Date; held_deleted_at: Date | null }>(
      "SELECT n, size, sha256, created_by, created_at, held_deleted_at FROM versions WHERE item_id = $1 ORDER BY n DESC",
      [r.id],
    );
    const shares = await q<{ email: string; role: string; shared_by: string; shared_at: Date; item_id: string }>(
      "SELECT email, role, shared_by, shared_at, item_id FROM shares WHERE item_id = ANY($1) ORDER BY shared_at",
      [[...chain.map((c) => c.id), r.id]],
    );
    const links = await q<{ created_by: string; created_at: Date; expires_at: Date | null }>(
      "SELECT created_by, created_at, expires_at FROM links WHERE item_id = ANY($1) ORDER BY created_at",
      [[...chain.map((c) => c.id), r.id]],
    );
    const size = Number(r.size);
    let attachment: ExportItem["attachments"] = [];
    if (r.sha256) {
      const base = { name: r.name, type: r.mime || "application/octet-stream", size };
      if (size > MAX_ATTACHMENT_BYTES) attachment = [{ ...base, skipped: `Larger than ${MAX_ATTACHMENT_BYTES} bytes` }];
      else if (!(await blobs.exists(r.sha256))) attachment = [{ ...base, skipped: "Content is missing from the store" }];
      else attachment = [{ ...base, base64: (await bytesOf(r.sha256)).toString("base64") }];
    }
    const names = new Map(chain.map((c) => [c.id, c.name]));
    items.push({
      ...hit(r, { query: { groups: [], none: [] } }),
      app: APP,
      metadata: {
        path: `/${[r.library ?? (r.library_id ? "Library" : "My files"), ...chain.map((c) => c.name)].join("/")}`,
        library: r.library,
        mime: r.mime,
        version: r.version,
        versions: versions.length,
        versionHistory: versions.map((v) => ({
          n: v.n,
          size: Number(v.size),
          sha256: v.sha256,
          createdBy: v.created_by,
          createdAt: v.created_at.toISOString(),
          ...(v.held_deleted_at ? { deleted: true } : {}),
        })),
        sha256: r.sha256,
        createdBy: r.created_by,
        createdAt: r.created_at.toISOString(),
        modifiedBy: r.modified_by,
        sharing: shares.map((s) => ({
          email: s.email,
          role: s.role,
          sharedBy: s.shared_by,
          sharedAt: s.shared_at.toISOString(),
          ...(s.item_id !== r.id ? { inheritedFrom: names.get(s.item_id) } : {}),
        })),
        links: links.map((l) => ({ createdBy: l.created_by, createdAt: l.created_at.toISOString(), expiresAt: l.expires_at?.toISOString() ?? null })),
        trashedAt: r.trashed_at?.toISOString() ?? null,
        trashedBy: r.trashed_by,
        heldDeletedAt: r.held_deleted_at?.toISOString() ?? null,
      },
      ...(r.text ? { text: r.text } : {}),
      attachments: attachment,
    });
  }
  items.sort((x, y) => wanted.indexOf(x.id) - wanted.indexOf(y.id));
  return { items };
}
