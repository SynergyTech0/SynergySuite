/**
 * Selling: register sales, online orders, payments, fulfilment, refunds and register shifts.
 * Prices always come from the catalog on the server; the browser only says what and how many.
 * Stock leaves the shelf when an order is placed (so the store can't sell it twice) and comes
 * back if an unpaid order is cancelled or a refund is restocked. Books hears about a sale when
 * it is paid, and about each refund.
 */
import { randomBytes } from "node:crypto";
import { q, tx, type Tq } from "./db";
import { enqueue, refundLines, saleLines } from "./books";
import { assertLocation } from "./catalog";
import { assertManager } from "./members";
import { changeDue, fromCents, price, qty as roundQty, refundShare, toCents } from "./money";
import { getSettings, taxRateFor } from "./settings";
import { move } from "./stock";
import { PAYMENT_METHODS, type Ctx, type Order, type PaymentMethod, type Register, type Settings, type Shift } from "./types";
import { UserError, bool, cents, isEmail, isUuid, oneOf, optionalEmail, quantity, text } from "./util";

const today = () => new Date().toISOString().slice(0, 10);

export type ItemInput = { productId?: unknown; qty?: unknown; discount?: unknown };

type Priced = {
  productId: string | null; sku: string; name: string; qty: number; unitPrice: number; discount: number; taxRate: number; tax: number;
  total: number; tracked: boolean;
};

type ProductForSale = { id: string; sku: string; name: string; price: string; tax_rate: string | null; track_stock: boolean; active: boolean; online: boolean };

/** Looks up and prices what is being bought. `onlineOnly` refuses anything not published to the store. */
async function priceItems(
  tq: Tq, s: Settings, items: unknown, orderDiscount: number, opts: { onlineOnly?: boolean; extra?: Omit<Priced, "tax" | "total" | "discount">[] } = {},
): Promise<{ lines: Priced[]; subtotal: number; discount: number; tax: number; total: number }> {
  if (!Array.isArray(items) || !items.length) throw new UserError("The cart is empty");
  if (items.length > 200) throw new UserError("Up to 200 lines per sale");
  const base: Omit<Priced, "tax" | "total">[] = [];
  for (const raw of items as ItemInput[]) {
    if (!isUuid(raw.productId)) throw new UserError("Something in the cart isn't a product");
    const [p] = await tq<ProductForSale>("SELECT id, sku, name, price, tax_rate, track_stock, active, online FROM products WHERE id = $1", [raw.productId]);
    if (!p || !p.active || (opts.onlineOnly && !p.online)) throw new UserError(`${p?.name ?? "A product"} is no longer for sale`);
    const n = quantity(raw.qty, `${p.sku} quantity`);
    if (opts.onlineOnly && (n > 999 || !Number.isInteger(n))) throw new UserError(`Order whole numbers of ${p.name}, up to 999`);
    base.push({
      productId: p.id, sku: p.sku, name: p.name, qty: n, unitPrice: toCents(p.price), discount: opts.onlineOnly ? 0 : cents(raw.discount, "Discount"),
      taxRate: taxRateFor(p, s), tracked: p.track_stock,
    });
  }
  for (const e of opts.extra ?? []) base.push({ ...e, discount: 0 });
  const t = price(base.map((b) => ({ qty: b.qty, unitPrice: b.unitPrice, discount: b.discount, taxRate: b.taxRate })), orderDiscount);
  return {
    lines: base.map((b, i) => ({ ...b, discount: t.lines[i].discount, tax: t.lines[i].tax, total: t.lines[i].total })),
    subtotal: t.subtotal, discount: t.discount, tax: t.tax, total: t.total,
  };
}

async function nextNumber(tq: Tq): Promise<string> {
  const [{ n }] = await tq<{ n: string }>("SELECT nextval('order_number_seq') AS n");
  return `S-${String(n).padStart(6, "0")}`;
}

