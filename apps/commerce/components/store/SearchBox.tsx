"use client";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

/** A plain GET form, so search works before the page's scripts load. */
export default function SearchBox() {
  const q = useSearchParams().get("q") ?? "";
  return (
    <form action="/store" method="get" role="search" className="shop-search">
      <Search size={18} aria-hidden className="shop-search-icon" />
      <input key={q} type="search" name="q" defaultValue={q} placeholder="Search products" aria-label="Search products" maxLength={80} />
    </form>
  );
}
