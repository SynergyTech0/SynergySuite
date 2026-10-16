/**
 * Money and quantity arithmetic with no database, so it is tested on its own. Amounts are worked
 * in whole cents and only turned back into "12.34" strings at the edges, so a sale always adds up
 * to the cent: lines + tax = total, and an order discount is shared out without losing a penny.
 */

/** "12.34" or 12.34 to 1234. */
export function toCents(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** 1234 to "12.34". */
export function fromCents(c: number): string {
  const sign = c < 0 ? "-" : "";
  const a = Math.abs(Math.round(c));
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/** Rounds a quantity to the three decimals the database keeps. */
export function qty(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export type LineIn = {
  qty: number;
  /** Cents per unit. */
  unitPrice: number;
  /** Cents off this line. */
  discount?: number;
  /** Percent, e.g. 8.25. */
  taxRate: number;
};

export type LineOut = {
  qty: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  tax: number;
  /** Cents, tax included. */
  total: number;
};

export type Totals = { subtotal: number; discount: number; tax: number; total: number; lines: LineOut[] };

/**
 * Prices a cart. `orderDiscount` (cents) is shared across lines in proportion to what is left of
 * each after its own discount, largest remainders first, then tax is worked out per line on what
 * remains. Discounts never take a line below zero.
 */
export function price(lines: LineIn[], orderDiscount = 0): Totals {
  const gross = lines.map((l) => Math.round(l.qty * l.unitPrice));
  const own = lines.map((l, i) => Math.min(Math.max(0, Math.round(l.discount ?? 0)), gross[i]));
  const net = gross.map((g, i) => g - own[i]);
  const pool = Math.min(Math.max(0, Math.round(orderDiscount)), net.reduce((a, b) => a + b, 0));
  const share = allocate(pool, net);
  const out = lines.map((l, i): LineOut => {
    const discount = own[i] + share[i];
    const taxable = gross[i] - discount;
    const tax = Math.round((taxable * l.taxRate) / 100);
    return { qty: l.qty, unitPrice: l.unitPrice, discount, taxRate: l.taxRate, tax, total: taxable + tax };
  });
  const subtotal = gross.reduce((a, b) => a + b, 0);
  const discount = out.reduce((a, l) => a + l.discount, 0);
  const tax = out.reduce((a, l) => a + l.tax, 0);
  return { subtotal, discount, tax, total: subtotal - discount + tax, lines: out };
}

/** Splits `amount` cents across `weights` in proportion, so the parts add up to exactly `amount`. */
export function allocate(amount: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (!amount || !sum) return weights.map(() => 0);
  const exact = weights.map((w) => (amount * Math.max(0, w)) / sum);
  const parts = exact.map(Math.floor);
  let left = amount - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts;
}

/**
 * The new moving-average unit cost after receiving `inQty` at `inCost`. Stock that had run below
 * zero is treated as none, so a late receipt sets the cost instead of being averaged against it.
 */
export function movingAverage(onHand: number, cost: number, inQty: number, inCost: number): number {
  const have = Math.max(0, onHand);
  if (inQty <= 0) return cost;
  if (have === 0) return round4(inCost);
  return round4((have * cost + inQty * inCost) / (have + inQty));
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** The change owed when `tendered` cents of cash meet `due` cents; never negative. */
export function changeDue(due: number, tendered: number): number {
  return Math.max(0, tendered - due);
}

/**
 * A refund's share of one line: what the customer paid for `count` more of its `qty` when `already`
 * came back before, tax included. Worked as a difference of running totals, so refunding a line in
 * several goes gives back exactly what was paid for it.
 */
export function refundShare(
  line: { qty: number; total: number; tax: number },
  already: number,
  count: number,
): { total: number; tax: number } {
  const upTo = (n: number, amount: number) => (n >= line.qty ? amount : Math.round((amount * n) / line.qty));
  const end = already + count;
  return { total: upTo(end, line.total) - upTo(already, line.total), tax: upTo(end, line.tax) - upTo(already, line.tax) };
}