/** Writes the order and its lines, taking tracked goods off the shelf at `locationId`. */
async function writeOrder(
  tq: Tq, by: string,
  o: {
    channel: "pos" | "online"; status: "pending" | "paid"; fulfillment: "unfulfilled" | "fulfilled"; delivery: "in_store" | "pickup" | "ship";
    locationId: string; shiftId?: string | null; cashier?: string | null; customerName?: string; customerEmail?: string; customerPhone?: string;
    shipAddress?: string; notes?: string; publicToken?: string | null;
  },
  priced: Awaited<ReturnType<typeof priceItems>>,
): Promise<{ id: string; number: string; cost: number }> {
  const number = await nextNumber(tq);
  const [row] = await tq<{ id: string }>(
    `INSERT INTO orders (number, channel, status, fulfillment, delivery, location_id, shift_id, cashier, customer_name, customer_email,
       customer_phone, ship_address, notes, subtotal, discount, tax, total, public_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
    [
      number, o.channel, o.status, o.fulfillment, o.delivery, o.locationId, o.shiftId ?? null, o.cashier ?? null, o.customerName ?? "",
      o.customerEmail ?? "", o.customerPhone ?? "", o.shipAddress ?? "", o.notes ?? "", fromCents(priced.subtotal), fromCents(priced.discount),
      fromCents(priced.tax), fromCents(priced.total), o.publicToken ?? null,
    ],
  );
  let cost = 0;
  for (const [i, l] of priced.lines.entries()) {
    let unitCost = 0;
    if (l.productId) {
      unitCost = await move(tq, {
        productId: l.productId, locationId: o.locationId, qty: -l.qty, kind: "sale", refType: "order", refId: row.id, note: number, by,
      });
    }
    if (l.tracked) cost += Math.round(l.qty * unitCost * 100);
    await tq(
      `INSERT INTO order_lines (order_id, product_id, sku, name, qty, unit_price, discount, tax_rate, tax, total, unit_cost, tracked, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [row.id, l.productId, l.sku, l.name, l.qty, fromCents(l.unitPrice), fromCents(l.discount), l.taxRate, fromCents(l.tax), fromCents(l.total), unitCost, l.tracked, i],
    );
  }
  return { id: row.id, number, cost };
}

type PaymentInput = { method?: unknown; amount?: unknown; tendered?: unknown; ref?: unknown };

/**
 * Turns what the cashier entered into payments that add up to exactly `due`. Cash can be more
 * than is owed (change is given); card and other tenders can't, and are applied first.
 */
export function settle(due: number, input: PaymentInput[]): { method: PaymentMethod; amount: number; tendered: number | null; change: number | null; ref: string }[] {
  if (!Array.isArray(input) || !input.length) throw new UserError("Take a payment");
  const parsed = input.map((p) => {
    const method = oneOf(p.method, PAYMENT_METHODS, "cash", "payment method");
    if (method === "online") throw new UserError("Online payments come from the payment provider");
    const amount = cents(p.amount ?? p.tendered, "Payment");
    if (amount <= 0) throw new UserError("A payment must be more than zero");
    return { method, amount, ref: text(p.ref, 80) };
  });
  const nonCash = parsed.filter((p) => p.method !== "cash");
  const cash = parsed.filter((p) => p.method === "cash");
  let left = due;
  const out: ReturnType<typeof settle> = [];
  for (const p of nonCash) {
    if (p.amount > left) throw new UserError(`${p.method === "card" ? "Card" : "That"} payment is more than is owed`);
    left -= p.amount;
    out.push({ method: p.method, amount: p.amount, tendered: null, change: null, ref: p.ref });
  }
  const tendered = cash.reduce((a, p) => a + p.amount, 0);
  if (tendered < left) throw new UserError(`${fromCents(left - tendered)} still to pay`);
  if (cash.length) out.push({ method: "cash", amount: left, tendered, change: changeDue(left, tendered), ref: "" });
  return out.filter((p) => p.amount > 0);
}

async function openShiftFor(tq: Tq, registerId: unknown): Promise<{ shiftId: string; locationId: string }> {
  if (!isUuid(registerId)) throw new UserError("Pick a register");
  const [r] = await tq<{ shift_id: string | null; location_id: string; active: boolean }>(
    `SELECT s.id AS shift_id, r.location_id, r.active FROM registers r LEFT JOIN shifts s ON s.register_id = r.id AND s.closed_at IS NULL WHERE r.id = $1`,
    [registerId],
  );
  if (!r || !r.active) throw new UserError("That register isn't in use");
  if (!r.shift_id) throw new UserError("Open the register before selling");
  return { shiftId: r.shift_id, locationId: r.location_id };
}

