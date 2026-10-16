"use client";
/**
 * The shopper's cart, kept in this browser only (localStorage). Every change fires a window
 * "synergy-cart" event so the header count and other open views follow along; the "storage"
 * event covers changes made in other tabs.
 */
import { useSyncExternalStore } from "react";

export type CartItem = { productId: string; qty: number };

export const CART_KEY = "synergy-cart";
const EVENT = "synergy-cart";
const EMPTY: CartItem[] = [];

function clean(v: unknown): CartItem[] {
  if (!Array.isArray(v)) return [];
  const out: CartItem[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const { productId, qty } = x as Record<string, unknown>;
    const n = Math.floor(Number(qty));
    if (typeof productId !== "string" || !productId || !Number.isFinite(n) || n < 1) continue;
    const seen = out.find((i) => i.productId === productId);
    if (seen) seen.qty += n;
    else out.push({ productId, qty: n });
  }
  return out;
}

function readRaw(): string {
  try {
    return window.localStorage.getItem(CART_KEY) ?? "";
  } catch {
    return "";
  }
}

// useSyncExternalStore needs the same array back while nothing changed, so parse once per raw value.
let cachedRaw: string | null = null;
let cachedItems: CartItem[] = EMPTY;

export function readCart(): CartItem[] {
  const raw = readRaw();
  if (raw === cachedRaw) return cachedItems;
  cachedRaw = raw;
  try {
    cachedItems = raw ? clean(JSON.parse(raw)) : EMPTY;
  } catch {
    cachedItems = EMPTY;
  }
  return cachedItems;
}

export function writeCart(items: CartItem[]): void {
  try {
    const next = clean(items);
    if (next.length) window.localStorage.setItem(CART_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(CART_KEY);
  } catch {
    // Storage blocked (private mode, full): the cart just won't survive a reload.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Adds qty of a product; `max` caps the total in the cart (stock on hand). Returns the new qty in the cart. */
export function addToCart(productId: string, qty: number, max?: number | null): number {
  const items = readCart().map((i) => ({ ...i }));
  const line = items.find((i) => i.productId === productId);
  let total = (line?.qty ?? 0) + Math.max(1, Math.floor(qty));
  if (typeof max === "number") total = Math.min(total, max);
  if (line) line.qty = total;
  else if (total > 0) items.push({ productId, qty: total });
  writeCart(items);
  return total;
}

export function clearCart(): void {
  writeCart([]);
}

function subscribe(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === CART_KEY) cb();
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** The cart, kept up to date. Empty during server rendering. */
export function useCart(): CartItem[] {
  return useSyncExternalStore(subscribe, readCart, () => EMPTY);
}

export function cartCount(items: CartItem[]): number {
  return items.reduce((n, i) => n + i.qty, 0);
}
