import type { Metadata } from "next";
import { checkoutConfigured } from "@/lib/checkout";
import { getSettings } from "@/lib/settings";
import Checkout from "@/components/store/Checkout";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default async function CartPage() {
  const s = await getSettings();
  return (
    <Checkout
      currency={s.currency}
      shippingFee={s.store.shippingFee}
      pickup={s.store.pickup}
      shipping={s.store.shipping}
      payLater={s.store.payLater}
      payOnline={checkoutConfigured()}
    />
  );
}
