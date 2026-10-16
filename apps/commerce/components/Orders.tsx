"use client";
import { ArrowLeft, Ban, CheckCircle2, CreditCard, PackageOpen, Printer, RotateCcw, Search } from "lucide-react";
import { useState } from "react";
import type { OrderSummary } from "@/lib/sales";
import type { Order, Settings } from "@/lib/types";
import { api, formData, formatDateTime, money, qty, useData } from "./client";
import { Confirm, Modal } from "./Modal";
import { Badge, ErrorLine, label, type AppCtx } from "./shared";

export function Orders({ app, id }: { app: AppCtx; id: string | null }) {
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [term, setTerm] = useState("");
  const list = useData<OrderSummary[]>(`/api/orders?channel=${channel}&status=${status}&q=${encodeURIComponent(term)}`, [app.version]);
  return (
    <div className={`split${id ? " withdetail" : ""}`}>
      <section className="listpane">
        <div className="listhead">
          <div className="titlerow"><h1 className="grow">Orders</h1></div>
          <div className="search">
            <Search size={15} />
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Number, name or email" aria-label="Search orders" />
          </div>
          <div className="filters">
            <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel">
              <option value="">All channels</option>
              <option value="pos">Point of sale</option>
              <option value="online">Online store</option>
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">Any status</option>
              <option value="open">Online, to fulfil</option>
              <option value="pending">Awaiting payment</option>
              <option value="paid">Paid</option>
              <option value="partially_refunded">Partly refunded</option>
              <option value="refunded">Refunded</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
        <div className="rlist">
          {list.data?.length === 0 && <div className="empty"><p>No orders here.</p></div>}
          {list.data?.map((o) => (
            <button key={o.id} className={`rrow${o.id === id ? " sel" : ""}`} onClick={() => app.go("orders", o.id)}>
              <span className="grow">
                <span className="rname">{o.number}{o.customerName ? ` · ${o.customerName}` : ""}</span>
                <span className="rsub">{label(o.channel)} · {formatDateTime(o.createdAt)} · {qty(o.items)} items</span>
              </span>
              <span className="rside">
                <strong>{money(o.total)}</strong>
                <span>
                  <Badge value={o.status} />
                  {o.channel === "online" && o.status !== "cancelled" && o.fulfillment !== "fulfilled" && <> <Badge value={o.fulfillment} /></>}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="detail">
        {id ? <OrderDetail key={`${id}-${app.version}`} app={app} id={id} /> : <div className="empty"><p>Pick an order.</p></div>}
      </section>
    </div>
  );
}

function OrderDetail({ app, id }: { app: AppCtx; id: string }) {
  const { data: o, error } = useData<Order>(`/api/orders/${id}`);
  const [dialog, setDialog] = useState<"pay" | "refund" | "cancel" | "receipt" | null>(null);
  const [err, setErr] = useState("");
  if (error) return <div className="card"><p className="error">{error}</p></div>;
  if (!o) return <div className="card muted">Loading…</div>;
  const fulfil = async (step: "ready" | "fulfilled") => {
    try {
      await api(`/api/orders/${o.id}/fulfil`, { method: "POST", json: { step } });
      app.say(step === "ready" ? "Marked ready" : o.delivery === "ship" ? "Marked shipped" : "Marked picked up");
      app.changed();
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  const refundable = app.manager && (o.status === "paid" || o.status === "partially_refunded");
  return (
    <div className="card">
      <div className="cardtools">
        <button className="iconbtn back" aria-label="Back" onClick={() => app.go("orders")}><ArrowLeft size={18} /></button>
        <span className="grow" />
        <button className="iconbtn" title="Receipt" aria-label="Receipt" onClick={() => setDialog("receipt")}><Printer size={16} /></button>
        {o.status === "pending" && <button className="btn primary small" onClick={() => setDialog("pay")}><CreditCard size={14} /> Take payment</button>}
        {o.channel === "online" && o.status !== "cancelled" && o.fulfillment === "unfulfilled" && (
          <button className="btn small" onClick={() => fulfil("ready")}><PackageOpen size={14} /> Ready</button>
        )}
        {o.channel === "online" && o.status !== "pending" && o.status !== "cancelled" && o.fulfillment !== "fulfilled" && (
          <button className="btn small" onClick={() => fulfil("fulfilled")}><CheckCircle2 size={14} /> {o.delivery === "ship" ? "Shipped" : "Picked up"}</button>
        )}
        {refundable && <button className="btn small" onClick={() => setDialog("refund")}><RotateCcw size={14} /> Refund</button>}
        {o.status === "pending" && <button className="btn small" onClick={() => setDialog("cancel")}><Ban size={14} /> Cancel</button>}
      </div>
      <div className="cardhead">
        <div className="grow">
          <div className="bigname">{o.number}</div>
          <p className="muted">{label(o.channel)} · {o.locationName} · {formatDateTime(o.createdAt)}</p>
        </div>
        <Badge value={o.status} />
        {o.channel === "online" && o.status !== "cancelled" && <Badge value={o.fulfillment} />}
      </div>
      <ErrorLine text={err} />
      <section className="panel">
        <dl className="facts">
          {o.customerName && <div><dt>Customer</dt><dd>{o.customerName}</dd></div>}
          {o.customerEmail && <div><dt>Email</dt><dd><a href={`mailto:${o.customerEmail}`}>{o.customerEmail}</a></dd></div>}
          {o.customerPhone && <div><dt>Phone</dt><dd>{o.customerPhone}</dd></div>}
          <div><dt>Delivery</dt><dd>{label(o.delivery)}</dd></div>
          {o.shipAddress && <div><dt>Ship to</dt><dd className="pre">{o.shipAddress}</dd></div>}
          {o.cashier && <div><dt>Cashier</dt><dd>{o.cashier}</dd></div>}
        </dl>
        {o.notes && <p className="pre" style={{ marginTop: 12 }}>{o.notes}</p>}
      </section>
      <section className="panel">
        <h3>Items</h3>
        <Lines o={o} />
      </section>
      {(o.payments.length > 0 || o.refunds.length > 0) && (
        <section className="panel">
          <h3>Payments</h3>
          <table className="mini">
            <tbody>
              {o.payments.map((p, i) => (
                <tr key={i}>
                  <td>{formatDateTime(p.at)}</td>
                  <td>{Number(p.amount) < 0 ? "Refund" : "Paid"} · {label(p.method)}{p.ref && !p.ref.startsWith("refund") ? ` · ${p.ref}` : ""}</td>
                  <td className="num">{p.tendered ? `${money(p.tendered)} given, ${money(p.change)} change` : ""}</td>
                  <td className="num">{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {o.refunds.map((r) => (
            <p key={r.seq} className="muted small">
              Refund {r.seq}: {money(r.amount)} by {r.by}{r.restock ? ", put back in stock" : ", not restocked"}{r.reason ? ` · ${r.reason}` : ""}
            </p>
          ))}
        </section>
      )}
      {dialog === "pay" && <PayDialog app={app} order={o} onClose={() => setDialog(null)} />}
      {dialog === "refund" && <RefundDialog app={app} order={o} onClose={() => setDialog(null)} />}
      {dialog === "receipt" && <ReceiptDialog order={o} settings={app.settings} onClose={() => setDialog(null)} />}
      {dialog === "cancel" && (
        <Confirm
          title={`Cancel ${o.number}`}
          message="The order is cancelled and its items go back on the shelf."
          action="Cancel order"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api(`/api/orders/${o.id}/cancel`, { method: "POST", json: {} });
            app.say("Order cancelled");
            app.changed();
          }}
        />
      )}
    </div>
  );
}

export function Lines({ o }: { o: Order }) {
  return (
    <table className="mini">
      <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Total</th></tr></thead>
      <tbody>
        {o.lines.map((l) => (
          <tr key={l.id}>
            <td>
              {l.name} <span className="muted small">{l.sku}</span>
              {Number(l.discount) > 0 && <div className="muted small">{money(l.discount)} off</div>}
              {l.refunded > 0 && <div className="muted small">{qty(l.refunded)} refunded</div>}
            </td>
            <td className="num">{qty(l.qty)}</td>
            <td className="num">{money(l.unitPrice)}</td>
            <td className="num">{money(l.total)}</td>
          </tr>
        ))}
        <tr><td colSpan={3}>Subtotal</td><td className="num">{money(o.subtotal)}</td></tr>
        {Number(o.discount) > 0 && <tr><td colSpan={3}>Discounts</td><td className="num">−{money(o.discount)}</td></tr>}
        <tr><td colSpan={3}>Tax</td><td className="num">{money(o.tax)}</td></tr>
        <tr><td colSpan={3}><strong>Total</strong></td><td className="num"><strong>{money(o.total)}</strong></td></tr>
        {Number(o.refunded) > 0 && <tr><td colSpan={3}>Refunded</td><td className="num">−{money(o.refunded)}</td></tr>}
      </tbody>
    </table>
  );
}

function PayDialog({ app, order: o, onClose }: { app: AppCtx; order: Order; onClose: () => void }) {
  const [err, setErr] = useState("");
  const [change, setChange] = useState<string | null>(null);
  if (change !== null) {
    return (
      <Modal title="Paid" onClose={onClose}>
        <div className="form">
          <p className="bigname">{Number(change) > 0 ? `Change: ${money(change)}` : "Payment recorded"}</p>
          <div className="actions"><button className="btn primary" onClick={onClose} autoFocus>Done</button></div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={`Take payment for ${o.number}`} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = formData(e.currentTarget);
          try {
            const r = await api<{ change: string }>(`/api/orders/${o.id}/pay`, { method: "POST", json: { payments: [{ method: f.method, amount: f.amount, ref: f.ref }] } });
            app.changed();
            setChange(r.change);
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <p>Amount due: <strong>{money(o.total)}</strong></p>
        <div className="grid2">
          <label>
            <span>Method</span>
            <select name="method" defaultValue="card">
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label><span>Amount received</span><input name="amount" defaultValue={o.total} inputMode="decimal" /></label>
        </div>
        <label><span>Reference</span><input name="ref" placeholder="Card slip or transfer number" /></label>
        <p className="muted small">To count this in a register&apos;s drawer, take the payment from the register instead.</p>
        <ErrorLine text={err} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Record payment</button>
        </div>
      </form>
    </Modal>
  );
}

export function RefundDialog({ app, order: o, registerId, onClose }: { app: AppCtx | null; order: Order; registerId?: string; onClose: (done?: boolean) => void }) {
  const left = o.lines.filter((l) => l.qty > l.refunded);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [done, setDone] = useState<string | null>(null);
  if (done) {
    return (
      <Modal title="Refunded" onClose={() => onClose(true)}>
        <div className="form">
          <p className="bigname">Give back {money(done)}</p>
          <div className="actions"><button className="btn primary" onClick={() => onClose(true)} autoFocus>Done</button></div>
        </div>
      </Modal>
    );
  }
  const method = o.payments.find((p) => Number(p.amount) > 0)?.method ?? "cash";
  return (
    <Modal title={`Refund ${o.number}`} onClose={() => onClose()} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = formData(e.currentTarget);
          try {
            const r = await api<{ amount: string }>(`/api/orders/${o.id}/refund`, {
              method: "POST",
              json: {
                lines: left.map((l) => ({ lineId: l.id, qty: counts[l.id] ?? "" })),
                method: f.method,
                restock: f.restock,
                reason: f.reason,
                registerId,
              },
            });
            app?.changed();
            setDone(r.amount);
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <table className="mini">
          <thead><tr><th>Item</th><th className="num">Bought</th><th className="num">Coming back</th></tr></thead>
          <tbody>
            {left.map((l) => (
              <tr key={l.id}>
                <td>{l.name} <span className="muted small">{l.sku}</span></td>
                <td className="num">{qty(l.qty - l.refunded)}</td>
                <td className="num">
                  <input className="cell" inputMode="decimal" value={counts[l.id] ?? ""} placeholder="0" aria-label={`${l.sku} coming back`} onChange={(e) => setCounts({ ...counts, [l.id]: e.target.value })} />
                  <button type="button" className="linkbtn small" onClick={() => setCounts({ ...counts, [l.id]: String(l.qty - l.refunded) })}>All</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid2">
          <label>
            <span>Give back as</span>
            <select name="method" defaultValue={method === "online" ? "online" : method}>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="online">Online (through the payment provider)</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label><span>Reason</span><input name="reason" /></label>
        </div>
        <label className="check"><input type="checkbox" name="restock" defaultChecked /> Put the items back in stock</label>
        <ErrorLine text={err} />
        <div className="actions">
          <button type="button" className="btn" onClick={() => onClose()}>Cancel</button>
          <button className="btn primary">Refund</button>
        </div>
      </form>
    </Modal>
  );
}

/** A printable receipt; the print stylesheet shows only this. */
export function ReceiptDialog({ order: o, settings, onClose, change }: { order: Order; settings: Settings; onClose: () => void; change?: string }) {
  return (
    <Modal title="Receipt" onClose={onClose}>
      <div className="form">
        <div className="receipt" id="receipt">
          <div className="rc-head">
            <strong>{settings.storeName}</strong>
            <div>{o.locationName}</div>
            <div>{o.number} · {formatDateTime(o.paidAt ?? o.createdAt)}</div>
          </div>
          {o.lines.map((l) => (
            <div className="rc-line" key={l.id}>
              <span>{qty(l.qty)} × {l.name}</span>
              <span>{money(Number(l.total) - Number(l.tax))}</span>
            </div>
          ))}
          <div className="rc-line rc-sep"><span>Subtotal</span><span>{money(Number(o.subtotal) - Number(o.discount))}</span></div>
          {Number(o.discount) > 0 && <div className="rc-line"><span>You saved</span><span>{money(o.discount)}</span></div>}
          <div className="rc-line"><span>Tax</span><span>{money(o.tax)}</span></div>
          <div className="rc-line rc-total"><span>Total</span><span>{money(o.total)}</span></div>
          {o.payments.filter((p) => Number(p.amount) > 0).map((p, i) => (
            <div className="rc-line" key={i}><span>{label(p.method)}{p.tendered ? ` (${money(p.tendered)} given)` : ""}</span><span>{money(p.amount)}</span></div>
          ))}
          {change && Number(change) > 0 && <div className="rc-line"><span>Change</span><span>{money(change)}</span></div>}
          {Number(o.refunded) > 0 && <div className="rc-line"><span>Refunded</span><span>−{money(o.refunded)}</span></div>}
          {settings.receiptFooter && <p className="rc-foot">{settings.receiptFooter}</p>}
        </div>
        <div className="actions noprint">
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" onClick={() => window.print()} autoFocus><Printer size={15} /> Print</button>
        </div>
      </div>
    </Modal>
  );
}
