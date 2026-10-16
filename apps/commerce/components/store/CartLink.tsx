"use client";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { cartCount, useCart } from "./cart";

export default function CartLink() {
  const count = cartCount(useCart());
  return (
    <Link href="/store/cart" className="shop-cartlink" aria-label={count ? `Cart, ${count} item${count === 1 ? "" : "s"}` : "Cart, empty"}>
      <ShoppingBag size={20} aria-hidden />
      <span className="shop-cartlink-label">Cart</span>
      {count > 0 && <span className="shop-badge">{count > 99 ? "99+" : count}</span>}
    </Link>
  );
}
