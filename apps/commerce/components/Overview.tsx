"use client";
import type { Overview as Data } from "@/lib/overview";
import { formatDate, money, qty, useData } from "./client";
import type { AppCtx } from "./shared";

export function Overview({ app }: { app: AppCtx }) {
  const { data, error } = useData<Data>("/api/overview", [app.version]);
  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data) return <div className="page muted">Loading…</div>;
  const peak = Math.max(1, ...data.week.map((d) => Number(d.sales)));
  return (
    <div className="page">
      <div className="pagehead">
        <h1>{app.settings.storeName}</h1>
        <a className="btn" href="/pos">Open register</a>
      </div>
      {!app.books && (
        <div className="notice warn">
          Books isn&apos;t connected, so sales and deliveries are waiting to be posted. Set BOOKS_INTERNAL_URL and BOOKS_SVC_TOKEN.
        </div>
      )}
      {data.books.failed > 0 && (
        <div className="notice warn">
          {data.books.failed} {data.books.failed === 1 ? "entry" : "entries"} couldn&apos;t be posted to Books.
          <button className="btn small" onClick={() => app.go("accounting")}>See why</button>
        </div>
      )}
      <div className="stats">
        <div className="stat"><div className="k">Sales today</div><div className="v">{money(data.today.sales)}</div><div className="s">{data.today.orders} paid orders · {money(data.today.refunds)} refunded</div></div>
        <button className="stat linkstat" onClick={() => app.go("orders", null)}><div className="k">To fulfil</div><div className="v">{data.toFulfil}</div><div className="s">{data.awaitingPayment} awaiting payment</div></button>
        <button className="stat linkstat" onClick={() => app.go("reorder")}><div className="k">Low stock</div><div className="v">{data.lowStock}</div><div className="s">at or under reorder point</div></button>
        <div className="stat"><div className="k">Stock value</div><div className="v">{money(data.stockValue)}</div><div className="s">{data.openPurchaseOrders} purchase orders on the way</div></div>
      </div>
      <div className="cols">
        <section className="panel">
          <h3>Last 7 days</h3>
          <div className="bars">
            {data.week.map((d) => (
              <div className="bar" key={d.day}>
                <span>{formatDate(d.day)}</span>
                <span className="track"><span className="fill" style={{ width: `${(Number(d.sales) / peak) * 100}%` }} /></span>
                <span className="num">{money(d.sales)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <h3>Best sellers, 30 days</h3>
          {data.top.length === 0 ? (
            <p className="muted">No sales yet.</p>
          ) : (
            <table className="mini">
              <thead><tr><th>Product</th><th className="num">Sold</th><th className="num">Sales</th></tr></thead>
              <tbody>
                {data.top.map((t) => (
                  <tr key={t.sku}><td>{t.name} <span className="muted small">{t.sku}</span></td><td className="num">{qty(t.qty)}</td><td className="num">{money(t.sales)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
