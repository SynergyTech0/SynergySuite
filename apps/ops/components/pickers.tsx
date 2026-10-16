"use client";
import { useEffect, useState } from "react";
import type { Asset } from "@/lib/assets";
import type { WorkCenter } from "@/lib/mfg";
import type { Item } from "@/lib/stock";
import { api } from "./client";

// Each list is fetched once per screen; the lists are short enough to pick from a dropdown.

export function useItems(deps: unknown[] = []) {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    void api<Item[]>("/api/items").then(setItems).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return items;
}

export function useWorkCenters() {
  const [wcs, setWcs] = useState<WorkCenter[]>([]);
  useEffect(() => {
    void api<WorkCenter[]>("/api/work-centers").then((w) => setWcs(w.filter((x) => x.active))).catch(() => {});
  }, []);
  return wcs;
}

export function useAssets() {
  const [assets, setAssets] = useState<Asset[]>([]);
  useEffect(() => {
    void api<Asset[]>("/api/assets?status=in_service").then(setAssets).catch(() => {});
  }, []);
  return assets;
}

export function ItemSelect({ items, value, onChange, filter, placeholder = "Pick an item", id }: {
  items: Item[]; value: string; onChange: (v: string) => void; filter?: (i: Item) => boolean; placeholder?: string; id?: string;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {items.filter((i) => !filter || filter(i) || String(i.id) === value).map((i) => (
        <option key={i.id} value={i.id}>{i.sku} · {i.name}</option>
      ))}
    </select>
  );
}