async function writePayments(tq: Tq, orderId: string, by: string | null, shiftId: string | null, pays: ReturnType<typeof settle>): Promise<void> {
  for (const p of pays) {
    await tq(
      "INSERT INTO payments (order_id, method, amount, tendered, change, ref, shift_id, by_email) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [orderId, p.method, fromCents(p.amount), p.tendered === null ? null : fromCents(p.tendered), p.change === null ? null : fromCents(p.change), p.ref, shiftId, by],
    );
  }
}

/** Sends a paid order's sale to Books: the money by tender, sales, tax, and what the goods cost. */
async function postSale(tq: Tq, s: Settings, orderId: string): Promise<void> {
  const [o] = await tq<{ number: string; subtotal: string; discount: string; tax: string; paid_at: Date }>(
    "SELECT number, subtotal, discount, tax, paid_at FROM orders WHERE id = $1",
    [orderId],
  );
  const pays = await tq<{ method: PaymentMethod; amount: string }>("SELECT method, amount FROM payments WHERE order_id = $1 AND amount > 0", [orderId]);
  const [{ cost }] = await tq<{ cost: string }>(
    "SELECT COALESCE(sum(round(qty * unit_cost * 100)), 0) AS cost FROM order_lines WHERE order_id = $1 AND tracked",
    [orderId],
  );
  await enqueue(tq, {
    reference: `commerce:sale:${o.number}`,
    kind: "sale",
    date: o.paid_at.toISOString().slice(0, 10),
    description: `Sale ${o.number}`,
    lines: saleLines(s, o.number, {
      payments: pays.map((p) => ({ method: p.method, amount: toCents(p.amount) })),
      net: toCents(o.subtotal) - toCents(o.discount),
      tax: toCents(o.tax),
      cost: Number(cost),
    }),
  });
}

/** A sale at the register, paid there and then. */
export async function registerSale(
  ctx: Ctx,
  input: { registerId?: unknown; items?: unknown; orderDiscount?: unknown; payments?: PaymentInput[]; customerName?: unknown; customerEmail?: unknown; notes?: unknown },
): Promise<{ order: Order; change: string }> {
  const s = await getSettings();
  const id = await tx(async (tq) => {
    const { shiftId, locationId } = await openShiftFor(tq, input.registerId);
    const priced = await priceItems(tq, s, input.items, cents(input.orderDiscount, "Discount"));
    const pays = settle(priced.total, input.payments ?? []);
    const o = await writeOrder(tq, ctx.email, {
      channel: "pos", status: "paid", fulfillment: "fulfilled", delivery: "in_store", locationId, shiftId, cashier: ctx.email,
      customerName: text(input.customerName, 120), customerEmail: optionalEmail(input.customerEmail), notes: text(input.notes, 500),
    }, priced);
    await writePayments(tq, o.id, ctx.email, shiftId, pays);
    await tq("UPDATE orders SET paid = total, paid_at = now(), fulfilled_at = now() WHERE id = $1", [o.id]);
    await postSale(tq, s, o.id);
    return { id: o.id, change: pays.find((p) => p.method === "cash")?.change ?? 0 };
  });
  return { order: await order(id.id), change: fromCents(id.change) };
}

/** Takes payment for an order placed online to be paid at pickup or on delivery. */
export async function takePayment(ctx: Ctx, orderId: string, input: { registerId?: unknown; payments?: PaymentInput[] }): Promise<{ order: Order; change: string }> {
  const s = await getSettings();
  const change = await tx(async (tq) => {
    const [o] = await tq<{ id: string; status: string; total: string }>("SELECT id, status, total FROM orders WHERE id = $1 FOR UPDATE", [isUuid(orderId) ? orderId : null]);
    if (!o) throw new UserError("Order not found", 404);
    if (o.status !== "pending") throw new UserError("This order isn't waiting for payment");
    const shiftId = input.registerId ? (await openShiftFor(tq, input.registerId)).shiftId : null;
    const pays = settle(toCents(o.total), input.payments ?? []);
    await writePayments(tq, o.id, ctx.email, shiftId, pays);
    await tq("UPDATE orders SET status = 'paid', paid = total, paid_at = now(), modified_at = now() WHERE id = $1", [o.id]);
    await postSale(tq, s, o.id);
    return pays.find((p) => p.method === "cash")?.change ?? 0;
  });
  return { order: await order(orderId), change: fromCents(change) };
}

