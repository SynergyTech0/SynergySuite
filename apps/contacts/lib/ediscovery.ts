import { MAX_ATTACHMENT_BYTES, type ExportItem, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import { APP, type Search, nextCursor, snippet } from "./compliance";
import type { Address, Labeled } from "./types";
import { toVCard } from "./vcard";

/** Contacts' one kind of content for the Admin center: the cards in people's address books. */
export const KINDS = ["contact"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a card says, as plain text, for keywords and snippets. */
export const TEXT = `concat_ws(' ', c.display, c.nickname, c.company, c.job_title, c.department,
  (SELECT string_agg(e->>'value', ' ') FROM jsonb_array_elements(c.emails) e),
  (SELECT string_agg(p->>'value', ' ') FROM jsonb_array_elements(c.phones) p),
  (SELECT string_agg(concat_ws(' ', a->>'street', a->>'city', a->>'region', a->>'postcode', a->>'country'), ' ') FROM jsonb_array_elements(c.addresses) a),
  (SELECT string_agg(w->>'value', ' ') FROM jsonb_array_elements(c.websites) w),
  c.notes)`;

type Row = {
  id: string; owner: string; display: string; text: string; modified_at: Date; held_deleted_at: Date | null; total: string;
};

function hit(r: Row, s: Pick<Search, "query">): SearchHit {
  return {
    id: r.id,
    kind: "contact",
    title: r.display,
    owner: r.owner,
    date: r.modified_at.toISOString(),
    snippet: snippet(r.text, s.query),
    size: Buffer.byteLength(r.text),
    ...(r.held_deleted_at ? { deleted: true } : {}),
  };
}

/** Contacts matching an eDiscovery search, deleted-under-hold ones included, newest first. */
export async function search(s: Search): Promise<SearchResponse> {
  if (s.kinds && !s.kinds.includes("contact")) return { app: APP, hits: [], total: 0 };
  const params: unknown[] = [s.custodians, s.from, s.until, s.limit, s.offset];
  const words = queryToSql(s.query, [TEXT], params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `SELECT c.id, c.owner, c.display, ${TEXT} AS text, c.modified_at, c.held_deleted_at, COUNT(*) OVER () AS total
     FROM contacts c
     WHERE ${words.sql}
       AND (cardinality($1::text[]) = 0 OR lower(c.owner) = ANY($1))
       AND ($2::timestamptz IS NULL OR c.modified_at >= $2)
       AND ($3::timestamptz IS NULL OR c.modified_at < $3)
     ORDER BY c.modified_at DESC, c.id
     LIMIT $4 OFFSET $5`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

/** Each card in full, as fields and as a vCard, with its photo. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter((i) => UUID.test(i));
  if (!wanted.length) return { items: [] };
  const rows = await q<Row & {
    first_name: string; middle_name: string; last_name: string; nickname: string; company: string; job_title: string;
    department: string; emails: Labeled[]; phones: Labeled[]; addresses: Address[]; websites: Labeled[]; birthday: string | null;
    notes: string; favorite: boolean; photo: Buffer | null; photo_mime: string | null; created_at: Date; group_names: string[] | null;
  }>(
    `SELECT c.*, ${TEXT} AS text, to_char(c.birthday, 'YYYY-MM-DD') AS birthday, 0 AS total,
       (SELECT array_agg(g.name ORDER BY lower(g.name)) FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE gm.contact_id = c.id) AS group_names
     FROM contacts c WHERE c.id = ANY($1::uuid[])`,
    [wanted],
  );
  const items = rows.map((r): ExportItem => {
    const card = {
      firstName: r.first_name, middleName: r.middle_name, lastName: r.last_name, nickname: r.nickname, company: r.company,
      jobTitle: r.job_title, department: r.department, emails: r.emails, phones: r.phones, addresses: r.addresses,
      websites: r.websites, birthday: r.birthday ?? "", notes: r.notes,
    };
    const vcard = toVCard({ ...card, displayName: r.display, groups: r.group_names ?? [], uid: r.id, modifiedAt: r.modified_at.toISOString() });
    const file = r.display.replace(/[^\w .-]+/g, "").trim() || "contact";
    const attachments: ExportItem["attachments"] = [
      { name: `${file}.vcf`, type: "text/vcard", size: Buffer.byteLength(vcard), base64: Buffer.from(vcard).toString("base64") },
    ];
    if (r.photo) {
      const photo = { name: `${file} photo`, type: r.photo_mime || "image/jpeg", size: r.photo.length };
      attachments.push(r.photo.length > MAX_ATTACHMENT_BYTES ? { ...photo, skipped: `Larger than ${MAX_ATTACHMENT_BYTES} bytes` } : { ...photo, base64: r.photo.toString("base64") });
    }
    return {
      ...hit(r, { query: { groups: [], none: [] } }),
      app: APP,
      metadata: {
        ...card,
        groups: r.group_names ?? [],
        favorite: r.favorite,
        createdAt: r.created_at.toISOString(),
        modifiedAt: r.modified_at.toISOString(),
        heldDeletedAt: r.held_deleted_at?.toISOString() ?? null,
      },
      text: r.text,
      attachments,
    };
  });
  items.sort((x, y) => wanted.indexOf(x.id) - wanted.indexOf(y.id));
  return { items };
}
