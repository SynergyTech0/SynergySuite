"use client";
import { ArrowLeft, Banknote, CreditCard, Lock, Minus, Plus, ScanBarcode, Search, ShoppingBag, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { price } from "@/lib/money";
import type { OrderSummary } from "@/lib/sales";
import type { Ctx, Order, Product, Register as Reg, Settings, Shift } from "@/lib/types";
import { api, formData, money, qty, setCurrency, useData } from "./client";
import { Modal } from "./Modal";
import { ReceiptDialog, RefundDialog } from "./Orders";
import { ErrorLine } from "./shared";

type Me = Ctx & { settings: Settings };
type CartLine = { product: Product; qty: number; discount: string };

const REG_KEY = "synergy-register";

function remembered(): string {
  try {
    return localStorage.getItem(REG_KEY) ?? "";
  } catch {
    return "";
  }
}

/** The register: pick a till, open it, ring up sales, take payment, print receipts, close the drawer. */
export function Register() {
  const [me, setMe] = useState<Me | null>(null);
  const regs = useData<Reg[]>("/api/registers");
  const [regId, setRegId] = useState("");
  useEffect(() => {
    api<Me>("/api/me").then((m) => (setCurrency(m.settings.currency), setMe(m))).catch(() => {});
    setRegId(remembered());
  }, []);
  const reg = regs.data?.find((r) => r.id === regId && r.active);
  if (!me || !regs.data) return <div className="pad muted">Loading…</div>;
  if (!reg) {
    return (
      <div className="page narrow">
        <div className="pagehead"><h1>Choose a register</h1><a className="btn" href="/"><ArrowLeft size={15} /> Back office</a></div>
        <section className="panel">
          {regs.data.filter((r) => r.active).map((r) => (
            <button key={r.id} className="linkrow" onClick={() => { try { localStorage.setItem(REG_KEY, r.id); } catch { /* private window */ } setRegId(r.id); }}>
              <span className="grow"><span className="rname">{r.name}</span><span className="rsub"> · {r.locationName}</span></span>
              <span className="muted small">{r.shift ? `Open, ${r.shift.openedBy}` : "Closed"}</span>
            </button>
          ))}
        </section>
      </div>
    );
  }
  if (!reg.shift) return <OpenShift reg={reg} onOpened={regs.reload} onSwitch={() => setRegId("")} />;
  return <Till me={me} reg={reg} shift={reg.shift} onClosed={regs.reload} onSwitch={() => setRegId("")} />;
}

function OpenShift({ reg, onOpened, onSwitch }: { reg: Reg; onOpened: () => void; onSwitch: () => void }) {
  const [err, setErr] = useState("");
  return (
    <div className="page narrow">
      <div className="pagehead"><h1>{reg.name}</h1><button className="btn" onClick={onSwitch}>Another register</button></div>
      <section className="panel">
        <form
          className="form flat"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api(`/api/registers/${reg.id}/open`, { method: "POST", json: formData(e.currentTarget) });
              onOpened();
            } catch (x) {
              setErr((x as Error).message);
            }
          }}
        >
          <p>The register at {reg.locationName} is closed. Count the cash in the drawer to open it.</p>
          <label><span>Cash in the drawer</span><input name="float" inputMode="decimal" defaultValue="0.00" autoFocus /></label>
          <ErrorLine text={err} />
          <div className="actions"><button className="btn primary">Open register</button></div>
        </form>
      </section>
    </div>
  );
}