/**
 * The payment provider says an online order was paid. Recorded once per provider reference, and
 * only for the full amount owed; anything else is left for a person to look at.
 */
export async function onlinePaid(input: { order?: unknown; amount?: unknown; ref?: unknown }): Promise<{ ok: boolean; status: string }> {
  const s = await getSettings();
  const ref = text(input.ref, 120);
  if (!ref) throw new UserError("ref is required");
  return tx(async (tq) => {
    const [o] = await tq<{ id: string; status: string; total: string }>("SELECT id, status, total FROM orders WHERE number = $1 AND channel = 'online' FOR UPDATE", [text(input.order, 20)]);
    if (!o) throw new UserError("Order not found", 404);
    const [dup] = await tq("SELECT 1 FROM payments WHERE method = 'online' AND ref = $1", [ref]);
    if (dup) return { ok: true, status: o.status };
    if (o.status !== "pending") throw new UserError(`Order is ${o.status}, not waiting for payment`, 409);
    if (cents(input.amount, "amount") !== toCents(o.total)) throw new UserError("amount does not match the order total", 409);
    await tq("INSERT INTO payments (order_id, method, amount, ref) VALUES ($1, 'online', $2, $3)", [o.id, o.total, ref]);
    await tq("UPDATE orders SET status = 'paid', paid = total, paid_at = now(), modified_at = now() WHERE id = $1", [o.id]);
    await postSale(tq, s, o.id);
    return { ok: true, status: "paid" };
  });
}

export type CheckoutInput = {
  items?: unknown; name?: unknown; email?: unknown; phone?: unknown; delivery?: unknown; address?: unknown; notes?: unknown; payOnline?: unknown;
};

/** An order from the online store. Stock is held for it at the store's location until it is paid or cancelled. */
export async function placeOnlineOrder(input: CheckoutInput): Promise<{ number: string; token: string; total: string; id: string }> {
  const s = await getSettings();
  if (!s.store.enabled) throw new UserError("The store is closed right now", 403);
  const name = text(input.name, 120);
  if (!name) throw new UserError("Enter your name");
  const email = text(input.email, 254).toLowerCase();
  if (!isEmail(email)) throw new UserError("Enter your email address so we can send your order");
  const delivery = input.delivery === "ship" ? "ship" : "pickup";
  if (delivery === "ship" && !s.store.shipping) throw new UserError("Delivery isn't offered");
  if (delivery === "pickup" && !s.store.pickup) throw new UserError("Pickup isn't offered");
  const address = text(input.address, 500);
  if (delivery === "ship" && address.length < 8) throw new UserError("Enter the delivery address");
  if (!bool(input.payOnline) && !s.store.payLater) throw new UserError("Pay online to place this order");
  const locationId = s.store.locationId ? await assertLocation(s.store.locationId) : null;
  if (!locationId) throw new UserError("The store isn't set up yet", 503);
  return tx(async (tq) => {
    const extra = delivery === "ship" && s.store.shippingFee > 0
      ? [{ productId: null, sku: "DELIVERY", name: "Delivery", qty: 1, unitPrice: s.store.shippingFee, taxRate: 0, tracked: false }]
      : [];
    const priced = await priceItems(tq, s, input.items, 0, { onlineOnly: true, extra });
    // Don't sell what isn't on the shelf. Locks the product (as every stock move does) so two shoppers can't take the last one.
    for (const l of priced.lines) {
      if (!l.productId || !l.tracked) continue;
      await tq("SELECT 1 FROM products WHERE id = $1 FOR UPDATE", [l.productId]);
      const [st] = await tq<{ on_hand: string }>(
        "SELECT on_hand FROM stock WHERE product_id = $1 AND location_id = $2",
        [l.productId, locationId],
      );
      const have = Number(st?.on_hand ?? 0);
      if (have < l.qty) throw new UserError(have > 0 ? `Only ${have} ${l.name} left` : `${l.name} is sold out`, 409);
    }
    const token = randomBytes(24).toString("base64url");
    const o = await writeOrder(tq, email, {
      channel: "online", status: "pending", fulfillment: "unfulfilled", delivery, locationId, customerName: name, customerEmail: email,
      customerPhone: text(input.phone, 40), shipAddress: delivery === "ship" ? address : "", notes: text(input.notes, 1000), publicToken: token,
    }, priced);
    return { number: o.number, token, total: fromCents(priced.total), id: o.id };
  });
}

