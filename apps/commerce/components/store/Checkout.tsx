"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Loader2, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import type { StoreProduct } from "@/lib/store";
import { toCents } from "@/lib/money";
import { clearCart, readCart, useCart, writeCart, type CartItem } from "./cart";
import { moneyFormatter, stockNote } from "./format";
import ProductImage from "./ProductImage";

type Props = {
  currency: string;
  /** Cents, flat per order, charged only for delivery. */
  shippingFee: number;
  pickup: boolean;
  shipping: boolean;
  payLater: boolean;
  /** A payment provider is set up, so shoppers can pay online. */
  payOnline: boolean;
};

type Delivery = "pickup" | "ship";
type Pay = "online" | "later";

export default function Checkout(props: Props) {
  const { currency, shippingFee, pickup, shipping, payLater, payOnline } = props;
  const money = useMemo(() => moneyFormatter(currency), [currency]);
  const cents = useCallback((c: number) => money(c / 100), [money]);
  const cart = useCart();

  const [products, setProducts] = useState<Record<string, StoreProduct>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notices, setNotices] = useState<string[]>([]);
  const busyRef = useRef(false);

  const [delivery, setDelivery] = useState<Delivery>(pickup ? "pickup" : "ship");
  const payChoices: Pay[] = [...(payOnline ? (["online"] as const) : []), ...(payLater ? (["later"] as const) : [])];
  const [pay, setPay] = useState<Pay>(payChoices[0] ?? "later");
  const [submitting, setSubmitting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");

  /** Fetches today's prices and stock, then drops or trims anything the store can no longer supply. */
  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    const items = readCart();
    if (!items.length) {
      setLoaded(true);
      return;
    }
    busyRef.current = true;
    try {
      const ids = items.map((i) => i.productId).join(",");
      const res = await fetch(`/api/store/stock?ids=${encodeURIComponent(ids)}`, { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as StoreProduct[] | { error?: string } | null;
      if (!res.ok || !Array.isArray(data)) throw new Error((data && !Array.isArray(data) && data.error) || "Couldn't load your cart");
      const byId: Record<string, StoreProduct> = {};
      for (const p of data) byId[p.id] = p;

      const notes: string[] = [];
      let gone = 0;
      const next: CartItem[] = [];
      for (const item of readCart()) {
        const p = byId[item.productId];
        if (!p) {
          gone++;
          continue;
        }
        if (p.available !== null && p.available <= 0) {
          notes.push(`${p.name} is sold out and was removed.`);
          continue;
        }
        if (p.available !== null && item.qty > p.available) {
          notes.push(`Only ${p.available} ${p.name} left, so we changed the quantity.`);
          next.push({ productId: item.productId, qty: p.available });
          continue;
        }
        next.push(item);
      }
      if (gone) notes.unshift(gone === 1 ? "One item is no longer available and was removed." : `${gone} items are no longer available and were removed.`);
      setProducts((cur) => ({ ...cur, ...byId }));
      if (notes.length) {
        setNotices((cur) => [...cur, ...notes]);
        writeCart(next);
      }
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load your cart");
    } finally {
      busyRef.current = false;
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Something added in another tab that we haven't priced yet.
  const unknown = cart.some((i) => !products[i.productId]);
  useEffect(() => {
    if (loaded && unknown && !loadError) void refresh();
    // products is listed so a fetch that finished while another item was added gets a follow-up.
  }, [loaded, unknown, loadError, refresh, products]);

  function setQty(productId: string, qty: number) {
    const p = products[productId];
    let n = Math.floor(qty);
    if (!Number.isFinite(n) || n < 1) n = 1;
    if (p && p.available !== null) n = Math.min(n, p.available);
    writeCart(readCart().map((i) => (i.productId === productId ? { ...i, qty: n } : i)));
  }

  function remove(productId: string) {
    writeCart(readCart().filter((i) => i.productId !== productId));
  }

  // Worked in whole cents, with tax rounded per line, the same way the order will be.
  const lines = cart.flatMap((i) => {
    const p = products[i.productId];
    if (!p) return [];
    const total = toCents(p.price) * i.qty;
    return [{ item: i, p, total, tax: Math.round((total * p.taxRate) / 100) }];
  });
  const subtotal = lines.reduce((n, l) => n + l.total, 0);
  const tax = lines.reduce((n, l) => n + l.tax, 0);
  const fee = delivery === "ship" && shippingFee > 0 ? shippingFee : 0;
  const total = subtotal + tax + fee;
  const canOrder = (pickup || shipping) && payChoices.length > 0;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || !lines.length) return;
    const f = new FormData(e.currentTarget);
    const str = (k: string) => String(f.get(k) ?? "").trim();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/store/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lines.map((l) => ({ productId: l.p.id, qty: l.item.qty })),
          name: str("name"),
          email: str("email"),
          phone: str("phone"),
          delivery,
          address: delivery === "ship" ? str("address") : "",
          notes: str("notes"),
          payOnline: pay === "online",
          website: String(f.get("website") ?? ""),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { next?: string; error?: string };
      if (!res.ok || typeof data.next !== "string") {
        setError(data.error || "Something went wrong placing your order. Please try again.");
        // Stock may have moved; bring the cart up to date.
        if (res.status === 409) void refresh();
        setSubmitting(false);
        return;
      }
      setLeaving(true);
      clearCart();
      window.location.href = data.next;
    } catch {
      setError("We couldn't reach the store. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  if (leaving) {
    return (
      <div className="shop-empty">
        <Loader2 size={32} className="shop-spin" aria-hidden />
        <h1>Placing your order</h1>
        <p className="shop-muted">One moment while we take you to the next step.</p>
      </div>
    );
  }

  const notesBox = notices.length > 0 && (
    <div className="shop-notice" role="status">
      {notices.map((n, i) => (
        <p key={i}>{n}</p>
      ))}
      <button type="button" className="shop-link-quiet" onClick={() => setNotices([])}>
        Dismiss
      </button>
    </div>
  );

  if (!loaded) {
    return (
      <div className="shop-empty">
        <Loader2 size={32} className="shop-spin" aria-hidden />
        <p className="shop-muted">Loading your cart</p>
      </div>
    );
  }

  if (!cart.length) {
    return (
      <>
        {notesBox}
        <div className="shop-empty">
          <ShoppingBag size={40} aria-hidden />
          <h1>Your cart is empty</h1>
          <p>
            <Link href="/store" className="shop-btn shop-btn-primary">
              Browse products
            </Link>
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="shop-titlebar">
        <h1>Your cart</h1>
        <Link href="/store" className="shop-link-quiet">
          Keep shopping
        </Link>
      </div>
      {notesBox}
      {loadError && (
        <div className="shop-alert" role="alert">
          <p>{loadError}</p>
          <button type="button" className="shop-btn" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      )}

      <div className="shop-checkout">
        <section className="shop-panel" aria-label="Items">
          <ul className="shop-lines">
            {lines.map(({ item, p, total: lineTotal }) => {
              const note = stockNote(p.available);
              const max = p.available === null ? 99 : p.available;
              return (
                <li key={p.id} className="shop-line">
                  <Link href={`/store/p/${encodeURIComponent(p.sku)}`} className="shop-line-img">
                    <ProductImage name={p.name} src={p.imageUrl} />
                  </Link>
                  <div className="shop-line-main">
                    <Link href={`/store/p/${encodeURIComponent(p.sku)}`} className="shop-line-name">
                      {p.name}
                    </Link>
                    <span className="shop-muted shop-small">{money(p.price)} each</span>
                    {note && note.tone === "low" && <span className="shop-stock shop-stock-low">{note.text}</span>}
                    <div className="shop-line-controls">
                      <div className="shop-qty shop-qty-small" role="group" aria-label={`Quantity of ${p.name}`}>
                        <button type="button" onClick={() => setQty(p.id, item.qty - 1)} disabled={item.qty <= 1} aria-label="One fewer">
                          <Minus size={14} aria-hidden />
                        </button>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={max}
                          value={item.qty}
                          onChange={(e) => setQty(p.id, Number(e.target.value))}
                          aria-label="Quantity"
                        />
                        <button type="button" onClick={() => setQty(p.id, item.qty + 1)} disabled={item.qty >= max} aria-label="One more">
                          <Plus size={14} aria-hidden />
                        </button>
                      </div>
                      <button type="button" className="shop-icon-btn" onClick={() => remove(p.id)} aria-label={`Remove ${p.name}`}>
                        <Trash2 size={16} aria-hidden />
                      </button>
                    </div>
                  </div>
                  <span className="shop-line-total">{cents(lineTotal)}</span>
                </li>
              );
            })}
          </ul>
          {unknown && <p className="shop-muted shop-small">Checking the latest prices</p>}
          <dl className="shop-totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{cents(subtotal)}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>{cents(tax)}</dd>
            </div>
            {delivery === "ship" && (
              <div>
                <dt>Delivery</dt>
                <dd>{fee ? cents(fee) : "Free"}</dd>
              </div>
            )}
            <div className="shop-totals-grand">
              <dt>Total</dt>
              <dd>{cents(total)}</dd>
            </div>
          </dl>
        </section>

        <section className="shop-panel" aria-label="Checkout">
          <h2>Checkout</h2>
          {!canOrder ? (
            <p className="shop-muted">
              Sorry, the store can&apos;t take orders online right now. Please contact us or visit the shop to buy these items.
            </p>
          ) : (
            <form onSubmit={submit} className="shop-form">
              <label>
                <span>Name</span>
                <input name="name" required maxLength={120} autoComplete="name" />
              </label>
              <label>
                <span>Email</span>
                <input name="email" type="email" required maxLength={254} autoComplete="email" />
              </label>
              <label>
                <span>
                  Phone <span className="shop-muted">(optional)</span>
                </span>
                <input name="phone" type="tel" maxLength={40} autoComplete="tel" />
              </label>

              {pickup && shipping ? (
                <fieldset className="shop-choices">
                  <legend>How do you want it?</legend>
                  <label className={delivery === "pickup" ? "shop-choice shop-choice-on" : "shop-choice"}>
                    <input type="radio" name="delivery" value="pickup" checked={delivery === "pickup"} onChange={() => setDelivery("pickup")} />
                    <span>Pick up in store</span>
                  </label>
                  <label className={delivery === "ship" ? "shop-choice shop-choice-on" : "shop-choice"}>
                    <input type="radio" name="delivery" value="ship" checked={delivery === "ship"} onChange={() => setDelivery("ship")} />
                    <span>Delivery{shippingFee > 0 ? ` (${cents(shippingFee)})` : ""}</span>
                  </label>
                </fieldset>
              ) : (
                <p className="shop-muted shop-small">
                  {delivery === "pickup"
                    ? "Orders are picked up in store."
                    : `Orders are delivered${shippingFee > 0 ? ` for ${cents(shippingFee)}` : ""}.`}
                </p>
              )}

              {delivery === "ship" && (
                <label>
                  <span>Delivery address</span>
                  <textarea name="address" required minLength={8} maxLength={500} rows={3} autoComplete="street-address" />
                </label>
              )}

              <label>
                <span>
                  Notes <span className="shop-muted">(optional)</span>
                </span>
                <textarea name="notes" maxLength={1000} rows={2} />
              </label>

              {/* Left empty by people; bots that fill every field give themselves away. */}
              <div className="shop-hp" aria-hidden="true">
                <label>
                  Website
                  <input name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
                </label>
              </div>

              {payChoices.length > 1 ? (
                <fieldset className="shop-choices">
                  <legend>Payment</legend>
                  <label className={pay === "online" ? "shop-choice shop-choice-on" : "shop-choice"}>
                    <input type="radio" name="pay" value="online" checked={pay === "online"} onChange={() => setPay("online")} />
                    <span>Pay online now</span>
                  </label>
                  <label className={pay === "later" ? "shop-choice shop-choice-on" : "shop-choice"}>
                    <input type="radio" name="pay" value="later" checked={pay === "later"} onChange={() => setPay("later")} />
                    <span>{delivery === "ship" ? "Pay on delivery" : "Pay at pickup"}</span>
                  </label>
                </fieldset>
              ) : (
                <p className="shop-muted shop-small">
                  {pay === "online"
                    ? "You'll pay online on the next page."
                    : delivery === "ship"
                      ? "You'll pay on delivery."
                      : "You'll pay when you pick up your order."}
                </p>
              )}

              {error && (
                <p className="shop-alert" role="alert">
                  {error}
                </p>
              )}

              <button type="submit" className="shop-btn shop-btn-primary shop-btn-block shop-btn-lg" disabled={submitting || unknown || !lines.length}>
                {submitting && <Loader2 size={18} className="shop-spin" aria-hidden />}
                {pay === "online" ? `Continue to payment · ${cents(total)}` : `Place order · ${cents(total)}`}
              </button>
            </form>
          )}
        </section>
      </div>
    </>
  );
}
