/**
 * Paying online is done by a payment provider outside this repository (card processing is a paid
 * service). Commerce speaks one small protocol to it, so any provider can be plugged in:
 *
 *  1. Commerce  -> POST $COMMERCE_CHECKOUT_URL (Bearer $COMMERCE_CHECKOUT_TOKEN)
 *       { order, amount, currency, email, name, return_url, cancel_url, callback_url }
 *     The provider answers { url }: the hosted payment page the shopper is sent to.
 *  2. Provider  -> POST <callback_url> = https://commerce.<domain>/api/store/payments
 *       (Bearer $COMMERCE_CHECKOUT_TOKEN) { order, amount, ref }
 *     once the money is taken. Commerce records it once per ref and marks the order paid.
 *
 * With no provider set, the store takes orders to be paid at pickup or on delivery (when allowed).
 */
import { timingSafeEqual } from "node:crypto";
import { UserError } from "./util";

export function checkoutConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.COMMERCE_CHECKOUT_URL && env.COMMERCE_CHECKOUT_TOKEN);
}

/** True when the request carries `Authorization: Bearer <COMMERCE_CHECKOUT_TOKEN>`. */
export function providerAuthorized(header: string | null, token = process.env.COMMERCE_CHECKOUT_TOKEN || ""): boolean {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function startCheckout(
  o: { number: string; total: string; currency: string; email: string; name: string },
  base: string,
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const res = await fetch(env.COMMERCE_CHECKOUT_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.COMMERCE_CHECKOUT_TOKEN}` },
    body: JSON.stringify({
      order: o.number,
      amount: o.total,
      currency: o.currency,
      email: o.email,
      name: o.name,
      return_url: `${base}/store/order/${token}`,
      cancel_url: `${base}/store/order/${token}?cancelled=1`,
      callback_url: `${base}/api/store/payments`,
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const data = res ? ((await res.json().catch(() => ({}))) as { url?: string }) : {};
  if (!res?.ok || typeof data.url !== "string" || !/^https?:\/\//.test(data.url)) {
    throw new UserError("Online payment isn't available right now. Your order was saved; you can pay at pickup.", 502);
  }
  return data.url;
}

/** This app's public address, from the request the gateway forwarded. */
export function baseUrl(req: Request): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  if (process.env.SUITE_DOMAIN) return `https://commerce.${process.env.SUITE_DOMAIN}`;
  return `${proto}://${host}`;
}
