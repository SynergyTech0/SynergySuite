/** The back office's front page: today's takings, what needs doing, and how Books is keeping up. */
import { q } from "./db";
import { fromCents, toCents } from "./money";

export type Overview = {
  today: { sales: string; orders: number; refunds: string };
  week: { day: string; sales: string }[];
  toFulfil: number;
  awaitingPayment: number;
  lowStock: number;
  openPurchaseOrders: number;
  stockValue: string;
  books: { waiting: number; failed: number };
  top: { name: string; sku: string; qty: number; sales: string }[];
};

export async function overview(): Promise<Overview> {
  const [t] = await q<{ sales: string; orders: number; refunds: string }>(
    `SELECT COALESCE(sum(total) FILTER (WHERE paid_at >= date_trunc('day', now())), 0) AS sales,
       count(*) FILTER (WHERE paid_at >= date_trunc('day', now()))::int AS orders,
       COALESCE((SELECT sum(amount) FROM refunds WHERE at >= date_trunc('day', now())), 0) AS refunds
     FROM orders WHERE status <> 'cancelled'`,
  );
  const week = await q<{ day: string; sales: string }>(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day,
       COALESCE((SELECT sum(total) FROM orders WHERE status <> 'cancelled' AND paid_at >= d AND paid_at < d + interval '1 day'), 0) AS sales
     FROM generate_series(date_trunc('day', now()) - interval '6 days', date_trunc('day', now()), interval '1 day') d ORDER BY d`,
  );
  const [c] = await q<{ to_fulfil: number; awaiting: number; low: number; pos: number; value: string; waiting: number; failed: number }>(
    `SELECT
       (SELECT count(*)::int FROM orders WHERE channel = 'online' AND status NOT IN ('cancelled', 'refunded') AND fulfillment <> 'fulfilled') AS to_fulfil,
       (SELECT count(*)::int FROM orders WHERE status = 'pending') AS awaiting,
       (SELECT count(*)::int FROM products p WHERE p.active AND p.track_stock AND p.reorder_point > 0
          AND COALESCE((SELECT sum(on_hand) FROM stock WHERE product_id = p.id), 0) <= p.reorder_point) AS low,
       (SELECT count(*)::int FROM purchase_orders WHERE status IN ('ordered', 'partial')) AS pos,
       (SELECT COALESCE(sum(GREATEST(s.on_hand, 0) * p.cost), 0) FROM stock s JOIN products p ON p.id = s.product_id WHERE p.track_stock) AS value,
       (SELECT count(*)::int FROM postings WHERE status = 'pending') AS waiting,
       (SELECT count(*)::int FROM postings WHERE status = 'failed') AS failed`,
  );
  const top = await q<{ name: string; sku: string; qty: string; sales: string }>(
    `SELECT l.name, l.sku, sum(l.qty - l.refunded) AS qty, sum(l.total) AS sales
     FROM order_lines l JOIN orders o ON o.id = l.order_id
     WHERE o.status <> 'cancelled' AND o.paid_at >= now() - interval '30 days' AND l.product_id IS NOT NULL
     GROUP BY l.name, l.sku ORDER BY sum(l.total) DESC LIMIT 5`,
  );
  return {
    today: { sales: fromCents(toCents(t.sales)), orders: t.orders, refunds: fromCents(toCents(t.refunds)) },
    week: week.map((w) => ({ day: w.day, sales: fromCents(toCents(w.sales)) })),
    toFulfil: c.to_fulfil,
    awaitingPayment: c.awaiting,
    lowStock: c.low,
    openPurchaseOrders: c.pos,
    stockValue: fromCents(Math.round(Number(c.value) * 100)),
    books: { waiting: c.waiting, failed: c.failed },
    top: top.map((r) => ({ name: r.name, sku: r.sku, qty: Number(r.qty), sales: fromCents(toCents(r.sales)) })),
  };
}