/** Moves an online order along: picked and ready, then handed over or shipped. */
export async function fulfil(ctx: Ctx, id: string, step: unknown): Promise<Order> {
  const to = oneOf(step, ["ready", "fulfilled"] as const, "fulfilled", "step");
  await tx(async (tq) => {
    const [o] = await tq<{ status: string; fulfillment: string }>("SELECT status, fulfillment FROM orders WHERE id = $1 FOR UPDATE", [isUuid(id) ? id : null]);
    if (!o) throw new UserError("Order not found", 404);
    if (o.status === "cancelled") throw new UserError("This order was cancelled");
    if (o.fulfillment === "fulfilled") throw new UserError("Already fulfilled");
    if (to === "fulfilled" && o.status === "pending") throw new UserError("Take payment before handing the order over");
    await tq(
      `UPDATE orders SET fulfillment = $2, fulfilled_at = CASE WHEN $2 = 'fulfilled' THEN now() ELSE fulfilled_at END, modified_at = now() WHERE id = $1`,
      [id, to],
    );
  });
  void ctx;
  return order(id);
}

/** Cancels an unpaid order and puts its goods back on the shelf. */
export async function cancelOrder(ctx: Ctx, id: string, reason?: unknown): Promise<Order> {
  await tx(async (tq) => {
    const [o] = await tq<{ status: string; number: string; location_id: string }>(
      "SELECT status, number, location_id FROM orders WHERE id = $1 FOR UPDATE",
      [isUuid(id) ? id : null],
    );
    if (!o) throw new UserError("Order not found", 404);
    if (o.status !== "pending") throw new UserError("Only an unpaid order can be cancelled; refund a paid one");
    const lines = await tq<{ product_id: string | null; qty: string }>("SELECT product_id, qty FROM order_lines WHERE order_id = $1", [id]);
    for (const l of lines) {
      if (l.product_id) await move(tq, { productId: l.product_id, locationId: o.location_id, qty: Number(l.qty), kind: "cancel", refType: "order", refId: id, note: o.number, by: ctx.email });
    }
    const why = text(reason, 300);
    await tq(
      `UPDATE orders SET status = 'cancelled', notes = CASE WHEN $2 = '' THEN notes ELSE trim(notes || E'\\nCancelled: ' || $2) END, modified_at = now() WHERE id = $1`,
      [id, why],
    );
  });
  return order(id);
}

/**
 * Gives money back for some or all of a paid order. Each line's refund is what was paid for it,
 * tax included; restocked goods go back on the shelf at what they cost. Managers only.
 */
