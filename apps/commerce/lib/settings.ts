import { q, tx, type Tq } from "./db";
import { assertAdmin } from "./members";
import { ACCOUNT_KEYS, type AccountKey, type Ctx, type Settings } from "./types";
import { UserError, bool, cents, rate, text } from "./util";

/** Books' standard chart of accounts (apps/books organization.service) numbers. */
export const DEFAULT_ACCOUNTS: Record<AccountKey, string> = {
  cash: "1010", card: "1010", online: "1010", other: "1010",
  sales: "4010", tax: "2300", returns: "4200", inventory: "1200", cogs: "5000", shrinkage: "5000", payable: "2000",
};

export const DEFAULTS: Settings = {
  storeName: "Synergy Store",
  currency: "USD",
  defaultTaxRate: 0,
  receiptFooter: "Thank you for shopping with us.",
  store: { enabled: false, tagline: "", locationId: null, pickup: true, shipping: false, shippingFee: 0, payLater: true, accent: "#0f6cbd" },
  accounts: DEFAULT_ACCOUNTS,
};

/** Fills in anything a stored copy is missing, so new settings get their defaults on old installs. */
export function merge(stored: Partial<Settings> | undefined): Settings {
  const s = stored ?? {};
  return {
    ...DEFAULTS,
    ...s,
    store: { ...DEFAULTS.store, ...(s.store ?? {}) },
    accounts: { ...DEFAULT_ACCOUNTS, ...(s.accounts ?? {}) },
  };
}

/**
 * The first visit sets the shop up so the register works straight away: one store location,
 * one register there, and the online store picking from it.
 */
async function ensureSetup(tq: Tq): Promise<void> {
  await tq("SELECT pg_advisory_xact_lock(hashtext('commerce-setup'))");
  let [loc] = await tq<{ id: string }>("SELECT id FROM locations ORDER BY created_at LIMIT 1");
  if (!loc) [loc] = await tq<{ id: string }>("INSERT INTO locations (name, kind) VALUES ('Main store', 'store') RETURNING id");
  const [reg] = await tq("SELECT 1 FROM registers LIMIT 1");
  if (!reg) await tq("INSERT INTO registers (name, location_id) VALUES ('Register 1', $1)", [loc.id]);
  const [row] = await tq("SELECT 1 FROM settings WHERE key = 'settings'");
  if (!row) {
    const s = { ...DEFAULTS, store: { ...DEFAULTS.store, locationId: loc.id } };
    await tq("INSERT INTO settings (key, value) VALUES ('settings', $1) ON CONFLICT DO NOTHING", [JSON.stringify(s)]);
  }
}

const g = globalThis as unknown as { __commerceSetup?: Promise<void> };

export async function setup(): Promise<void> {
  g.__commerceSetup ??= tx(ensureSetup).catch((e) => {
    g.__commerceSetup = undefined;
    throw e;
  });
  return g.__commerceSetup;
}

export async function getSettings(): Promise<Settings> {
  await setup();
  const [row] = await q<{ value: Partial<Settings> }>("SELECT value FROM settings WHERE key = 'settings'");
  return merge(row?.value);
}

const ACCOUNT_NUMBER = /^[A-Za-z0-9.-]{1,20}$/;

/** Checks and saves the admin's changes; anything left out keeps its value. */
export async function saveSettings(ctx: Ctx, input: Record<string, unknown>): Promise<Settings> {
  assertAdmin(ctx);
  const cur = await getSettings();
  const next: Settings = merge(cur);
  if (input.storeName !== undefined) next.storeName = text(input.storeName, 80) || DEFAULTS.storeName;
  if (input.currency !== undefined) {
    const c = text(input.currency, 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw new UserError("Currency must be a three-letter code like USD");
    next.currency = c;
  }
  if (input.defaultTaxRate !== undefined) next.defaultTaxRate = rate(input.defaultTaxRate) ?? 0;
  if (input.receiptFooter !== undefined) next.receiptFooter = text(input.receiptFooter, 300);
  const st = input.store as Record<string, unknown> | undefined;
  if (st && typeof st === "object") {
    if (st.enabled !== undefined) next.store.enabled = bool(st.enabled);
    if (st.tagline !== undefined) next.store.tagline = text(st.tagline, 160);
    if (st.pickup !== undefined) next.store.pickup = bool(st.pickup);
    if (st.shipping !== undefined) next.store.shipping = bool(st.shipping);
    if (st.shippingFee !== undefined) next.store.shippingFee = cents(st.shippingFee, "Delivery fee");
    if (st.payLater !== undefined) next.store.payLater = bool(st.payLater);
    if (st.accent !== undefined) {
      const a = text(st.accent, 7);
      if (!/^#[0-9a-fA-F]{6}$/.test(a)) throw new UserError("Pick a color like #0f6cbd");
      next.store.accent = a;
    }
    if (st.locationId !== undefined) {
      const [loc] = await q("SELECT 1 FROM locations WHERE id = $1 AND active", [String(st.locationId)]);
      if (!loc) throw new UserError("Pick a location for online orders");
      next.store.locationId = String(st.locationId);
    }
    if (!next.store.pickup && !next.store.shipping) throw new UserError("The online store needs pickup, delivery or both");
  }
  const acc = input.accounts as Record<string, unknown> | undefined;
  if (acc && typeof acc === "object") {
    for (const k of ACCOUNT_KEYS) {
      if (acc[k] === undefined) continue;
      const v = text(acc[k], 20);
      if (!ACCOUNT_NUMBER.test(v)) throw new UserError(`Enter a Books account number for ${k}`);
      next.accounts[k] = v;
    }
  }
  await q("INSERT INTO settings (key, value) VALUES ('settings', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(next)]);
  return next;
}

/** A product's tax rate, or the store's when it has none of its own. */
export function taxRateFor(product: { tax_rate: string | null }, s: Settings): number {
  return product.tax_rate === null ? s.defaultTaxRate : Number(product.tax_rate);
}