function Till({ me, reg, shift, onClosed, onSwitch }: { me: Me; reg: Reg; shift: Shift; onClosed: () => void; onSwitch: () => void }) {
  const s = me.settings;
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderDiscount, setOrderDiscount] = useState("");
  const [customer, setCustomer] = useState({ name: "", email: "" });
  const [term, setTerm] = useState("");
  const [category, setCategory] = useState("");
  const [msg, setMsg] = useState("");
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<{ order: Order; change: string } | null>(null);
  const [panel, setPanel] = useState<"" | "close" | "orders">("");
  const scan = useRef<HTMLInputElement>(null);
  const catalog = useData<Product[]>(`/api/products?q=${encodeURIComponent(term)}&category=${encodeURIComponent(category)}`);
  const cats = useData<string[]>("/api/categories");

  const add = useCallback((p: Product, n = 1) => {
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      if (i < 0) return [...c, { product: p, qty: n, discount: "" }];
      return c.map((l, j) => (j === i ? { ...l, qty: l.qty + n } : l));
    });
    setMsg("");
  }, []);

  // A barcode scanner types the code and presses Enter; so does a person typing a SKU.
  const onScan = async (code: string) => {
    if (!code.trim()) return;
    try {
      add(await api<Product>(`/api/products/lookup?code=${encodeURIComponent(code.trim())}`));
      setTerm("");
    } catch {
      if (catalog.data?.length === 1) {
        add(catalog.data[0]);
        setTerm("");
      } else setMsg(`Nothing with the code ${code}`);
    }
  };

  const totals = useMemo(() => {
    const rate = (p: Product) => (p.taxRate === null ? s.defaultTaxRate : Number(p.taxRate));
    return price(
      cart.map((l) => ({ qty: l.qty, unitPrice: Math.round(Number(l.product.price) * 100), discount: Math.round(Number(l.discount || 0) * 100), taxRate: rate(l.product) })),
      Math.round(Number(orderDiscount || 0) * 100),
    );
  }, [cart, orderDiscount, s.defaultTaxRate]);

  const clear = () => {
    setCart([]);
    setOrderDiscount("");
    setCustomer({ name: "", email: "" });
    scan.current?.focus();
  };

  return (
    <div className="pos">
      <section className="pos-left">
        <div className="pos-bar">
          <div className="search grow">
            <ScanBarcode size={16} />
            <input
              ref={scan}
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void onScan(term))}
              placeholder="Scan a barcode, or type a name or SKU"
              aria-label="Scan or search"
            />
            {term && <button className="iconbtn small" aria-label="Clear" onClick={() => setTerm("")}><X size={14} /></button>}
          </div>
          <button className="btn" onClick={() => setPanel("orders")}><ShoppingBag size={15} /> Orders</button>
          <button className="btn" onClick={() => setPanel("close")}><Lock size={15} /> Close</button>
        </div>
        <div className="seg pos-cats">
          <button className={category === "" ? "on" : ""} onClick={() => setCategory("")}>All</button>
          {(cats.data ?? []).map((c) => <button key={c} className={category === c ? "on" : ""} onClick={() => setCategory(c)}>{c}</button>)}
        </div>
        {msg && <p className="error pad">{msg}</p>}
        <div className="pos-grid">
          {catalog.data?.map((p) => (
            <button key={p.id} className="pos-tile" onClick={() => add(p)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <span className="pos-initials">{p.name.slice(0, 2).toUpperCase()}</span>}
              <span className="pos-name">{p.name}</span>
              <span className="pos-price">{money(p.price)}</span>
              {p.trackStock && <span className={`pos-stock${p.onHand <= 0 ? " out" : ""}`}>{qty(p.onHand)} left</span>}
            </button>
          ))}
          {catalog.data?.length === 0 && <p className="muted pad">No products match.</p>}
        </div>
      </section>
      <section className="pos-right">
        <div className="pos-head">
          <strong>{reg.name}</strong>
          <span className="muted small">{reg.locationName} · {me.name || me.email}</span>
          <button className="linkbtn small" onClick={onSwitch}>Switch</button>
        </div>
        <div className="pos-cart">
          {cart.length === 0 && <div className="empty"><Search size={22} /><p>Scan or tap products to start a sale.</p></div>}
          {cart.map((l, i) => (
            <div className="pos-line" key={l.product.id}>
              <div className="grow">
                <div className="rname">{l.product.name}</div>
                <div className="rsub">{money(l.product.price)} each</div>
                <input
                  className="cell disc"
                  placeholder="Discount"
                  inputMode="decimal"
                  value={l.discount}
                  aria-label={`${l.product.sku} discount`}
                  onChange={(e) => setCart(cart.map((x, j) => (j === i ? { ...x, discount: e.target.value } : x)))}
                />
              </div>
              <div className="pos-qty">
                <button className="iconbtn small" aria-label="One less" onClick={() => setCart(cart.flatMap((x, j) => (j === i ? (x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []) : [x])))}><Minus size={14} /></button>
                <span>{qty(l.qty)}</span>
                <button className="iconbtn small" aria-label="One more" onClick={() => add(l.product)}><Plus size={14} /></button>
              </div>
              <div className="num pos-amt">{money(totals.lines[i]?.total / 100)}</div>
              <button className="iconbtn small" aria-label="Remove" onClick={() => setCart(cart.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div className="pos-foot">
          <div className="grid2">
            <input className="cell" placeholder="Customer name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} aria-label="Customer name" />
            <input className="cell" placeholder="Email for receipt" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} aria-label="Customer email" />
          </div>
          <div className="pos-sum"><span>Subtotal</span><span>{money(totals.subtotal / 100)}</span></div>
          <div className="pos-sum">
            <span>Order discount <input className="cell" style={{ width: 80 }} inputMode="decimal" value={orderDiscount} onChange={(e) => setOrderDiscount(e.target.value)} aria-label="Order discount" /></span>
            <span>−{money(totals.discount / 100)}</span>
          </div>
          <div className="pos-sum"><span>Tax</span><span>{money(totals.tax / 100)}</span></div>
          <div className="pos-sum pos-total"><span>Total</span><span>{money(totals.total / 100)}</span></div>
          <div className="pos-actions">
            <button className="btn" disabled={!cart.length} onClick={clear}>Clear</button>
            <button className="btn primary pos-pay" disabled={!cart.length} onClick={() => setPaying(true)}>Pay {money(totals.total / 100)}</button>
          </div>
        </div>
      </section>
      {paying && (
        <PayDialog
          total={totals.total}
          onClose={() => setPaying(false)}
          onPay={async (payments) => {
            const r = await api<{ order: Order; change: string }>("/api/sales", {
              method: "POST",
              json: {
                registerId: reg.id,
                items: cart.map((l) => ({ productId: l.product.id, qty: l.qty, discount: l.discount })),
                orderDiscount,
                payments,
                customerName: customer.name,
                customerEmail: customer.email,
              },
            });
            setPaying(false);
            setReceipt(r);
            clear();
            catalog.reload();
          }}
        />
      )}
      {receipt && (
        <ReceiptDialog order={receipt.order} settings={s} change={receipt.change} onClose={() => (setReceipt(null), scan.current?.focus())} />
      )}
      {panel === "close" && <CloseShift reg={reg} shift={shift} onClose={() => setPanel("")} onClosed={onClosed} />}
      {panel === "orders" && <RegisterOrders me={me} reg={reg} settings={s} onClose={() => setPanel("")} />}
    </div>
  );
}

type Tender = { method: "cash" | "card" | "other"; amount: string; ref?: string };

function PayDialog({ total, onPay, onClose }: { total: number; onPay: (p: Tender[]) => Promise<void>; onClose: () => void }) {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [cash, setCash] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const paid = tenders.reduce((a, t) => a + Math.round(Number(t.amount) * 100), 0);
  const due = Math.max(0, total - paid);
  const quick = [...new Set([due, Math.ceil(due / 500) * 500, Math.ceil(due / 1000) * 1000, Math.ceil(due / 2000) * 2000, Math.ceil(due / 5000) * 5000])].filter((v) => v >= due).slice(0, 4);
  const finish = async (list: Tender[]) => {
    setBusy(true);
    try {
      await onPay(list);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const cents = (c: number) => (c / 100).toFixed(2);
  return (
    <Modal title={`Pay ${money(total / 100)}`} onClose={onClose}>
      <div className="form">
        {tenders.length > 0 && (
          <p className="muted">
            Taken so far: {tenders.map((t) => `${t.method} ${money(t.amount)}`).join(", ")} · still due <strong>{money(due / 100)}</strong>
          </p>
        )}
        <div className="pos-tenders">
          <button className="btn big" disabled={busy || !due} onClick={() => void finish([...tenders, { method: "card", amount: cents(due) }])}><CreditCard size={18} /> Card {money(due / 100)}</button>
          <button className="btn big" disabled={busy || !due} onClick={() => void finish([...tenders, { method: "other", amount: cents(due) }])}>Other {money(due / 100)}</button>
        </div>
        <fieldset>
          <legend><Banknote size={14} /> Cash</legend>
          <div className="seg">
            {quick.map((v) => <button key={v} disabled={busy} onClick={() => void finish([...tenders, { method: "cash", amount: cents(v) }])}>{money(v / 100)}</button>)}
          </div>
          <div className="logrow">
            <input className="cell" placeholder="Cash given" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} aria-label="Cash given" autoFocus />
            <button className="btn" disabled={busy || !cash} onClick={() => void finish([...tenders, { method: "cash", amount: cash }])}>Take cash</button>
          </div>
        </fieldset>
        <details>
          <summary className="muted small">Split the payment</summary>
          <div className="logrow" style={{ marginTop: 8 }}>
            <SplitPart onAdd={(t) => setTenders([...tenders, t])} max={due} />
          </div>
        </details>
        <ErrorLine text={err} />
      </div>
    </Modal>
  );
}

function SplitPart({ onAdd, max }: { onAdd: (t: Tender) => void; max: number }) {
  const [method, setMethod] = useState<Tender["method"]>("card");
  const [amount, setAmount] = useState("");
  return (
    <>
      <select value={method} onChange={(e) => setMethod(e.target.value as Tender["method"])} aria-label="Method">
        <option value="card">Card</option>
        <option value="other">Other</option>
      </select>
      <input className="cell" placeholder="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Part amount" />
      <button className="btn" disabled={!amount || Math.round(Number(amount) * 100) >= max} onClick={() => (onAdd({ method, amount }), setAmount(""))}>Add part</button>
    </>
  );
}

function CloseShift({ reg, shift, onClose, onClosed }: { reg: Reg; shift: Shift; onClose: () => void; onClosed: () => void }) {
  const [result, setResult] = useState<(Shift & { over: string }) | null>(null);
  const [err, setErr] = useState("");
  const takings = shift.takings ?? {};
  if (result) {
    return (
      <Modal title="Register closed" onClose={onClosed}>
        <div className="form">
          <p>Expected in the drawer: <strong>{money(result.expectedCash)}</strong></p>
          <p>Counted: <strong>{money(result.countedCash)}</strong></p>
          <p className={Number(result.over) === 0 ? "ok" : "error"}>
            {Number(result.over) === 0 ? "The drawer balances." : Number(result.over) > 0 ? `${money(result.over)} over` : `${money(-Number(result.over))} short`}
          </p>
          <div className="actions"><button className="btn primary" onClick={onClosed} autoFocus>Done</button></div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={`Close ${reg.name}`} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            setResult(await api(`/api/registers/${reg.id}/close`, { method: "POST", json: formData(e.currentTarget) }));
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <table className="mini">
          <tbody>
            <tr><td>Opening cash</td><td className="num">{money(shift.openingFloat)}</td></tr>
            {Object.entries(takings).map(([m, v]) => <tr key={m}><td>{m === "cash" ? "Cash taken" : m === "card" ? "Card" : "Other"}</td><td className="num">{money(v)}</td></tr>)}
          </tbody>
        </table>
        <label><span>Cash counted in the drawer</span><input name="counted" inputMode="decimal" required autoFocus /></label>
        <label><span>Note</span><input name="note" /></label>
        <ErrorLine text={err} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Close register</button>
        </div>
      </form>
    </Modal>
  );
}

/** Pickups waiting to be paid, and today's sales for refunds and reprints. */
function RegisterOrders({ me, reg, settings, onClose }: { me: Me; reg: Reg; settings: Settings; onClose: () => void }) {
  const [term, setTerm] = useState("");
  const pending = useData<OrderSummary[]>("/api/orders?status=pending");
  const recent = useData<OrderSummary[]>(`/api/orders?q=${encodeURIComponent(term)}`);
  const [open, setOpen] = useState<Order | null>(null);
  const [mode, setMode] = useState<"" | "pay" | "refund" | "receipt">("");
  const [change, setChange] = useState("");
  const [err, setErr] = useState("");
  const manager = me.role === "manager" || me.role === "admin";
  const pick = async (id: string, m: typeof mode) => {
    setOpen(await api<Order>(`/api/orders/${id}`));
    setMode(m);
  };
  return (
    <Modal title="Orders" onClose={onClose} wide>
      <div className="form">
        {(pending.data?.length ?? 0) > 0 && (
          <section>
            <h3>Waiting for payment</h3>
            {pending.data!.map((o) => (
              <button key={o.id} className="linkrow" onClick={() => void pick(o.id, "pay")}>
                <span className="grow"><span className="rname">{o.number} · {o.customerName}</span><span className="rsub"> {o.delivery === "ship" ? "Delivery" : "Pickup"}</span></span>
                <strong>{money(o.total)}</strong>
              </button>
            ))}
          </section>
        )}
        <section>
          <h3>Find a sale</h3>
          <input className="cell" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Order number, name or email" aria-label="Find a sale" />
          {recent.data?.slice(0, 12).map((o) => (
            <div key={o.id} className="linkrow">
              <span className="grow"><span className="rname">{o.number}</span><span className="rsub"> {o.customerName || o.cashier} · {money(o.total)}</span></span>
              <button className="linkbtn" onClick={() => void pick(o.id, "receipt")}>Receipt</button>
              {manager && (o.status === "paid" || o.status === "partially_refunded") && <button className="linkbtn" onClick={() => void pick(o.id, "refund")}>Refund</button>}
            </div>
          ))}
        </section>
        <ErrorLine text={err} />
      </div>
      {open && mode === "receipt" && <ReceiptDialog order={open} settings={settings} change={change} onClose={() => (setOpen(null), setChange(""))} />}
      {open && mode === "refund" && <RefundDialog app={null} order={open} registerId={reg.id} onClose={() => (setOpen(null), recent.reload())} />}
      {open && mode === "pay" && (
        <PayDialog
          total={Math.round(Number(open.total) * 100)}
          onClose={() => setOpen(null)}
          onPay={async (payments) => {
            try {
              const r = await api<{ order: Order; change: string }>(`/api/orders/${open.id}/pay`, { method: "POST", json: { registerId: reg.id, payments } });
              setChange(r.change);
              setOpen(r.order);
              setMode("receipt");
              pending.reload();
            } catch (x) {
              setErr((x as Error).message);
              throw x;
            }
          }}
        />
      )}
    </Modal>
  );
}