export async function refund(
  ctx: Ctx,
  id: string,
  input: { lines?: { lineId?: unknown; qty?: unknown }[]; method?: unknown; restock?: unknown; reason?: unknown; registerId?: unknown },
): Promise<{ order: Order; amount: string }> {
  assertManager(ctx);
  const s = await getSettings();
  const out = await tx(async (tq) => {
    const [o] = await tq<{ id: string; number: string; status: string; location_id: string }>(
      "SELECT id, number, status, location_id FROM orders WHERE id = $1 FOR UPDATE",
      [isUuid(id) ? id : null],
    );
    if (!o) throw new UserError("Order not found", 404);
    if (o.status !== "paid" && o.status !== "partially_refunded") throw new UserError("Only a paid order can be refunded");
    const lines = await tq<{ id: string; product_id: string | null; sku: string; qty: string; total: string; tax: string; unit_cost: string; tracked: boolean; refunded: string }>(
      "SELECT id, product_id, sku, qty, total, tax, unit_cost, tracked, refunded FROM order_lines WHERE order_id = $1",
      [id],
    );
    const method = oneOf(input.method, PAYMENT_METHODS, "cash", "refund method");
    const restock = input.restock === undefined ? true : bool(input.restock);
    const shiftId = input.registerId ? (await openShiftFor(tq, input.registerId)).shiftId : null;
    let total = 0;
    let tax = 0;
    let cost = 0;
    const done: { sku: string; qty: number; amount: string }[] = [];
    for (const want of input.lines ?? []) {
      if (want.qty === undefined || want.qty === "" || Number(want.qty) === 0) continue;
      const l = lines.find((x) => x.id === want.lineId);
      if (!l) throw new UserError("That line isn't on this order");
      const n = quantity(want.qty, `${l.sku} quantity`);
      const already = Number(l.refunded);
      if (roundQty(already + n) > Number(l.qty)) throw new UserError(`Only ${Number(l.qty) - already} of ${l.sku} can still be refunded`);
      const share = refundShare({ qty: Number(l.qty), total: toCents(l.total), tax: toCents(l.tax) }, already, n);
      total += share.total;
      tax += share.tax;
      await tq("UPDATE order_lines SET refunded = refunded + $2 WHERE id = $1", [l.id, n]);
      if (restock && l.product_id) {
        await move(tq, { productId: l.product_id, locationId: o.location_id, qty: n, kind: "return", refType: "order", refId: id, note: `Refund ${o.number}`, by: ctx.email });
        if (l.tracked) cost += Math.round(n * Number(l.unit_cost) * 100);
      }
      done.push({ sku: l.sku, qty: n, amount: fromCents(share.total) });
    }
    if (!done.length) throw new UserError("Pick what is coming back");
    const [{ seq }] = await tq<{ seq: number }>("SELECT COALESCE(max(seq), 0) + 1 AS seq FROM refunds WHERE order_id = $1", [id]);
    await tq(
      "INSERT INTO refunds (order_id, seq, amount, method, restock, reason, lines, by_email) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [id, seq, fromCents(total), method, restock, text(input.reason, 300), JSON.stringify(done), ctx.email],
    );
    await tq("INSERT INTO payments (order_id, method, amount, shift_id, by_email, ref) VALUES ($1, $2, $3, $4, $5, $6)", [
      id, method, fromCents(-total), shiftId, ctx.email, `refund ${seq}`,
    ]);
    const [left] = await tq("SELECT 1 FROM order_lines WHERE order_id = $1 AND refunded < qty", [id]);
    await tq(
      "UPDATE orders SET refunded = refunded + $2, status = $3, modified_at = now() WHERE id = $1",
      [id, fromCents(total), left ? "partially_refunded" : "refunded"],
    );
    await enqueue(tq, {
      reference: `commerce:refund:${o.number}-${seq}`,
      kind: "refund",
      date: today(),
      description: `Refund ${seq} on ${o.number}`,
      lines: refundLines(s, `${o.number}-${seq}`, { method, net: total - tax, tax, cost, restock }),
    });
    return total;
  });
  return { order: await order(id), amount: fromCents(out) };
}

// ---------- reading orders

type OrderRow = {
  id: string; number: string; channel: Order["channel"]; status: Order["status"]; fulfillment: Order["fulfillment"]; delivery: Order["delivery"];
  location_id: string; location_name: string; cashier: string | null; customer_name: string; customer_email: string; customer_phone: string;
  ship_address: string; notes: string; subtotal: string; discount: string; tax: string; total: string; paid: string; refunded: string;
  created_at: Date; paid_at: Date | null; fulfilled_at: Date | null;
};

const ORDER_SELECT = `SELECT o.*, l.name AS location_name FROM orders o JOIN locations l ON l.id = o.location_id`;
const m2 = (v: string) => Number(v).toFixed(2);

function head(r: OrderRow): Omit<Order, "lines" | "payments" | "refunds"> {
  return {
    id: r.id, number: r.number, channel: r.channel, status: r.status, fulfillment: r.fulfillment, delivery: r.delivery, locationId: r.location_id,
    locationName: r.location_name, cashier: r.cashier, customerName: r.customer_name, customerEmail: r.customer_email,
    customerPhone: r.customer_phone, shipAddress: r.ship_address, notes: r.notes, subtotal: m2(r.subtotal), discount: m2(r.discount), tax: m2(r.tax),
    total: m2(r.total), paid: m2(r.paid), refunded: m2(r.refunded), createdAt: r.created_at.toISOString(), paidAt: r.paid_at?.toISOString() ?? null,
    fulfilledAt: r.fulfilled_at?.toISOString() ?? null,
  };
}

