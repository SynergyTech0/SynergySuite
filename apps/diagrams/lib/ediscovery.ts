import { MAX_ATTACHMENT_BYTES, type ExportItem, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import { APP, type Search, nextCursor, snippet } from "./compliance";

/** Diagrams' one kind of content for the Admin center: diagrams, with their words and the file itself. */
export const KINDS = ["diagram"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everyone else on a diagram: the people it's shared with and whoever saved it last. */
const PEOPLE = `ARRAY(SELECT DISTINCT e FROM unnest(
  ARRAY(SELECT m.email FROM diagram_members m WHERE m.diagram_id = d.id) || ARRAY[d.modified_by]
) e WHERE e IS NOT NULL AND e <> d.owner ORDER BY e)`;

type Row = {
  id: string; name: string; owner: string; participants: string[]; text_content: string; xml_bytes: number;
  modified_at: Date; held_deleted_at: Date | null; total: string;
};

function hit(r: Row, s: Pick<Search, "query">): SearchHit {
  return {
    id: r.id,
    kind: "diagram",
    title: r.name,
    owner: r.owner,
    ...(r.participants.length ? { participants: r.participants } : {}),
    date: r.modified_at.toISOString(),
    snippet: snippet(r.text_content.replace(/\n/g, " · ") || r.name, s.query),
    size: Number(r.xml_bytes),
    ...(r.held_deleted_at ? { deleted: true } : {}),
  };
}

const SELECT = `SELECT d.id, d.name, d.owner, ${PEOPLE} AS participants, d.text_content, octet_length(d.xml) AS xml_bytes,
  d.modified_at, d.held_deleted_at`;

/** Diagrams matching an eDiscovery search, deleted-under-hold ones included, newest first. */
export async function search(s: Search): Promise<SearchResponse> {
  if (s.kinds && !s.kinds.includes("diagram")) return { app: APP, hits: [], total: 0 };
  const params: unknown[] = [s.custodians, s.from, s.until, s.limit, s.offset];
  const words = queryToSql(s.query, ["d.name", "d.text_content"], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `${SELECT}, COUNT(*) OVER () AS total
     FROM diagrams d
     WHERE ${words.sql}
       AND (cardinality($1::text[]) = 0 OR d.owner = ANY($1) OR ${PEOPLE} && $1::text[])
       AND ($2::timestamptz IS NULL OR d.modified_at >= $2)
       AND ($3::timestamptz IS NULL OR d.modified_at < $3)
     ORDER BY d.modified_at DESC, d.id
     LIMIT $4 OFFSET $5`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

/** The diagram itself, as a file draw.io (and Synergy Diagrams) opens. */
function drawioFile(name: string, xml: string): NonNullable<ExportItem["attachments"]>[number] {
  const bytes = Buffer.from(xml);
  const file = { name: `${name.replace(/[\\/:*?"<>|]+/g, "_")}.drawio`, type: "application/vnd.jgraph.mxfile", size: bytes.length };
  return bytes.length > MAX_ATTACHMENT_BYTES
    ? { ...file, skipped: `Larger than ${Math.round(MAX_ATTACHMENT_BYTES / 1048576)} MB` }
    : { ...file, base64: bytes.toString("base64") };
}

/** Each diagram in full: its words, who has it, its earlier versions, and the .drawio file. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter((i) => UUID.test(i));
  if (!wanted.length) return { items: [] };
  const rows = await q<Row & {
    xml: string; pages: number; created_at: Date; modified_by: string;
    members: { email: string; role: string }[] | null;
    versions: { version: number; name: string; savedBy: string; savedAt: string }[] | null;
  }>(
    `${SELECT}, 0 AS total, d.xml, d.pages, d.created_at, d.modified_by,
       (SELECT json_agg(json_build_object('email', m.email, 'role', m.role) ORDER BY m.added_at) FROM diagram_members m WHERE m.diagram_id = d.id) AS members,
       (SELECT json_agg(json_build_object('version', v.version, 'name', v.name, 'savedBy', v.saved_by, 'savedAt', v.saved_at) ORDER BY v.saved_at DESC)
          FROM diagram_versions v WHERE v.diagram_id = d.id) AS versions
     FROM diagrams d WHERE d.id = ANY($1::uuid[])`,
    [wanted],
  );
  const items = rows.map((r): ExportItem => ({
    ...hit(r, { query: { groups: [], none: [] } }),
    app: APP,
    metadata: {
      pages: r.pages,
      createdAt: r.created_at.toISOString(),
      modifiedBy: r.modified_by,
      sharedWith: r.members ?? [],
      versions: r.versions ?? [],
      heldDeletedAt: r.held_deleted_at?.toISOString() ?? null,
    },
    text: [r.name, r.text_content].filter(Boolean).join("\n"),
    attachments: [drawioFile(r.name, r.xml)],
  }));
  items.sort((x, y) => wanted.indexOf(x.id) - wanted.indexOf(y.id));
  return { items };
}
