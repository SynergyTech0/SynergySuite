import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getSettings } from "@/lib/settings";
import { storeProducts, type StoreProduct } from "@/lib/store";
import AddToCart from "@/components/store/AddToCart";
import ProductImage from "@/components/store/ProductImage";
import { moneyFormatter, stockNote } from "@/components/store/format";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ sku: string }> };

async function find(raw: string): Promise<StoreProduct | null> {
  let sku = raw;
  // Next normally hands the segment over decoded; decode again only if it still looks encoded.
  if (/%[0-9a-f]{2}/i.test(sku)) {
    try {
      sku = decodeURIComponent(sku);
    } catch {
      // Not valid encoding; look it up as it is.
    }
  }
  const [p] = await storeProducts({ sku });
  return p ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await find((await params).sku);
  if (!p) return { title: "Product not found" };
  return { title: p.name, description: p.description.slice(0, 160) || undefined };
}

export default async function ProductPage({ params }: Props) {
  const p = await find((await params).sku);
  if (!p) notFound();
  const settings = await getSettings();
  const money = moneyFormatter(settings.currency);
  const note = stockNote(p.available);

  return (
    <>
      <Link href={p.category ? `/store?category=${encodeURIComponent(p.category)}` : "/store"} className="shop-back">
        <ChevronLeft size={18} aria-hidden /> {p.category || "All products"}
      </Link>
      <article className="shop-product">
        <div className="shop-product-media">
          <ProductImage name={p.name} src={p.imageUrl} large />
        </div>
        <div className="shop-product-info">
          {p.category && <span className="shop-card-cat">{p.category}</span>}
          <h1>{p.name}</h1>
          <p className="shop-product-price">
            {money(p.price)}
            {p.unit && p.unit !== "each" && <span className="shop-muted shop-small"> / {p.unit}</span>}
          </p>
          <p className={note ? `shop-stock shop-stock-${note.tone}` : "shop-stock shop-stock-ok"}>{note ? note.text : "In stock"}</p>
          <AddToCart productId={p.id} available={p.available} withQty name={p.name} />
          {/* Plain text; white-space: pre-line in the CSS keeps the line breaks. */}
          {p.description && <div className="shop-product-desc">{p.description}</div>}
          <p className="shop-muted shop-small">SKU {p.sku}</p>
        </div>
      </article>
    </>
  );
}