async function full(r: OrderRow): Promise<Order> {
  const lines = await q<{ id: string; product_id: string | null; sku: string; name: string; qty: string; unit_price: string; discount: string; tax_rate: string; tax: string; total: string; refunded: string }>(
    "SELECT * FROM order_lines WHERE order_id = $1 ORDER BY position, id",
    [r.id],
  );
  const pays = await q<{ method: Order["payments"][number]["method"]; amount: string; tendered: string | null; change: string | null; ref: string; at: Date }>(
    "SELECT method, amount, tendered, change, ref, at FROM payments WHERE order_id = $1 ORDER BY at",
    [r.id],
  );
  const refunds = await q<{ seq: number; amount: string; method: string; restock: boolean; reason: string; by_email: string; at: Date }>(
    "SELECT seq, amount, method, restock, reason, by_email, at FROM refunds WHERE order_id = $1 ORDER BY seq",
    [r.id],
  );
  return {
    ...head(r),
    lines: lines.map((l) => ({
      id: l.id, productId: l.product_id, sku: l.sku, name: l.name, qty: Number(l.qty), unitPrice: m2(l.unit_price), discount: m2(l.discount),
      taxRate: String(Number(l.tax_rate)), tax: m2(l.tax), total: m2(l.total), refunded: Number(l.refunded),
    })),
    payments: pays.map((p) => ({ method: p.method, amount: m2(p.amount), tendered: p.tendered === null ? null : m2(p.tendered), change: p.change === null ? null : m2(p.change), ref: p.ref, at: p.at.toISOString() })),
    refunds: refunds.map((x) => ({ seq: x.seq, amount: m2(x.amount), method: x.method, restock: x.restock, reason: x.reason, by: x.by_email, at: x.at.toISOString() })),
  };
}

export async function order(id: string): Promise<Order> {
  if (!isUuid(id)) throw new UserError("Order not found", 404);
  const [r] = await q<OrderRow>(`${ORDER_SELECT} WHERE o.id = $1`, [id]);
  if (!r) throw new UserError("Order not found", 404);
  return full(r);
}

/** A shopper's own order, by the private link they were given. */
export async function orderByToken(token: string): Promise<Order | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [r] = await q<OrderRow>(`${ORDER_SELECT} WHERE o.public_token = $1`, [token]);
  return r ? full(r) : null;
}

export type OrderSummary = Omit<Order, "lines" | "payments" | "refunds"> & { items: number };

export async function orders(f: { channel?: string; status?: string; q?: string; from?: string; to?: string; limit?: number } = {}): Promise<OrderSummary[]> {
  const term = text(f.q, 80).replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await q<OrderRow & { items: string }>(
    `SELECT o.*, l.name AS location_name, (SELECT COALESCE(sum(qty), 0) FROM order_lines WHERE order_id = o.id AND product_id IS NOT NULL) AS items
     FROM orders o JOIN locations l ON l.id = o.location_id
     WHERE ($1::text IS NULL OR o.channel = $1)
       AND ($2::text IS NULL OR o.status = $2 OR ($2 = 'open' AND o.channel = 'online' AND o.status <> 'cancelled' AND o.fulfillment <> 'fulfilled'))
       AND ($3 = '' OR o.number ILIKE '%' || $3 || '%' OR o.customer_name ILIKE '%' || $3 || '%' OR o.customer_email ILIKE '%' || $3 || '%')
       AND ($4::date IS NULL OR o.created_at >= $4::date) AND ($5::date IS NULL OR o.created_at < $5::date + 1)
     ORDER BY o.created_at DESC LIMIT $6`,
    [f.channel || null, f.status || null, term, f.from || null, f.to || null, Math.min(f.limit ?? 200, 1000)],
  );
  return rows.map((r) => ({ ...head(r), items: Number(r.items) }));
}

// ---------- registers and shifts

type ShiftRow = {
  id: string; register_id: string; opened_by: string; opened_at: Date; opening_float: string; closed_by: string | null; closed_at: Date | null;
  counted_cash: string | null; expected_cash: string | null; note: string;
};

const toShift = (r: ShiftRow): Shift => ({
  id: r.id, registerId: r.register_id, openedBy: r.opened_by, openedAt: r.opened_at.toISOString(), openingFloat: m2(r.opening_float),
  closedBy: r.closed_by, closedAt: r.closed_at?.toISOString() ?? null, countedCash: r.counted_cash === null ? null : m2(r.counted_cash),
  expectedCash: r.expected_cash === null ? null : m2(r.expected_cash), note: r.note,
});

