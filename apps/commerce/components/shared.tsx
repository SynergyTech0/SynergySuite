"use client";
// Pieces several Commerce screens use: badges, the app context, the product picker.
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LABELS, type Ctx, type Location, type Product, type Settings } from "@/lib/types";
import { api, money, qty, type View } from "./client";

/** What every screen gets from the app: who you are, the settings, and how to move around. */
export type AppCtx = {
  me: Ctx;
  settings: Settings;
  locations: Location[];
  books: boolean;
  checkout: boolean;
  manager: boolean;
  go: (view: View, id?: string | null) => void;
  say: (text: string) => void;
  /** Bumped when something changed that other screens show (counts, lists). */
  changed: () => void;
  version: number;
  refreshSettings: () => void;
};

const TONE: Record<string, string> = {
  admin: "purple", manager: "blue", staff: "",
  draft: "", ordered: "blue", partial: "amber", received: "green", cancelled: "red",
  pending: "amber", paid: "green", partially_refunded: "purple", refunded: "purple",
  unfulfilled: "amber", ready: "blue", fulfilled: "green",
  posted: "green", failed: "red",
  pos: "", online: "blue",
};

export function label(v: string): string {
  return LABELS[v] ?? v;
}

export function Badge({ value, text }: { value: string; text?: string }) {
  return <span className={`badge ${TONE[value] ?? ""}`}>{text ?? label(value)}</span>;
}

export function StockBadge({ p }: { p: Pick<Product, "trackStock" | "onHand" | "reorderPoint"> }) {
  if (!p.trackStock) return <span className="badge">Not tracked</span>;
  if (p.onHand <= 0) return <span className="badge red">{qty(p.onHand)} in stock</span>;
  if (p.reorderPoint > 0 && p.onHand <= p.reorderPoint) return <span className="badge amber">{qty(p.onHand)} · low</span>;
  return <span className="badge green">{qty(p.onHand)} in stock</span>;
}

/** Finds a product by name, SKU or barcode as you type. */
export function ProductPicker({ onPick, placeholder = "Add a product…", tracked }: { onPick: (p: Product) => void; placeholder?: string; tracked?: boolean }) {
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!term.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api<Product[]>(`/api/products?q=${encodeURIComponent(term)}`)
        .then((list) => setHits((tracked ? list.filter((p) => p.trackStock) : list).slice(0, 8)))
        .catch(() => setHits([]));
    }, 150);
    return () => clearTimeout(t);
  }, [term, tracked]);
  useEffect(() => {
    const off = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, []);
  const pick = (p: Product) => {
    onPick(p);
    setTerm("");
    setHits([]);
  };
  return (
    <div className="picker" ref={box}>
      <div className="search">
        <Search size={15} />
        <input
          value={term}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => (setTerm(e.target.value), setOpen(true))}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits[0]) {
              e.preventDefault();
              pick(hits[0]);
            }
          }}
        />
      </div>
      {open && hits.length > 0 && (
        <div className="menu pickmenu" role="listbox">
          {hits.map((p) => (
            <button key={p.id} type="button" role="option" aria-selected={false} onClick={() => pick(p)}>
              <span className="grow fname">{p.name}</span>
              <span className="muted small">{p.sku} · {money(p.price)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function LocationSelect({ app, name = "locationId", value, label: text = "Location", onChange }: {
  app: AppCtx; name?: string; value?: string; label?: string; onChange?: (id: string) => void;
}) {
  const active = app.locations.filter((l) => l.active);
  return (
    <label>
      <span>{text}</span>
      <select name={name} defaultValue={value ?? active[0]?.id} onChange={(e) => onChange?.(e.target.value)}>
        {active.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </label>
  );
}

export function ErrorLine({ text }: { text: string }) {
  return <p className="error" role="alert">{text}</p>;
}
