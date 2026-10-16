import { type ExportItem, type SearchHit, type SearchResponse, queryToSql } from "@synergy/compliance";
import { q } from "./db";
import { APP, type Search, nextCursor, snippet } from "./compliance";

/**
 * Commerce's per-person content for the Admin center: orders (the customer and the cashier are
 * the people on them) and purchase orders (whoever raised them). Products are catalog data, not
 * anyone's content.
 */
export const KINDS = ["order", "purchase_order"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ORDER_TEXT = `COALESCE((SELECT string_agg(l.name || ' ' || l.sku, ' ' ORDER BY l.position) FROM order_lines l WHERE l.order_id = o.id), '')`;
const PO_TEXT = `COALESCE((SELECT string_agg(p.name || ' ' || p.sku, ' ' ORDER BY pl.position) FROM po_lines pl JOIN products p ON p.id = pl.product_id WHERE pl.po_id = o.id), '')`;

type Row = {
  kind: "order" | "purchase_order"; id: string; title: string; owner: string; participants: string[]; body: string; modified_at: Date; total: string;
};

/** One query over both kinds so paging and the total are right across them. */
function unionSql(s: Search, params: unknown[]): string {
  const parts: string[] = [];
  const want = (k: string) => !s.kinds || s.kinds.includes(k);
  if (want("order")) {
    const w = queryToSql(s.query, ["o.number", "o.customer_name", "o.customer_email", "o.notes", ORDER_TEXT], params.length + 1);
    params.push(...w.params);
    parts.push(`SELECT 'order' AS kind, o.id::text, 'Order ' || o.number || CASE WHEN o.customer_name <> '' THEN ' for ' || o.customer_name ELSE '' END AS title,
        COALESCE(NULLIF(lower(o.customer_email), ''), o.cashier, '') AS owner,
        ARRAY(SELECT e FROM unnest(ARRAY[o.cashier, NULLIF(lower(o.customer_email), '')]) e WHERE e IS NOT NULL
              AND e <> COALESCE(NULLIF(lower(o.customer_email), ''), o.cashier, '')) AS participants,
        o.notes || ' ' || ${ORDER_TEXT} AS body, o.modified_at
      FROM orders o
      WHERE ${w.sql}
        AND (cardinality($1::text[]) = 0 OR lower(o.customer_email) = ANY($1) OR o.cashier = ANY($1))
        AND ($2::timestamptz IS NULL OR o.modified_at >= $2) AND ($3::timestamptz IS NULL OR o.modified_at < $3)`);
  }
  if (want("purchase_order")) {
    const w = queryToSql(s.query, ["o.number", "v.name", "o.notes", PO_TEXT], params.length + 1);
    params.push(...w.params);
    parts.push(`SELECT 'purchase_order' AS kind, o.id::text, 'Purchase order ' || o.number || ' to ' || v.name AS title, o.created_by AS owner,
        ARRAY[]::text[] AS participants, o.notes || ' ' || ${PO_TEXT} AS body, o.modified_at
      FROM purchase_orders o JOIN vendors v ON v.id = o.vendor_id
      WHERE ${w.sql}
        AND (cardinality($1::text[]) = 0 OR o.created_by = ANY($1))
        AND ($2::timestamptz IS NULL OR o.modified_at >= $2) AND ($3::timestamptz IS NULL OR o.modified_at < $3)`);
  }
  return parts.join(" UNION ALL ");
}

function hit(r: Row, s: Pick<Search, "query">): SearchHit {
  return {
    id: `${r.kind}:${r.id}`,
    kind: r.kind,
    title: r.title,
    owner: r.owner,
    ...(r.participants.length ? { participants: r.participants } : {}),
    date: r.modified_at.toISOString(),
    snippet: snippet(r.body, s.query),
    size: Buffer.byteLength(`${r.title} ${r.body}`),
  };
}

export async function search(s: Search): Promise<SearchResponse> {
  const params: unknown[] = [s.custodians, s.from, s.until];
  const union = unionSql(s, params);
  if (!union) return { app: APP, hits: [], total: 0 };
  params.push(s.limit, s.offset);
  const rows = await q<Row>(
    `SELECT *, COUNT(*) OVER () AS total FROM (${union}) x ORDER BY modified_at DESC, id LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  return { app: APP, hits: rows.map((r) => hit(r, s)), total, nextCursor: nextCursor(s, s.offset + rows.length < total) };
}

/** Each record in full: every line, payment and refund of an order; every line and delivery of a purchase order. */
export async function exportItems(ids: string[]): Promise<{ items: ExportItem[] }> {
  const orderIds = ids.filter((i) => i.startsWith("order:")).map((i) => i.slice(6)).filter((i) => UUID.test(i));
  const poIds = ids.filter((i) => i.startsWith("purchase_order:")).map((i) => i.slice(15)).filter((i) => UUID.test(i));
  const items: ExportItem[] = [];
  if (orderIds.length) {
    const rows = await q<Record<string, unknown> & { id: string; number: string; customer_name: string; customer_email: string; cashier: string | null; notes: string; modified_at: Date; lines: { sku: string; name: string; qty: string; total: string }[] | null; payments: unknown; refunds: unknown }>(
      `SELECT o.*,
         (SELECT json_agg(json_build_object('sku', sku, 'name', name, 'qty', qty, 'unitPrice', unit_price, 'discount', discount, 'tax', tax, 'total', total, 'refunded', refunded) ORDER BY position) FROM order_lines WHERE order_id = o.id) AS lines,
         (SELECT json_agg(json_build_object('method', method, 'amount', amount, 'ref', ref, 'at', at, 'by', by_email) ORDER BY at) FROM payments WHERE order_id = o.id) AS payments,
         (SELECT json_agg(json_build_object('seq', seq, 'amount', amount, 'method', method, 'restock', restock, 'reason', reason, 'by', by_email, 'at', at) ORDER BY seq) FROM refunds WHERE order_id = o.id) AS refunds
       FROM orders o WHERE o.id = ANY($1::uuid[])`,
      [orderIds],
    );
    for (const r of rows) {
      const lines = r.lines ?? [];
      const owner = (r.customer_email || r.cashier || "").toLowerCase();
      const body = lines.map((l) => `${Number(l.qty)} x ${l.name} (${l.sku}) ${l.total}`).join("\n");
      items.push({
        id: `order:${r.id}`, app: APP, kind: "order", title: `Order ${r.number}${r.customer_name ? ` for ${r.customer_name}` : ""}`, owner,
        ...(r.cashier && r.cashier !== owner ? { participants: [r.cashier] } : {}),
        date: r.modified_at.toISOString(), snippet: body.slice(0, 200), size: Buffer.byteLength(body),
        metadata: {
          number: r.number, channel: r.channel, status: r.status, fulfillment: r.fulfillment, delivery: r.delivery,
          customerName: r.customer_name, customerEmail: r.customer_email, customerPhone: r.customer_phone, shipAddress: r.ship_address,
          cashier: r.cashier, subtotal: r.subtotal, discount: r.discount, tax: r.tax, total: r.total, paid: r.paid, refunded: r.refunded,
          createdAt: (r.created_at as Date).toISOString(), lines, payments: r.payments ?? [], refunds: r.refunds ?? [], notes: r.notes,
        },
        text: [`Order ${r.number}`, body, r.notes].filter(Boolean).join("\n"),
      });
    }
  }
  if (poIds.length) {
    const rows = await q<{ id: string; number: string; vendor: string; status: string; notes: string; created_by: string; created_at: Date; modified_at: Date; expected: string | null; lines: { sku: string; name: string; qty: string; unitCost: string; received: string }[] | null; receipts: unknown }>(
      `SELECT o.id, o.number, v.name AS vendor, o.status, o.notes, o.created_by, o.created_at, o.modified_at, to_char(o.expected, 'YYYY-MM-DD') AS expected,
         (SELECT json_agg(json_build_object('sku', p.sku, 'name', p.name, 'qty', pl.qty, 'unitCost', pl.unit_cost, 'received', pl.received) ORDER BY pl.position)
            FROM po_lines pl JOIN products p ON p.id = pl.product_id WHERE pl.po_id = o.id) AS lines,
         (SELECT json_agg(json_build_object('seq', seq, 'vendorRef', vendor_ref, 'receivedBy', received_by, 'receivedAt', received_at) ORDER BY seq) FROM receipts WHERE po_id = o.id) AS receipts
       FROM purchase_orders o JOIN vendors v ON v.id = o.vendor_id WHERE o.id = ANY($1::uuid[])`,
      [poIds],
    );
    for (const r of rows) {
      const lines = r.lines ?? [];
      const body = lines.map((l) => `${Number(l.qty)} x ${l.name} (${l.sku}) at ${l.unitCost}`).join("\n");
      items.push({
        id: `purchase_order:${r.id}`, app: APP, kind: "purchase_order", title: `Purchase order ${r.number} to ${r.vendor}`, owner: r.created_by,
        date: r.modified_at.toISOString(), snippet: body.slice(0, 200), size: Buffer.byteLength(body),
        metadata: { number: r.number, vendor: r.vendor, status: r.status, expected: r.expected, createdAt: r.created_at.toISOString(), lines, receipts: r.receipts ?? [], notes: r.notes },
        text: [`Purchase order ${r.number} to ${r.vendor}`, body, r.notes].filter(Boolean).join("\n"),
      });
    }
  }
  items.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id));
  return { items };
}
