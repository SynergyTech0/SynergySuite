import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, Package, Truck, XCircle } from "lucide-react";
import { orderByToken } from "@/lib/sales";
import { getSettings } from "@/lib/settings";
import type { Order } from "@/lib/types";
import { moneyFormatter } from "@/components/store/format";

export const dynamic = "force-dynamic";

// Anyone with the link can see the order, so keep it out of search engines.
export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function statusText(o: Order): { label: string; tone: "wait" | "ok" | "bad" } {
  switch (o.status) {
    case "pending":
      return { label: "Awaiting payment", tone: "wait" };
    case "paid":
      return { label: "Paid", tone: "ok" };
    case "cancelled":
      return { label: "Cancelled", tone: "bad" };
    case "refunded":
      return { label: "Refunded", tone: "bad" };
    case "partially_refunded":
      return { label: "Partly refunded", tone: "ok" };
  }
}

function fulfillmentText(o: Order): string {
  if (o.fulfillment === "fulfilled") return o.delivery === "ship" ? "Shipped" : "Picked up";
  if (o.fulfillment === "ready") return o.delivery === "ship" ? "Ready to ship" : "Ready for pickup";
  return "Being prepared";
}

export default async function OrderPage({ params, searchParams }: Props) {
  const { token } = await params;
  const sp = await searchParams;
  const o = await orderByToken(token);
  if (!o) notFound();
  const s = await getSettings();
  const money = moneyFormatter(s.currency);
  const st = statusText(o);
  const cancelledPayment = sp.cancelled === "1" && o.status === "pending";
  const payWhen = o.delivery === "ship" ? "on delivery" : "when you pick up";
  const placed = new Date(o.createdAt);
  const n = (v: string) => Number(v) || 0;
  const StatusIcon = st.tone === "ok" ? CheckCircle2 : st.tone === "bad" ? XCircle : Clock;

  return (
    <div className="shop-order">
      <div className="shop-order-head">
        <p className="shop-muted shop-small">Order</p>
        <h1>{o.number}</h1>
        <p className="shop-muted">
          Placed {Number.isNaN(placed.getTime()) ? "" : placed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          {o.customerName ? ` by ${o.customerName}` : ""}
        </p>
      </div>

      {cancelledPayment && (
        <div className="shop-notice" role="status">
          <p>
            <strong>Payment was not completed.</strong>{" "}
            {s.store.payLater
              ? `Your order is saved and you can pay ${payWhen}.`
              : "Your order is saved but not yet paid. Please contact us to arrange payment."}
          </p>
        </div>
      )}

      <div className="shop-order-status">
        <div className={`shop-status shop-status-${st.tone}`}>
          <StatusIcon size={22} aria-hidden />
          <div>
            <strong>{st.label}</strong>
            {o.status === "pending" && !cancelledPayment && s.store.payLater && (
              <span className="shop-small">Pay {payWhen}.</span>
            )}
          </div>
        </div>
        {o.status !== "cancelled" && (
          <div className="shop-status shop-status-neutral">
            {o.delivery === "ship" ? <Truck size={22} aria-hidden /> : <Package size={22} aria-hidden />}
            <div>
              <strong>{fulfillmentText(o)}</strong>
              <span className="shop-small">{o.delivery === "ship" ? "Delivery" : "Pickup in store"}</span>
            </div>
          </div>
        )}
      </div>

      <section className="shop-panel">
        <h2>Items</h2>
        <ul className="shop-order-lines">
          {o.lines.map((l) => (
            <li key={l.id}>
              <span className="shop-order-line-name">
                {l.sku === "DELIVERY" ? "Delivery" : l.name}
                {l.sku !== "DELIVERY" && <span className="shop-muted shop-small"> × {l.qty}</span>}
                {l.refunded > 0 && <span className="shop-muted shop-small"> ({l.refunded} refunded)</span>}
              </span>
              <span>{money(l.total)}</span>
            </li>
          ))}
        </ul>
        <dl className="shop-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{money(o.subtotal)}</dd>
          </div>
          {n(o.discount) > 0 && (
            <div>
              <dt>Discount</dt>
              <dd>-{money(o.discount)}</dd>
            </div>
          )}
          <div>
            <dt>Tax</dt>
            <dd>{money(o.tax)}</dd>
          </div>
          <div className="shop-totals-grand">
            <dt>Total</dt>
            <dd>{money(o.total)}</dd>
          </div>
          {n(o.paid) > 0 && (
            <div>
              <dt>Paid</dt>
              <dd>{money(o.paid)}</dd>
            </div>
          )}
          {n(o.refunded) > 0 && (
            <div>
              <dt>Refunded</dt>
              <dd>{money(o.refunded)}</dd>
            </div>
          )}
        </dl>
      </section>

      {o.delivery === "ship" && o.shipAddress && (
        <section className="shop-panel">
          <h2>Delivering to</h2>
          <p className="shop-pre">{o.shipAddress}</p>
        </section>
      )}
      {o.notes && (
        <section className="shop-panel">
          <h2>Your notes</h2>
          <p className="shop-pre">{o.notes}</p>
        </section>
      )}

      <p className="shop-muted shop-small">
        Keep this page&apos;s link to check on your order.
      </p>
      <p>
        <Link href="/store" className="shop-btn">
          Back to the store
        </Link>
      </p>
    </div>
  );
}
