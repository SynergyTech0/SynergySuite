import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import type { Me } from "./api";
import { APP } from "./compliance";
import { q } from "./db";

/** What suite search can ask Bookings for. */
export const KINDS = ["appointment"];

const TEXT = ["a.customer_name", "a.customer_email", "a.service_name", "a.notes", "p.name", "a.answers::text"];

type Row = {
  id: string; customer_name: string; customer_email: string; service_name: string; notes: string; page_name: string;
  staff_email: string; status: string; start_at: Date;
};

/**
 * Suite search for one person: appointments on the booking pages they are on (the same rule
 * as the app itself), by customer, service, notes and answers.
 */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  if (s.kinds.length && !s.kinds.includes("appointment")) return { app: APP, results: [] };
  const params: unknown[] = [me.email, s.limit];
  const words = queryToSql(s.parsed, TEXT, params.length + 1);
  params.push(...words.params);
  const rows = await q<Row>(
    `SELECT a.id, a.customer_name, a.customer_email, a.service_name, a.notes, p.name AS page_name, a.staff_email, a.status, a.start_at
     FROM appointments a JOIN pages p ON p.id = a.page_id
     WHERE p.held_deleted_at IS NULL AND EXISTS (SELECT 1 FROM staff s WHERE s.page_id = a.page_id AND s.email = $1) AND ${words.sql}
     ORDER BY a.start_at DESC, a.id
     LIMIT $2`,
    params,
  );
  const results = rows.map((r): SearchResult => {
    const line = `${r.service_name} on ${r.page_name}${r.status === "cancelled" ? " (cancelled)" : ""}`;
    return {
      id: r.id,
      kind: "appointment",
      title: `${r.customer_name}: ${r.service_name}`,
      snippet: r.notes ? snippet(r.notes, s.parsed) : line,
      date: r.start_at.toISOString(),
      url: `/?appointment=${r.id}`,
      person: r.staff_email,
      ...(s.text ? { text: clipText([line, `Customer: ${r.customer_name} <${r.customer_email}>`, r.notes].filter(Boolean).join("\n")) } : {}),
    };
  });
  return { app: APP, results };
}
