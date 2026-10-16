import { type ExportItem, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import { APP, type Search, nextCursor, snippet } from "./compliance";
import { isUuid } from "./pages";

/**
 * Bookings' content for the Admin center: appointments. Each belongs to the staff member who
 * holds it; the customer, and whoever booked or cancelled it, are its other people.
 */
export const KINDS = ["appointment"];

const TEXT = ["a.customer_name", "a.customer_email", "a.service_name", "a.notes", "p.name", "a.answers::text", "a.cancel_reason"];

const PEOPLE = `ARRAY(SELECT DISTINCT e FROM unnest(ARRAY[a.customer_email, a.booked_by, a.cancelled_by]) e
  WHERE e IS NOT NULL AND e <> a.staff_email ORDER BY e)`;

type Row = {
  id: string; customer_name: string; customer_email: string; service_name: string; notes: string; page_name: string;
  staff_email: string; participants: string[]; start_at: Date; created_at: Date; page_held: Date | null; total: string;
  answers: { label: string; answer: string }[]; cancel_reason: string;
};

function hit(r: Row, s: Pick<Search, "query">): SearchHit {
  const body = [r.notes, ...r.answers.map((x) => `${x.label}: ${x.answer}`), r.cancel_reason].filter(Boolean).join(" ");
  return {
    id: r.id,
    kind: "appointment",
    title: `${r.service_name}: ${r.customer_name}`,
    owner: r.staff_email,
    ...(r.participants.length ? { participants: r.participants } : {}),
    date: r.created_at.toISOString(),
    snippet: snippet(body || `${r.service_name} on ${r.page_name}`, s.query),
    size: Buffer.byteLength(`${r.customer_name} ${r.customer_email} ${r.service_name} ${body}`),
    ...(r.page_held ? { deleted: true } : {}),
  };
}

const SELECT = `SELECT a.id, a.customer_name, a.customer_email, a.service_name, a.notes, a.answers, a.cancel_reason, p.name AS page_name,
  a.staff_email, ${PEOPLE} AS participants, a.start_at, a.created_at, p.held_deleted_at AS page_held`;

/** Appointments matching an eDiscovery search, those on pages deleted under a hold included. */
export async function search(s: Search): Promise<SearchResponse> {
  if (s.kinds && !s.kinds.includes("appointment")) return { app: APP, hits: [], total: 0 };
  const params: unknown[] = [s.custodians, s.from, s.until, s.limit, s.offset];
  const words = queryToSql(s.query, TEXT, params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `${SELECT}, COUNT(*) OVER () AS total
     FROM appointments a JOIN pages p ON p.id = a.page_id
     WHERE ${words.sql}
       AND (cardinality($1::text[]) = 0 OR a.staff_email = ANY($1) OR ${PEOPLE} && $1::text[])
       AND ($2::timestamptz IS NULL OR a.created_at >= $2)
       AND ($3::timestamptz IS NULL OR a.created_at < $3)
     ORDER BY a.created_at DESC, a.id
     LIMIT $4 OFFSET $5`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

/** Each appointment in full. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const wanted = ids.filter(isUuid);
  if (!wanted.length) return { items: [] };
  const rows = await q<Row & {
    page_id: string; customer_phone: string; end_at: Date; location: string; status: string; booked_by: string | null;
    cancelled_at: Date | null; cancelled_by: string | null; staff_name: string;
  }>(
    `${SELECT}, 0 AS total, a.page_id, a.customer_phone, a.end_at, a.location, a.status, a.booked_by, a.cancelled_at, a.cancelled_by, a.staff_name
     FROM appointments a JOIN pages p ON p.id = a.page_id WHERE a.id = ANY($1::uuid[])`,
    [wanted],
  );
  const items = rows.map((r): ExportItem => ({
    ...hit(r, { query: { groups: [], none: [] } }),
    app: APP,
    metadata: {
      page: r.page_name, pageId: r.page_id, service: r.service_name, staff: r.staff_email, staffName: r.staff_name,
      customer: { name: r.customer_name, email: r.customer_email, phone: r.customer_phone },
      start: r.start_at.toISOString(), end: r.end_at.toISOString(), location: r.location, status: r.status,
      bookedBy: r.booked_by ?? "customer", cancelledAt: r.cancelled_at?.toISOString() ?? null, cancelledBy: r.cancelled_by,
      cancelReason: r.cancel_reason, answers: r.answers, pageDeletedAt: r.page_held?.toISOString() ?? null,
    },
    text: [
      `${r.service_name} on ${r.page_name}`, `When: ${r.start_at.toISOString()} to ${r.end_at.toISOString()}`,
      `Customer: ${r.customer_name} <${r.customer_email}>${r.customer_phone ? ` ${r.customer_phone}` : ""}`,
      r.notes, ...r.answers.map((x) => `${x.label}: ${x.answer}`), r.cancel_reason ? `Cancelled: ${r.cancel_reason}` : "",
    ].filter(Boolean).join("\n"),
  }));
  items.sort((x, y) => wanted.indexOf(x.id) - wanted.indexOf(y.id));
  return { items };
}
