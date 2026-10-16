import { type SearchResult, type SearchResults, clipText, queryToSql, readSearchQuery, snippet } from "@synergy/search";
import { APP } from "./compliance";
import { q } from "./db";

/**
 * What suite search can ask Commerce for. Everyone who works in Commerce reads the whole catalog
 * and every order, as on its own pages, so results aren't narrowed by person.
 */
export const KINDS = ["product", "order", "purchase_order"];

type Row = { kind: string; id: string; title: string; body: string; url: string; person: string | null; modified_at: Date };

export async function searchAll(body: unknown): Promise<SearchResults> {
  const s = readSearchQuery(body);
  const want = (k: string) => !s.kinds.length || s.kinds.includes(k);
  const params: unknown[] = [s.limit];
  const parts: string[] = [];
  if (want("product")) {
    const w = queryToSql(s.parsed, ["p.name", "p.sku", "p.barcode", "p.category", "p.description"], params.length + 1);
    params.push(...w.params);
    parts.push(`SELECT 'product' AS kind, p.id::text, p.name || ' (' || p.sku || ')' AS title,
        concat_ws(' · ', NULLIF(p.category, ''), to_char(p.price, 'FM999999990.00'), NULLIF(p.description, '')) AS body,
        '/#/products/' || p.id AS url, NULL AS person, p.modified_at
      FROM products p WHERE p.active AND ${w.sql}`);
  }
  if (want("order")) {
    const w = queryToSql(s.parsed, ["o.number", "o.customer_name", "o.customer_email", "o.notes"], params.length + 1);
    params.push(...w.params);
    parts.push(`SELECT 'order' AS kind, o.id::text, 'Order ' || o.number || CASE WHEN o.customer_name <> '' THEN ' for ' || o.customer_name ELSE '' END AS title,
        concat_ws(' · ', o.status, to_char(o.total, 'FM999999990.00'), NULLIF(o.notes, '')) AS body,
        '/#/orders/' || o.id AS url, COALESCE(NULLIF(o.customer_email, ''), o.cashier) AS person, o.modified_at
      FROM orders o WHERE ${w.sql}`);
  }
  if (want("purchase_order")) {
    const w = queryToSql(s.parsed, ["o.number", "v.name", "o.notes"], params.length + 1);
    params.push(...w.params);
    parts.push(`SELECT 'purchase_order' AS kind, o.id::text, 'Purchase order ' || o.number || ' to ' || v.name AS title,
        concat_ws(' · ', o.status, NULLIF(o.notes, '')) AS body, '/#/purchasing/' || o.id AS url, o.created_by AS person, o.modified_at
      FROM purchase_orders o JOIN vendors v ON v.id = o.vendor_id WHERE ${w.sql}`);
  }
  if (!parts.length) return { app: APP, results: [] };
  const rows = await q<Row>(`SELECT * FROM (${parts.join(" UNION ALL ")}) x ORDER BY modified_at DESC, id LIMIT $1`, params);
  const results = rows.map((r): SearchResult => ({
    id: `${r.kind}:${r.id}`,
    kind: r.kind,
    title: r.title,
    snippet: snippet(r.body, s.parsed),
    date: r.modified_at.toISOString(),
    url: r.url,
    ...(r.person ? { person: r.person } : {}),
    ...(s.text ? { text: clipText(`${r.title}\n${r.body}`) } : {}),
  }));
  return { app: APP, results };
}
