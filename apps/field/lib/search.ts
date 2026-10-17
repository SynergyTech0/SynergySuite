import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import type { Me } from "./api";
import { APP } from "./compliance";
import { q } from "./db";
import { existingRole } from "./staff";
import { TECH_SEES } from "./workorders";

/** What suite search can ask Field Service for. */
export const KINDS = ["work_order", "customer", "asset"];

/**
 * Suite search for one person. People who aren't on the field service team get nothing.
 * Dispatchers find every work order, customer and asset; technicians find the work orders booked
 * to them and the customers and equipment on those jobs. Anything deleted under a hold is left out.
 */
export async function searchFor(me: Me, body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const role = await existingRole(me.email);
  if (!role) return { app: APP, results: [] };
  const want = (k: string) => !s.kinds.length || s.kinds.includes(k);
  const tech = role === "technician";
  // $1 is always the person; dispatchers see everything, so for them it only has to be referenced.
  const everyone = "$1::text <> ''";
  const results: SearchResult[] = [];
  if (want("work_order")) {
    const params: unknown[] = [me.email.toLowerCase(), s.limit];
    const words = queryToSql(s.parsed, ["w.number", "w.title", "w.description", "w.resolution", "w.address", "c.name"], params.length + 1);
    params.push(...words.params);
    const rows = await q<{ id: string; number: string; title: string; description: string; customer: string; status: string; modified_at: Date }>(
      `SELECT w.id, w.number, w.title, w.description, c.name AS customer, w.status, w.modified_at
       FROM work_orders w JOIN customers c ON c.id = w.customer_id
       WHERE w.held_deleted_at IS NULL AND ${tech ? TECH_SEES : everyone} AND ${words.sql}
       ORDER BY w.modified_at DESC, w.id LIMIT $2`,
      params,
    );
    for (const r of rows) {
      results.push({
        id: r.id,
        kind: "work_order",
        title: `${r.number} ${r.title}`,
        snippet: r.description ? snippet(r.description, s.parsed) : `${r.customer} · ${r.status.replace("_", " ")}`,
        date: r.modified_at.toISOString(),
        url: tech ? `/tech?job=${r.id}` : `/?job=${r.id}`,
        ...(s.text ? { text: clipText([`${r.number} ${r.title}`, `Customer: ${r.customer}`, r.description].filter(Boolean).join("\n")) } : {}),
      });
    }
  }
  // A technician sees a customer or asset only through a job booked to them.
  const techCustomers = `c.id IN (SELECT w.customer_id FROM work_orders w WHERE w.held_deleted_at IS NULL AND ${TECH_SEES})`;
  if (want("customer")) {
    const params: unknown[] = [me.email.toLowerCase(), s.limit];
    const words = queryToSql(s.parsed, ["c.name", "c.email", "c.address", "c.notes"], params.length + 1);
    params.push(...words.params);
    const rows = await q<{ id: string; name: string; address: string; email: string; modified_at: Date }>(
      `SELECT c.id, c.name, c.address, c.email, c.modified_at FROM customers c
       WHERE c.held_deleted_at IS NULL AND ${tech ? techCustomers : everyone} AND ${words.sql}
       ORDER BY c.modified_at DESC, c.id LIMIT $2`,
      params,
    );
    for (const r of rows) {
      results.push({
        id: r.id, kind: "customer", title: r.name, snippet: r.address || r.email, date: r.modified_at.toISOString(),
        url: tech ? `/tech` : `/?customer=${r.id}`,
        ...(s.text ? { text: clipText([r.name, r.email, r.address].filter(Boolean).join("\n")) } : {}),
      });
    }
  }
  if (want("asset")) {
    const params: unknown[] = [me.email.toLowerCase(), s.limit];
    const words = queryToSql(s.parsed, ["a.name", "a.make", "a.model", "a.serial", "COALESCE(a.ops_tag, '')"], params.length + 1);
    params.push(...words.params);
    const rows = await q<{ id: string; name: string; make: string; model: string; serial: string; customer_id: string; customer: string; modified_at: Date }>(
      `SELECT a.id, a.name, a.make, a.model, a.serial, a.customer_id, c.name AS customer, a.modified_at
       FROM assets a JOIN customers c ON c.id = a.customer_id
       WHERE a.held_deleted_at IS NULL AND c.held_deleted_at IS NULL AND ${tech ? techCustomers : everyone} AND ${words.sql}
       ORDER BY a.modified_at DESC, a.id LIMIT $2`,
      params,
    );
    for (const r of rows) {
      const what = [r.make, r.model, r.serial && `SN ${r.serial}`].filter(Boolean).join(" ");
      results.push({
        id: r.id, kind: "asset", title: r.name, snippet: [r.customer, what].filter(Boolean).join(" · "), date: r.modified_at.toISOString(),
        url: tech ? `/tech` : `/?customer=${r.customer_id}&asset=${r.id}`,
        ...(s.text ? { text: clipText([r.name, what, `Customer: ${r.customer}`].filter(Boolean).join("\n")) } : {}),
      });
    }
  }
  results.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return { app: APP, results: results.slice(0, s.limit) };
}