/** Money taken in a shift by method, refunds netted off. */
async function takings(tq: Tq, shiftId: string): Promise<Record<string, number>> {
  const rows = await tq<{ method: string; total: string }>("SELECT method, sum(amount) AS total FROM payments WHERE shift_id = $1 GROUP BY method", [shiftId]);
  return Object.fromEntries(rows.map((r) => [r.method, toCents(r.total)]));
}

export async function registers(): Promise<Register[]> {
  const rows = await q<{ id: string; name: string; location_id: string; location_name: string; active: boolean }>(
    "SELECT r.id, r.name, r.location_id, l.name AS location_name, r.active FROM registers r JOIN locations l ON l.id = r.location_id ORDER BY r.active DESC, r.name",
  );
  const shifts = await q<ShiftRow>("SELECT * FROM shifts WHERE closed_at IS NULL");
  const out: Register[] = [];
  for (const r of rows) {
    const sh = shifts.find((x) => x.register_id === r.id);
    let shift: Shift | null = null;
    if (sh) {
      const t = await takings(q, sh.id);
      shift = { ...toShift(sh), takings: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, fromCents(v)])) };
    }
    out.push({ id: r.id, name: r.name, locationId: r.location_id, locationName: r.location_name, active: r.active, shift });
  }
  return out;
}

export async function saveRegister(ctx: Ctx, id: string | null, input: Record<string, unknown>): Promise<void> {
  assertManager(ctx);
  const name = text(input.name, 60);
  if (!name) throw new UserError("Name the register");
  const locationId = await assertLocation(input.locationId);
  const active = input.active === undefined ? true : bool(input.active);
  if (id) {
    const [open] = await q("SELECT 1 FROM shifts WHERE register_id = $1 AND closed_at IS NULL", [id]);
    if (open && !active) throw new UserError("Close the register before turning it off");
    await q("UPDATE registers SET name = $2, location_id = $3, active = $4 WHERE id = $1", [id, name, locationId, active]);
  } else {
    await q("INSERT INTO registers (name, location_id) VALUES ($1, $2)", [name, locationId]);
  }
}

export async function openShift(ctx: Ctx, registerId: string, input: { float?: unknown }): Promise<Shift> {
  if (!isUuid(registerId)) throw new UserError("Pick a register");
  const [reg] = await q<{ active: boolean }>("SELECT active FROM registers WHERE id = $1", [registerId]);
  if (!reg?.active) throw new UserError("That register isn't in use");
  const [r] = await q<ShiftRow>(
    "INSERT INTO shifts (register_id, opened_by, opening_float) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *",
    [registerId, ctx.email, fromCents(cents(input.float, "Opening float"))],
  );
  if (!r) throw new UserError("That register is already open", 409);
  return toShift(r);
}

/** Closes the register: the counted drawer against float plus cash taken, and the difference. */
export async function closeShift(ctx: Ctx, registerId: string, input: { counted?: unknown; note?: unknown }): Promise<Shift & { over: string }> {
  return tx(async (tq) => {
    const [sh] = await tq<ShiftRow>("SELECT * FROM shifts WHERE register_id = $1 AND closed_at IS NULL FOR UPDATE", [isUuid(registerId) ? registerId : null]);
    if (!sh) throw new UserError("That register isn't open");
    const t = await takings(tq, sh.id);
    const expected = toCents(sh.opening_float) + (t.cash ?? 0);
    const counted = cents(input.counted, "Counted cash");
    const [r] = await tq<ShiftRow>(
      "UPDATE shifts SET closed_by = $2, closed_at = now(), counted_cash = $3, expected_cash = $4, note = $5 WHERE id = $1 RETURNING *",
      [sh.id, ctx.email, fromCents(counted), fromCents(expected), text(input.note, 500)],
    );
    return { ...toShift(r), takings: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, fromCents(v)])), over: fromCents(counted - expected) };
  });
}

export async function shiftHistory(limit = 50): Promise<(Shift & { registerName: string })[]> {
  const rows = await q<ShiftRow & { register_name: string }>(
    "SELECT s.*, r.name AS register_name FROM shifts s JOIN registers r ON r.id = s.register_id ORDER BY s.opened_at DESC LIMIT $1",
    [Math.min(limit, 200)],
  );
  return rows.map((r) => ({ ...toShift(r), registerName: r.register_name }));
}
