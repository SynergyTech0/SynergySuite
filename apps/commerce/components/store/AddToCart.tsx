"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Minus, Plus, ShoppingBag } from "lucide-react";
import { addToCart, useCart } from "./cart";

type Props = {
  productId: string;
  /** null when the product isn't stock-tracked. */
  available: number | null;
  /** Shows a quantity picker (product page). */
  withQty?: boolean;
  name?: string;
};

export default function AddToCart({ productId, available, withQty = false, name }: Props) {
  const inCart = useCart().find((i) => i.productId === productId)?.qty ?? 0;
  // How many more can go in the cart before it holds everything on the shelf.
  const room = available === null ? 99 : Math.max(0, available - inCart);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(false), 2000);
    return () => clearTimeout(t);
  }, [added]);

  const soldOut = available !== null && available <= 0;
  const pick = Math.min(Math.max(1, qty), Math.max(1, room));

  function add() {
    if (room <= 0) return;
    addToCart(productId, pick, available);
    setAdded(true);
    setQty(1);
  }

  if (soldOut) {
    return <button type="button" className="shop-btn shop-btn-block" disabled>Sold out</button>;
  }

  return (
    <div className={withQty ? "shop-add shop-add-wide" : "shop-add"}>
      {withQty && (
        <div className="shop-qty" role="group" aria-label="Quantity">
          <button type="button" onClick={() => setQty(Math.max(1, pick - 1))} disabled={pick <= 1} aria-label="One fewer">
            <Minus size={16} aria-hidden />
          </button>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={Math.max(1, room)}
            value={pick}
            onChange={(e) => setQty(Math.floor(Number(e.target.value)) || 1)}
            aria-label="Quantity"
          />
          <button type="button" onClick={() => setQty(pick + 1)} disabled={pick >= room} aria-label="One more">
            <Plus size={16} aria-hidden />
          </button>
        </div>
      )}
      <button
        type="button"
        className="shop-btn shop-btn-primary shop-btn-block"
        onClick={add}
        disabled={room <= 0}
        aria-label={name ? `Add ${name} to cart` : undefined}
      >
        {added ? <Check size={18} aria-hidden /> : <ShoppingBag size={18} aria-hidden />}
        {room <= 0 ? "All in your cart" : added ? "Added" : "Add to cart"}
      </button>
      {withQty && inCart > 0 && (
        <p className="shop-muted shop-small" aria-live="polite">
          {inCart} in your cart. <Link href="/store/cart">View cart</Link>
        </p>
      )}
    </div>
  );
}
