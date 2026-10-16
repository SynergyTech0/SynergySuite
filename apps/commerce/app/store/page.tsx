import Link from "next/link";
import { PackageSearch } from "lucide-react";
import { getSettings } from "@/lib/settings";
import { storeCategories, storeProducts } from "@/lib/store";
import AddToCart from "@/components/store/AddToCart";
import ProductImage from "@/components/store/ProductImage";
import { moneyFormatter, stockNote } from "@/components/store/format";

export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

/** /store with the given filters, leaving out empty ones. */
function href(f: { q?: string; category?: string }): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.category) p.set("category", f.category);
  const s = p.toString();
  return s ? `/store?${s}` : "/store";
}

export default async function CatalogPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 80);
  const category = one(sp.category);
  const [settings, categories, products] = await Promise.all([
    getSettings(),
    storeCategories(),
    storeProducts({ q: q || undefined, category: category || undefined }),
  ]);
  const money = moneyFormatter(settings.currency);

  return (
    <>
      <div className="shop-titlebar">
        <h1>{q ? `Results for “${q}”` : category || "All products"}</h1>
        {(q || category) && (
          <Link href="/store" className="shop-link-quiet">
            Clear filters
          </Link>
        )}
      </div>

      {categories.length > 0 && (
        <nav className="shop-chips" aria-label="Categories">
          <Link href={href({ q })} className={category ? "shop-chip" : "shop-chip shop-chip-on"} aria-current={category ? undefined : "page"}>
            All
          </Link>
          {categories.map((c) => (
            <Link
              key={c}
              href={href({ q, category: c })}
              className={c === category ? "shop-chip shop-chip-on" : "shop-chip"}
              aria-current={c === category ? "page" : undefined}
            >
              {c}
            </Link>
          ))}
        </nav>
      )}

      {products.length === 0 ? (
        <div className="shop-empty">
          <PackageSearch size={40} aria-hidden />
          <h2>{q || category ? "Nothing matches that" : "No products yet"}</h2>
          <p className="shop-muted">{q || category ? "Try a different search or category." : "Check back soon."}</p>
        </div>
      ) : (
        <ul className="shop-grid">
          {products.map((p) => {
            const note = stockNote(p.available);
            const link = `/store/p/${encodeURIComponent(p.sku)}`;
            return (
              <li key={p.id} className="shop-card">
                <Link href={link} className="shop-card-link">
                  <ProductImage name={p.name} src={p.imageUrl} />
                  <div className="shop-card-body">
                    {p.category && <span className="shop-card-cat">{p.category}</span>}
                    <span className="shop-card-name">{p.name}</span>
                    <span className="shop-card-price">
                      {money(p.price)}
                      {p.unit && p.unit !== "each" && <span className="shop-muted shop-small"> / {p.unit}</span>}
                    </span>
                    {note && <span className={`shop-stock shop-stock-${note.tone}`}>{note.text}</span>}
                  </div>
                </Link>
                <div className="shop-card-foot">
                  <AddToCart productId={p.id} available={p.available} name={p.name} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
