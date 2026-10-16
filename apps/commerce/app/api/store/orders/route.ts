import { publicRoute, body } from "@/lib/api";
import { baseUrl, checkoutConfigured, startCheckout } from "@/lib/checkout";
import { placeOnlineOrder, type CheckoutInput } from "@/lib/sales";
import { getSettings } from "@/lib/settings";
import { bool } from "@/lib/util";

/** Checkout from the online store. Answers where to send the shopper next. */
export const POST = publicRoute(async (req) => {
  const input = await body<CheckoutInput & { website?: string }>(req);
  // A field people never see; only form-filling bots put something in it.
  if (input.website) return { next: "/store" };
  const payOnline = bool(input.payOnline) && checkoutConfigured();
  const placed = await placeOnlineOrder({ ...input, payOnline });
  const base = baseUrl(req);
  if (payOnline) {
    const s = await getSettings();
    const url = await startCheckout({ number: placed.number, total: placed.total, currency: s.currency, email: String(input.email), name: String(input.name) }, base, placed.token).catch(() => null);
    if (url) return { number: placed.number, next: url };
  }
  return { number: placed.number, next: `/store/order/${placed.token}` };
});
